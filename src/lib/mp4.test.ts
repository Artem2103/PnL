import { describe, expect, it } from 'vitest';
import { repairFragmentedMp4 } from './mp4';

/* ------------------------------------------------------------------ */
/* A fragmented MP4, built the way MediaRecorder writes one            */
/* ------------------------------------------------------------------ */

const MOVIE_TIMESCALE = 1000;
const VIDEO_TIMESCALE = 30000;
const AUDIO_TIMESCALE = 48000;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
const zeros = (n: number) => new Uint8Array(n);

function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value));
  return out;
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(body, 8);
  return out;
}

/** version/flags, creation, modification, timescale, duration, then padding. */
const mvhd = () => box('mvhd', u32(0, 0, 0, MOVIE_TIMESCALE, 0), zeros(80));

/** version/flags, creation, modification, track id, reserved, duration, padding. */
const tkhd = (id: number) => box('tkhd', u32(0, 0, 0, id, 0, 0), zeros(60));

const mdhd = (timescale: number) => box('mdhd', u32(0, 0, 0, timescale, 0), zeros(4));

const hdlr = (handler: string) => box('hdlr', u32(0, 0), ascii(handler), zeros(13));

const trak = (id: number, timescale: number, handler: string) =>
  box('trak', tkhd(id), box('mdia', mdhd(timescale), hdlr(handler), box('minf', zeros(0))));

/** version/flags, track id, sample description index, default duration, size, flags. */
const trex = (id: number) => box('trex', u32(0, id, 1, 0, 0, 0));

interface TrackPlan {
  id: number;
  timescale: number;
  handler: 'vide' | 'soun';
  /** Sample duration in the track's own timescale. */
  sampleDuration: number;
  /** Samples in each fragment, in order. */
  fragments: number[];
}

function traf(track: TrackPlan, fragment: number, decodeTime: number): Uint8Array {
  return box(
    'traf',
    // tfhd, flags 0x08: this fragment states its own default sample duration.
    box('tfhd', u32(0x00000008, track.id, track.sampleDuration)),
    box('tfdt', u32(0, decodeTime)),
    // trun, flags 0x01: a data offset and nothing per sample, so every sample
    // takes the default duration above.
    box('trun', u32(0x00000001, track.fragments[fragment] ?? 0, 0)),
  );
}

function buildMp4(tracks: TrackPlan[]): ArrayBuffer {
  const fragmentCount = Math.max(...tracks.map((track) => track.fragments.length));
  const parts: Uint8Array[] = [
    box('ftyp', ascii('iso5'), u32(0), ascii('iso5')),
    box('moov', mvhd(), ...tracks.map((t) => trak(t.id, t.timescale, t.handler)), box('mvex', ...tracks.map((t) => trex(t.id)))),
  ];
  const at = new Map(tracks.map((track) => [track.id, 0]));
  for (let fragment = 0; fragment < fragmentCount; fragment += 1) {
    const trafs: Uint8Array[] = [];
    for (const track of tracks) {
      if (fragment >= track.fragments.length) continue;
      const decodeTime = at.get(track.id) ?? 0;
      trafs.push(traf(track, fragment, decodeTime));
      at.set(track.id, decodeTime + (track.fragments[fragment] ?? 0) * track.sampleDuration);
    }
    parts.push(box('moof', box('mfhd', u32(0, fragment + 1)), ...trafs));
    parts.push(box('mdat', zeros(16)));
  }
  const file = concat(parts);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** One sample per 1/30 s of picture, one AAC frame per 1024 samples of sound. */
const videoTrack = (seconds: number, fragments = 3): TrackPlan => ({
  id: 1,
  timescale: VIDEO_TIMESCALE,
  handler: 'vide',
  sampleDuration: VIDEO_TIMESCALE / 30,
  fragments: split(Math.round(seconds * 30), fragments),
});

const audioTrack = (seconds: number, fragments = 3): TrackPlan => ({
  id: 2,
  timescale: AUDIO_TIMESCALE,
  handler: 'soun',
  sampleDuration: 1024,
  fragments: split(Math.round((seconds * AUDIO_TIMESCALE) / 1024), fragments),
});

function split(total: number, buckets: number): number[] {
  const out: number[] = new Array(buckets).fill(Math.floor(total / buckets));
  const spare = total - out.reduce((a, b) => a + b, 0);
  out[buckets - 1] = (out[buckets - 1] ?? 0) + spare;
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading the result back                                             */
/* ------------------------------------------------------------------ */

/** Every `tfdt` in the file, in order, so a shift can be seen. */
function decodeTimes(buffer: ArrayBuffer): number[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const out: number[] = [];
  for (let i = 0; i + 8 < bytes.length; i += 1) {
    if (bytes[i] === 0x74 && bytes[i + 1] === 0x66 && bytes[i + 2] === 0x64 && bytes[i + 3] === 0x74) {
      out.push(view.getUint32(i + 8));
    }
  }
  return out;
}

/** The `mvhd` duration, in movie timescale units. */
function movieDuration(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  for (let i = 0; i + 20 < bytes.length; i += 1) {
    if (bytes[i] === 0x6d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) {
      return view.getUint32(i + 20);
    }
  }
  return -1;
}

describe('repairFragmentedMp4', () => {
  it('writes the length MediaRecorder leaves at zero', () => {
    const built = buildMp4([videoTrack(15), audioTrack(15)]);
    expect(movieDuration(built)).toBe(0);

    const { buffer, repair } = repairFragmentedMp4(built);

    expect(repair.patched).toBe(true);
    expect(repair.durationSeconds).toBeCloseTo(15, 1);
    expect(movieDuration(buffer) / MOVIE_TIMESCALE).toBeCloseTo(15, 1);
  });

  it('slides a late sound track back under the picture', () => {
    // The shape of the reported exports: the sound is short by the time it
    // took to start, and short by that same amount from the first fragment on.
    const before = decodeTimes(buildMp4([videoTrack(15), audioTrack(13.65)]));
    const { buffer, repair } = repairFragmentedMp4(buildMp4([videoTrack(15), audioTrack(13.65)]));

    expect(repair.audioLeadSeconds).toBeCloseTo(1.35, 1);

    const after = decodeTimes(buffer);
    // Fragments alternate video, audio, video, audio…: only the audio moves,
    // and every one of its fragments moves by the same amount.
    const shift = (after[1] ?? 0) - (before[1] ?? 0);
    expect(shift / AUDIO_TIMESCALE).toBeCloseTo(1.35, 1);
    after.forEach((value, i) => {
      expect(value).toBe((before[i] ?? 0) + (i % 2 === 1 ? shift : 0));
    });

    // And the file now ends where the picture ends, not where the sound did.
    expect(repair.durationSeconds).toBeCloseTo(15, 1);
    expect(movieDuration(buffer) / MOVIE_TIMESCALE).toBeCloseTo(15, 1);
  });

  it('leaves an already aligned recording where it is', () => {
    const before = decodeTimes(buildMp4([videoTrack(10), audioTrack(9.99)]));
    const { buffer, repair } = repairFragmentedMp4(buildMp4([videoTrack(10), audioTrack(9.99)]));

    expect(repair.patched).toBe(true);
    expect(repair.audioLeadSeconds).toBe(0);
    expect(decodeTimes(buffer)).toEqual(before);
  });

  it('refuses to invent silence when the shortfall is not a late start', () => {
    const { repair } = repairFragmentedMp4(buildMp4([videoTrack(20), audioTrack(1)]));
    expect(repair.audioLeadSeconds).toBe(0);
    // The length is still worth writing: it is measured, not inferred.
    expect(repair.durationSeconds).toBeCloseTo(20, 1);
  });

  it('handles a recording with no sound at all', () => {
    const { buffer, repair } = repairFragmentedMp4(buildMp4([videoTrack(8)]));
    expect(repair.patched).toBe(true);
    expect(repair.audioLeadSeconds).toBe(0);
    expect(movieDuration(buffer) / MOVIE_TIMESCALE).toBeCloseTo(8, 1);
  });

  it('hands back anything that is not a fragmented MP4', () => {
    const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
    const buffer = webm.buffer.slice(0);
    const result = repairFragmentedMp4(buffer);
    expect(result.repair.patched).toBe(false);
    expect(new Uint8Array(result.buffer)).toEqual(webm);
  });

  it('hands back a truncated file rather than writing into it', () => {
    const full = new Uint8Array(buildMp4([videoTrack(15), audioTrack(15)]));
    const cut = full.slice(0, 40);
    const result = repairFragmentedMp4(cut.buffer.slice(cut.byteOffset, cut.byteOffset + cut.byteLength));
    expect(result.repair.patched).toBe(false);
  });
});

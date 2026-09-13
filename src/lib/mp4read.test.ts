import { describe, expect, it } from 'vitest';
import {
  avcCodecString,
  demuxMp4,
  estimateFps,
  hevcCodecString,
  parseAudioSpecificConfig,
} from './mp4read';
import { writeMp4, type MuxSample } from './mp4write';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v >>> 0));
  return out;
}
function u16(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint16(i * 2, v));
  return out;
}
const u8 = (...values: number[]) => Uint8Array.from(values);
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(body.byteLength + 8), enc.encode(type), body]);
}
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) =>
  box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);

/** A fake avcC: version, profile 100 (High), compat 0, level 40. */
const AVCC = u8(1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 0, 1, 0);
/** A fake hvcC for Main profile, level 120: profile 1, compat 0x60000000, constraints 0xB0. */
const HVCC = u8(1, 0x01, 0x60, 0, 0, 0, 0xb0, 0, 0, 0, 0, 0, 120, 0xf0, 0);
/** AudioSpecificConfig: AAC-LC (2), 48 kHz (index 3), stereo (2) → 0x11 0x90. */
const ASC = u8(0x11, 0x90);

/** Samples for the writer: n frames of `bytes` each, at `fps`, key every `gop`. */
function videoSamples(n: number, fps: number, gop: number, bytes = 16): MuxSample[] {
  const step = Math.round(1_000_000 / fps);
  return Array.from({ length: n }, (_, i) => ({
    data: new Uint8Array(bytes).fill(i + 1),
    timestamp: i * step,
    duration: step,
    key: i % gop === 0,
  }));
}
function audioSamples(n: number, sampleRate: number, bytes = 8): MuxSample[] {
  const step = Math.round((1024 * 1_000_000) / sampleRate);
  return Array.from({ length: n }, (_, i) => ({
    data: new Uint8Array(bytes).fill(200 + i),
    timestamp: i * step,
    duration: step,
    key: true,
  }));
}

/**
 * A minimal fragmented MP4 — the shape MediaRecorder writes — with one video
 * track, `trex` defaults and two `moof`s of two samples each.
 */
function fragmentedFixture(): { buffer: ArrayBuffer; payloads: Uint8Array[] } {
  const timescale = 90_000;
  const mdhd = full('mdhd', 0, 0, u32(0, 0, timescale, 0), u16(0x55c4, 0));
  const hdlr = full('hdlr', 0, 0, u32(0), enc.encode('vide'), u32(0, 0, 0), u8(0));
  const avc1 = box(
    'avc1',
    new Uint8Array(6),
    u16(1),
    new Uint8Array(16),
    u16(640, 360),
    u32(0x00480000, 0x00480000, 0),
    u16(1),
    new Uint8Array(32),
    u16(0x18, 0xffff),
    box('avcC', AVCC),
  );
  const stsd = full('stsd', 0, 0, u32(1), avc1);
  const stbl = box(
    'stbl',
    stsd,
    full('stts', 0, 0, u32(0)),
    full('stsc', 0, 0, u32(0)),
    full('stsz', 0, 0, u32(0, 0)),
    full('stco', 0, 0, u32(0)),
  );
  const minf = box('minf', full('vmhd', 0, 1, u16(0, 0, 0, 0)), stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const tkhd = full(
    'tkhd',
    0,
    3,
    u32(0, 0, 1, 0, 0),
    u32(0, 0),
    u16(0, 0, 0, 0),
    u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000),
    u32(640 << 16, 360 << 16),
  );
  const trak = box('trak', tkhd, mdia);
  const mvhd = full('mvhd', 0, 0, u32(0, 0, 1000, 0), u32(0x10000), u16(0x100, 0), u32(0, 0), u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000), new Uint8Array(24), u32(2));
  // trex: default duration 3000 ticks (30 fps), size 0, flags = non-sync.
  const trex = full('trex', 0, 0, u32(1, 1, 3000, 0, 0x00010000));
  const moov = box('moov', mvhd, trak, box('mvex', trex));
  const ftyp = box('ftyp', enc.encode('iso5'), u32(0), enc.encode('iso5iso6mp41'));

  const payloads = [u8(1, 1, 1), u8(2, 2), u8(3, 3, 3, 3), u8(4)];
  const fragment = (index: number, baseTime: number, first: Uint8Array, second: Uint8Array) => {
    const tfhd = full('tfhd', 0, 0x020000, u32(1)); // default-base-is-moof
    const tfdt = full('tfdt', 1, 0, u32(0, baseTime));
    // trun flags: data_offset | first_sample_flags | sample_size
    const trunFlags = 0x000001 | 0x000004 | 0x000200;
    const trunBody = (offset: number) =>
      full('trun', 0, trunFlags, u32(2), u32(offset), u32(0x02000000), u32(first.byteLength, second.byteLength));
    const sizeWithZeroOffset = box('moof', full('mfhd', 0, 0, u32(index)), box('traf', tfhd, tfdt, trunBody(0))).byteLength;
    const moof = box('moof', full('mfhd', 0, 0, u32(index)), box('traf', tfhd, tfdt, trunBody(sizeWithZeroOffset + 8)));
    const mdat = box('mdat', first, second);
    return concat([moof, mdat]);
  };
  const file = concat([ftyp, moov, fragment(1, 0, payloads[0]!, payloads[1]!), fragment(2, 6000, payloads[2]!, payloads[3]!)]);
  return { buffer: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer, payloads };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('codec strings', () => {
  it('spells H.264 as avc1 plus profile, compatibility and level in hex', () => {
    expect(avcCodecString(AVCC)).toBe('avc1.640028');
  });

  it('spells HEVC the way 14496-15 does, with the compatibility flags reversed', () => {
    expect(hevcCodecString(HVCC)).toBe('hvc1.1.6.L120.B0');
    expect(hevcCodecString(HVCC, 'hev1')).toBe('hev1.1.6.L120.B0');
  });

  it('marks the high tier and keeps only the significant constraint bytes', () => {
    const highTier = HVCC.slice();
    highTier[1] = 0x21; // tier bit set, profile 1
    highTier[7] = 0x01;
    expect(hevcCodecString(highTier)).toBe('hvc1.1.6.H120.B0.1');
  });

  it('refuses a truncated configuration record', () => {
    expect(avcCodecString(u8(1))).toBeNull();
    expect(hevcCodecString(u8(1, 2, 3))).toBeNull();
  });
});

describe('parseAudioSpecificConfig', () => {
  it('reads object type, sample rate and channels out of the bit field', () => {
    expect(parseAudioSpecificConfig(ASC)).toEqual({ codec: 'mp4a.40.2', sampleRate: 48000, channels: 2 });
    // 44.1 kHz is index 4: 00010 0100 0010 → 0x12 0x10.
    expect(parseAudioSpecificConfig(u8(0x12, 0x10))).toEqual({ codec: 'mp4a.40.2', sampleRate: 44100, channels: 2 });
  });

  it('reads a 48 kHz mono HE-AAC config', () => {
    // AOT 5 (00101), rate index 3 (0011), channels 1 (0001) → 0010 1001 1000 1000.
    expect(parseAudioSpecificConfig(u8(0x29, 0x88))).toEqual({ codec: 'mp4a.40.5', sampleRate: 48000, channels: 1 });
  });
});

describe('demuxMp4 on a progressive file', () => {
  // 25 fps: 40 000 µs is a whole number of 90 kHz ticks, so nothing rounds.
  const video = videoSamples(90, 25, 30);
  const audio = audioSamples(130, 48000);
  const written = writeMp4({
    video: { width: 640, height: 360, description: AVCC, samples: video },
    audio: { sampleRate: 48000, channels: 2, description: ASC, samples: audio },
  });
  const movie = demuxMp4(written.buffer);

  it('finds both tracks with their codecs and configuration records', () => {
    expect(movie?.video?.codec).toBe('avc1.640028');
    expect(Array.from(movie!.video!.description!)).toEqual(Array.from(AVCC));
    expect(movie?.video?.codedWidth).toBe(640);
    expect(movie?.video?.codedHeight).toBe(360);
    expect(movie?.video?.rotation).toBe(0);
    expect(movie?.audio?.codec).toBe('mp4a.40.2');
    expect(movie?.audio?.sampleRate).toBe(48000);
    expect(movie?.audio?.channels).toBe(2);
    expect(Array.from(movie!.audio!.description!)).toEqual(Array.from(ASC));
  });

  it('returns every sample with its bytes where the tables say they are', () => {
    const samples = movie!.video!.samples;
    expect(samples).toHaveLength(90);
    const bytes = new Uint8Array(written.buffer);
    samples.forEach((s, i) => {
      expect(s.size).toBe(16);
      expect(bytes[s.offset]).toBe(i + 1);
      expect(bytes[s.offset + 15]).toBe(i + 1);
    });
    const sound = movie!.audio!.samples;
    expect(sound).toHaveLength(130);
    expect(bytes[sound[7]!.offset]).toBe(207);
  });

  it('carries timestamps in microseconds, key frames from stss, and the frame rate', () => {
    const samples = movie!.video!.samples;
    expect(samples[0]!.pts).toBe(0);
    expect(samples[1]!.pts).toBe(40_000);
    expect(samples[30]!.pts).toBe(1_200_000);
    expect(samples[1]!.duration).toBe(40_000);
    expect(samples.filter((s) => s.key).map((s) => s.pts)).toEqual([0, 1_200_000, 2_400_000]);
    expect(movie!.video!.fps).toBe(25);
    expect(movie!.duration).toBeCloseTo(3.6, 2);
  });

  it('marks every audio sample as a key sample', () => {
    expect(movie!.audio!.samples.every((s) => s.key)).toBe(true);
  });

  it('applies composition offsets to presentation time', () => {
    // Frames handed over in decode order I P B B: the P is shown last.
    const step = 40_000;
    const reordered: MuxSample[] = [
      { data: u8(1), timestamp: 0, duration: step, key: true },
      { data: u8(2), timestamp: 3 * step, duration: step, key: false },
      { data: u8(3), timestamp: 1 * step, duration: step, key: false },
      { data: u8(4), timestamp: 2 * step, duration: step, key: false },
    ];
    const file = writeMp4({ video: { width: 64, height: 64, description: AVCC, samples: reordered } });
    const parsed = demuxMp4(file.buffer)!.video!;
    expect(parsed.samples.map((s) => s.pts)).toEqual([0, 3 * step, 1 * step, 2 * step]);
    expect(parsed.samples.map((s) => s.dts)).toEqual([0, step, 2 * step, 3 * step]);
    expect(parsed.samples.map((s) => s.key)).toEqual([true, false, false, false]);
  });
});

describe('demuxMp4 on a fragmented file', () => {
  const { buffer, payloads } = fragmentedFixture();
  const movie = demuxMp4(buffer);

  it('walks moof/trun into samples with the right bytes', () => {
    const samples = movie!.video!.samples;
    expect(samples).toHaveLength(4);
    const bytes = new Uint8Array(buffer);
    samples.forEach((s, i) => {
      expect(s.size).toBe(payloads[i]!.byteLength);
      expect(Array.from(bytes.subarray(s.offset, s.offset + s.size))).toEqual(Array.from(payloads[i]!));
    });
  });

  it('takes durations from trex and decode times from tfdt', () => {
    const samples = movie!.video!.samples;
    expect(samples.map((s) => s.dts)).toEqual([0, 33333, 66667, 100000]);
    expect(samples.map((s) => s.pts)).toEqual([0, 33333, 66667, 100000]);
    expect(movie!.video!.fps).toBe(30);
  });

  it('reads sync flags: first_sample_flags for the first, the default after', () => {
    expect(movie!.video!.samples.map((s) => s.key)).toEqual([true, false, true, false]);
  });

  it('reads the codec out of the sample entry', () => {
    expect(movie!.video!.codec).toBe('avc1.640028');
    expect(movie!.audio).toBeNull();
  });
});

describe('demuxMp4 reads the track matrix', () => {
  /** The fragmented fixture again, with the matrix's a, b, c, d replaced. */
  function withMatrix(a: number, b: number, c: number, d: number): ArrayBuffer {
    const { buffer } = fragmentedFixture();
    const bytes = new Uint8Array(buffer);
    // The fixture writes two identity matrices — mvhd's first, then tkhd's.
    // The track's is the last one: 0x10000 0 0 / 0 0x10000 0 / 0 0 0x40000000.
    const view = new DataView(buffer);
    let found = -1;
    for (let p = 0; p + 36 <= bytes.byteLength; p += 4) {
      if (
        view.getUint32(p) === 0x10000 && view.getUint32(p + 4) === 0 && view.getUint32(p + 8) === 0 &&
        view.getUint32(p + 12) === 0 && view.getUint32(p + 16) === 0x10000 && view.getUint32(p + 32) === 0x40000000
      ) {
        found = p;
      }
    }
    if (found < 0) throw new Error('matrix not found');
    view.setInt32(found, a * 65536);
    view.setInt32(found + 4, b * 65536);
    view.setInt32(found + 12, c * 65536);
    view.setInt32(found + 16, d * 65536);
    return buffer;
  }

  it('reads the four rotations a phone writes', () => {
    expect(demuxMp4(withMatrix(1, 0, 0, 1))!.video!.rotation).toBe(0);
    expect(demuxMp4(withMatrix(0, 1, -1, 0))!.video!.rotation).toBe(90);
    expect(demuxMp4(withMatrix(-1, 0, 0, -1))!.video!.rotation).toBe(180);
    expect(demuxMp4(withMatrix(0, -1, 1, 0))!.video!.rotation).toBe(270);
  });
});

describe('demuxMp4 rejects what it cannot read', () => {
  it('answers null for something that is not an MP4', () => {
    expect(demuxMp4(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer)).toBeNull();
  });
});

describe('estimateFps', () => {
  it('uses the median gap, so a few long frames do not change the answer', () => {
    const step = 16_667;
    const samples = Array.from({ length: 20 }, (_, i) => ({
      offset: 0,
      size: 1,
      dts: i * step,
      pts: i * step + (i === 5 ? 50_000 : 0),
      duration: step,
      key: true,
    }));
    expect(estimateFps(samples)).toBe(60);
  });

  it('answers zero for a single frame', () => {
    expect(estimateFps([{ offset: 0, size: 1, dts: 0, pts: 0, duration: 0, key: true }])).toBe(0);
  });
});

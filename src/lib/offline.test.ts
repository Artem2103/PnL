import { describe, expect, it } from 'vitest';
import { copyAudio, countFrames, decodeRange, displaySize, placeFrame, trimAudio } from './offline';
import type { DemuxedAudioTrack, DemuxedSample, DemuxedVideoTrack } from './mp4read';
import { bitrateFor } from './recorders';

const STEP = 33_333;

function frames(n: number, gop = 10): DemuxedSample[] {
  return Array.from({ length: n }, (_, i) => ({
    offset: i * 100,
    size: 100,
    dts: i * STEP,
    pts: i * STEP,
    duration: STEP,
    key: i % gop === 0,
  }));
}

describe('copyAudio', () => {
  const PACKET = 21_333; // 1024 frames at 48 kHz
  /** 120 AAC packets of 10 bytes, each filled with its index, starting at `lead` µs. */
  function sound(lead: number, codec = 'mp4a.40.2'): { bytes: ArrayBuffer; track: DemuxedAudioTrack } {
    const bytes = new Uint8Array(1200).map((_, at) => Math.floor(at / 10));
    const samples = Array.from({ length: 120 }, (_, i) => ({
      offset: i * 10,
      size: 10,
      dts: i * PACKET + lead,
      pts: i * PACKET + lead,
      duration: PACKET,
      key: true,
    }));
    const track: DemuxedAudioTrack = {
      kind: 'audio',
      id: 2,
      codec,
      description: Uint8Array.from([0x11, 0x90]),
      sampleRate: 48000,
      channels: 2,
      samples,
    };
    return { bytes: bytes.buffer, track };
  }

  it('keeps the packet before the window and trims to the window by the edit', () => {
    // A phone clip: the encoder's priming puts the first packet at −44 ms.
    const { bytes, track } = sound(-44_000);
    const copied = copyAudio(bytes, track, 1_000_000, 2_000_000)!;
    // Packet 48 (979 984 µs) straddles the start; packet 47 is kept for the overlap.
    expect(copied.samples).toHaveLength(49);
    expect(copied.samples[0]!.data[0]).toBe(47);
    expect(copied.samples[0]!.timestamp).toBe(47 * PACKET - 44_000 - 1_000_000);
    expect(copied.samples[48]!.data[0]).toBe(95);
    expect(copied.trimStartUs).toBe(1_000_000 - (47 * PACKET - 44_000));
    // Presented from the window's first instant to its last.
    expect(copied.samples[0]!.timestamp + copied.trimStartUs!).toBe(0);
    expect(copied.trimLengthUs).toBe(1_000_000);
    expect(copied.sampleRate).toBe(48000);
  });

  it('presents sound that starts inside the window where it starts', () => {
    const { bytes, track } = sound(200_000);
    const copied = copyAudio(bytes, track, 0, 1_000_000)!;
    expect(copied.samples[0]!.timestamp).toBe(200_000);
    expect(copied.trimStartUs).toBe(0);
    expect(copied.trimLengthUs).toBe(800_000);
  });

  it('writes HE-AAC at the rate and channel count it plays at, not its header', () => {
    const { bytes, track } = sound(0, 'mp4a.40.29');
    const heaac = { ...track, sampleRate: 22050, channels: 1 };
    const copied = copyAudio(bytes, heaac, 0, 1_000_000)!;
    expect(copied.sampleRate).toBe(44100);
    expect(copied.channels).toBe(2);
    const plain = copyAudio(bytes, { ...track, codec: 'mp4a.40.2', sampleRate: 22050, channels: 1 }, 0, 1_000_000)!;
    expect(plain.sampleRate).toBe(22050);
    expect(plain.channels).toBe(1);
  });

  it('copies only AAC, and nothing for a window with no sound in it', () => {
    const opus = sound(0, 'opus');
    expect(copyAudio(opus.bytes, opus.track, 0, 1_000_000)).toBeNull();
    const aac = sound(0);
    expect(copyAudio(aac.bytes, aac.track, 10_000_000, 11_000_000)).toBeNull();
  });

  it('refuses packets that point past the end of the file', () => {
    const { track } = sound(0);
    expect(copyAudio(new ArrayBuffer(100), track, 0, 1_000_000)).toBeNull();
  });
});

describe('decodeRange', () => {
  it('starts on the key frame before the first wanted sample and ends on the last', () => {
    const range = decodeRange(frames(60), 15 * STEP + 1, 40 * STEP);
    expect(range).toEqual({ first: 10, last: 39 });
  });

  it('includes a frame that straddles the window start', () => {
    // Frame 15 runs from 15·STEP to 16·STEP; a start just after 15·STEP wants it.
    const range = decodeRange(frames(60), 15 * STEP + 5, 16 * STEP);
    expect(range).toEqual({ first: 10, last: 15 });
  });

  it('widens to decode order when the wanted frames were reordered', () => {
    // Decode order I P B B; the B at pts 1·STEP is decoded after the P at 3·STEP.
    const reordered: DemuxedSample[] = [
      { offset: 0, size: 1, dts: 0, pts: 0, duration: STEP, key: true },
      { offset: 0, size: 1, dts: STEP, pts: 3 * STEP, duration: STEP, key: false },
      { offset: 0, size: 1, dts: 2 * STEP, pts: 1 * STEP, duration: STEP, key: false },
      { offset: 0, size: 1, dts: 3 * STEP, pts: 2 * STEP, duration: STEP, key: false },
    ];
    expect(decodeRange(reordered, 1 * STEP, 2 * STEP)).toEqual({ first: 0, last: 2 });
  });

  it('answers null for a window past the end', () => {
    expect(decodeRange(frames(10), 20 * STEP, 30 * STEP)).toBeNull();
  });
});

describe('placeFrame', () => {
  it('rebases a frame inside the window to the window start', () => {
    expect(placeFrame(20 * STEP, STEP, 10 * STEP, 30 * STEP)).toEqual({ timestamp: 10 * STEP, duration: STEP });
  });

  it('clamps the first frame to the start and trims the last to the end', () => {
    expect(placeFrame(9 * STEP + 10_000, STEP, 10 * STEP, 30 * STEP)).toEqual({
      timestamp: 0,
      duration: 10_000,
    });
    expect(placeFrame(29 * STEP + 20_000, STEP, 10 * STEP, 30 * STEP)).toEqual({
      timestamp: 19 * STEP + 20_000,
      duration: STEP - 20_000,
    });
  });

  it('leaves out frames entirely before or after', () => {
    expect(placeFrame(0, STEP, 10 * STEP, 30 * STEP)).toBeNull();
    expect(placeFrame(30 * STEP, STEP, 10 * STEP, 30 * STEP)).toBeNull();
  });
});

describe('countFrames', () => {
  it('counts what placeFrame keeps', () => {
    expect(countFrames(frames(60), 10 * STEP, 40 * STEP)).toBe(30);
    expect(countFrames(frames(60), 10 * STEP + 1, 40 * STEP)).toBe(30);
  });
});

describe('trimAudio', () => {
  it('keeps a buffer wholly inside the window and rebases it', () => {
    expect(trimAudio(2_000_000, 1024, 48000, 1_000_000, 5_000_000)).toEqual({
      skip: 0,
      take: 1024,
      timestamp: 1_000_000,
    });
  });

  it('drops the part before the start to the sample', () => {
    // 1024 frames at 48 kHz = 21 333 µs; start 10 000 µs in = 480 frames.
    const cut = trimAudio(0, 1024, 48000, 10_000, 5_000_000);
    expect(cut).toEqual({ skip: 480, take: 544, timestamp: 0 });
  });

  it('cuts the last buffer at the window end', () => {
    const cut = trimAudio(4_990_000, 1024, 48000, 0, 5_000_000);
    expect(cut).toEqual({ skip: 0, take: 480, timestamp: 4_990_000 });
  });

  it('answers null for a buffer outside the window', () => {
    expect(trimAudio(6_000_000, 1024, 48000, 0, 5_000_000)).toBeNull();
    expect(trimAudio(0, 1024, 48000, 30_000, 5_000_000)).toBeNull();
  });
});

describe('displaySize', () => {
  const track = (rotation: DemuxedVideoTrack['rotation']): DemuxedVideoTrack => ({
    kind: 'video',
    id: 1,
    codec: 'avc1.640028',
    description: null,
    codedWidth: 1920,
    codedHeight: 1080,
    rotation,
    fps: 30,
    samples: [],
  });

  it('swaps the sides for a sideways matrix', () => {
    expect(displaySize(track(0))).toEqual({ width: 1920, height: 1080 });
    expect(displaySize(track(90))).toEqual({ width: 1080, height: 1920 });
    expect(displaySize(track(180))).toEqual({ width: 1920, height: 1080 });
    expect(displaySize(track(270))).toEqual({ width: 1080, height: 1920 });
  });
});

describe('bitrateFor', () => {
  it('budgets the card at 2× around 10 Mbit/s at 30 fps and more, not double, at 60', () => {
    const at30 = bitrateFor(1680, 1140, 30);
    const at60 = bitrateFor(1680, 1140, 60);
    expect(at30).toBeGreaterThan(9_000_000);
    expect(at30).toBeLessThan(12_000_000);
    expect(at60).toBeGreaterThan(at30);
    expect(at60).toBeLessThan(at30 * 2);
  });

  it('never goes under the floor or over the cap', () => {
    expect(bitrateFor(320, 200, 30)).toBe(6_000_000);
    expect(bitrateFor(4000, 4000, 60)).toBe(24_000_000);
  });
});

/**
 * Frame-exact video export.
 *
 * The recorder in `video.ts` plays the clip in a `<video>` and samples a
 * canvas thirty times a second while it does. That is a live recording, and
 * it has a live recording's weakness: it can only keep the frames the machine
 * manages to show. On a laptop whose one GPU is decoding a 60 fps HEVC clip
 * twice (the preview and the export), painting a 1680 × 1140 canvas and
 * running the H.264 encoder, the `<video>` fell to 10–20 frames a second and
 * so did the file — and because the picture stalls while the sound carries on,
 * the two drift apart on screen and in the export.
 *
 * This path never plays anything. It reads the clip's sample tables
 * (`lib/mp4read.ts`), hands every sample in the chosen window to a
 * `VideoDecoder`, paints the card over each decoded frame exactly once — the
 * same `renderToCanvas` as the preview and the PNG — and encodes that with a
 * `VideoEncoder`, stamped with the source frame's own timestamp. The sound is
 * decoded from the same file with an `AudioDecoder`, trimmed to the window
 * to the sample, and re-encoded on the same timeline. So:
 *
 * - every source frame is in the file, at the source's frame rate (a 60 fps
 *   clip gives a 60 fps card), however busy the machine is;
 * - the picture and the sound come from the same timestamps and cannot drift;
 * - it runs as fast as the codecs allow rather than in real time, and does not
 *   need the window in front;
 * - the first frame is the window's first frame — nothing to pre-roll.
 *
 * What it needs: `VideoDecoder`, `VideoEncoder`, `AudioDecoder` and
 * `AudioEncoder` (Chrome, Edge, Safari 16.4+), and a clip in an MP4 or MOV
 * container with H.264 or HEVC video and AAC sound (any profile, any rate — a
 * rate the AAC encoder refuses is resampled, `lib/resample.ts`). Anything else — WebM, a
 * codec the machine will not decode, a decoder that fails mid-way — throws
 * `OfflineUnavailable`, and `renderCardVideo` falls back to the recorder.
 */

import type { CardState, RenderAssets } from '../types';
import { demuxMp4, type DemuxedAudioTrack, type DemuxedSample, type DemuxedVideoTrack } from './mp4read';
import { writeMp4, type MuxSample } from './mp4write';
import { bitrateFor, planWebCodecs } from './recorders';
import { renderToCanvas } from './render';
import { resample } from './resample';

/** Key frame every two seconds, as the live recorder writes them. */
const KEYFRAME_US = 2_000_000;
/** AAC-LC at 192 kbit/s stereo is transparent; mono needs less. */
const AUDIO_BITRATE_STEREO = 192_000;
const AUDIO_BITRATE_MONO = 128_000;
/** Frames per buffer handed to the encoder when the sound had to be resampled. */
const CONVERTED_CHUNK = 1024;
/** Decoded frames waiting to be painted before decoding pauses. */
const MAX_PENDING_FRAMES = 4;
const MAX_DECODE_QUEUE = 6;
const MAX_ENCODE_QUEUE = 8;
/** A codec that answers nothing for this long has hung; give up on this path. */
const STALL_MS = 8_000;
/** Files faster than this are treated as this: nothing a card is posted to plays more. */
export const MAX_OUTPUT_FPS = 60;

/** The offline path cannot run here; record the live way instead. */
export class OfflineUnavailable extends Error {}

export interface OfflineExportOptions {
  /** The clip's bytes, as uploaded. */
  bytes: ArrayBuffer;
  state: CardState;
  /** Avatar and logo already resolved; the artwork slot is replaced per frame. */
  assets: RenderAssets;
  /** Design units × scale = output pixels. */
  scale: number;
  /** Window inside the clip, seconds. */
  clipStart: number;
  clipLength: number;
  muteAudio: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface OfflineExportResult {
  blob: Blob;
  width: number;
  height: number;
  /** Seconds, as the file states. */
  duration: number;
  videoSeconds: number;
  audioSeconds: number;
  /** Frames written. */
  frames: number;
  /** Frames per second of the source, which is what the file carries. */
  fps: number;
  /** Wall-clock seconds the export took. */
  elapsed: number;
}

/* ------------------------------------------------------------------ */
/* Pure helpers, so the window arithmetic can be tested                */
/* ------------------------------------------------------------------ */

/**
 * The slice of a track to decode for a window: from the last key frame at or
 * before the first wanted sample (in decode order), to the last wanted one.
 * With B-frames a sample the window wants may be decoded later than one it
 * does not, so both ends are found on presentation times and then widened to
 * decode order.
 */
export function decodeRange(
  samples: DemuxedSample[],
  startUs: number,
  endUs: number,
): { first: number; last: number } | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i]!;
    if (s.pts + s.duration > startUs && s.pts < endUs) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  while (first > 0 && !samples[first]!.key) first -= 1;
  return { first, last };
}

/**
 * Where a source frame lands on the output timeline, or null when it is
 * outside the window. The frame that straddles the start is clamped to it,
 * so the file opens on the window's first instant; the last is cut to the
 * window's end.
 */
export function placeFrame(
  pts: number,
  duration: number,
  startUs: number,
  endUs: number,
): { timestamp: number; duration: number } | null {
  if (pts >= endUs || pts + duration <= startUs) return null;
  const from = Math.max(pts, startUs);
  const to = Math.min(pts + duration, endUs);
  if (to <= from) return null;
  return { timestamp: from - startUs, duration: to - from };
}

/** How many source frames a window holds — the denominator for progress. */
export function countFrames(samples: DemuxedSample[], startUs: number, endUs: number): number {
  let n = 0;
  for (const s of samples) if (placeFrame(s.pts, s.duration, startUs, endUs)) n += 1;
  return n;
}

/**
 * The part of a decoded audio buffer inside the window, in sample frames.
 * `skip` is what to drop from the front; `take` is how many to keep.
 */
export function trimAudio(
  timestampUs: number,
  frames: number,
  sampleRate: number,
  startUs: number,
  endUs: number,
): { skip: number; take: number; timestamp: number } | null {
  const toFrames = (us: number) => Math.round((us * sampleRate) / 1_000_000);
  const skip = Math.min(frames, Math.max(0, toFrames(startUs - timestampUs)));
  const until = Math.min(frames, Math.max(0, toFrames(endUs - timestampUs)));
  const take = until - skip;
  if (take <= 0) return null;
  const timestamp = Math.max(0, timestampUs + Math.round((skip * 1_000_000) / sampleRate) - startUs);
  return { skip, take, timestamp };
}

/* ------------------------------------------------------------------ */
/* Waiting on codecs without ever hanging                              */
/* ------------------------------------------------------------------ */

type Queued = { encodeQueueSize: number } | { decodeQueueSize: number };

function queueSize(codec: Queued): number {
  return 'encodeQueueSize' in codec ? codec.encodeQueueSize : codec.decodeQueueSize;
}

/** Resolves once the codec's queue is under `limit`; rejects if it stops draining. */
function drain(codec: Queued & EventTarget, limit: number, failure: () => Error | null): Promise<void> {
  if (queueSize(codec) <= limit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      codec.removeEventListener('dequeue', check);
      reject(new OfflineUnavailable('The codec stopped responding.'));
    }, STALL_MS);
    const check = () => {
      const failed = failure();
      if (failed) {
        clearTimeout(timer);
        codec.removeEventListener('dequeue', check);
        reject(failed);
        return;
      }
      if (queueSize(codec) <= limit) {
        clearTimeout(timer);
        codec.removeEventListener('dequeue', check);
        resolve();
      }
    };
    codec.addEventListener('dequeue', check);
  });
}

function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new OfflineUnavailable(`${what} did not finish.`)), STALL_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function toBytes(description: AllowSharedBufferSource): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description.slice(0));
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(
      description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength),
    );
  }
  return new Uint8Array(0);
}

const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Where the time goes, per export, in milliseconds. Development only: read
 * `window.__pnlExportStats` after an export. Zero cost in production.
 */
interface ExportStats {
  paint: number;
  capture: number;
  encode: number;
  waitDecoder: number;
  waitEncoder: number;
  audio: number;
  total: number;
  frames: number;
}
const stats: ExportStats = { paint: 0, capture: 0, encode: 0, waitDecoder: 0, waitEncoder: 0, audio: 0, total: 0, frames: 0 };
const timing = import.meta.env.DEV;
const now = () => (timing ? performance.now() : 0);

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

interface EncodedAudio {
  description: Uint8Array;
  samples: MuxSample[];
  sampleRate: number;
  channels: number;
}

async function transcodeAudio(
  bytes: ArrayBuffer,
  track: DemuxedAudioTrack,
  startUs: number,
  endUs: number,
  signal: AbortSignal | undefined,
): Promise<EncodedAudio | null> {
  if (!track.codec || !track.description || !track.sampleRate || !track.channels) return null;
  if (typeof AudioDecoder !== 'function' || typeof AudioEncoder !== 'function') return null;

  const decoderConfig: AudioDecoderConfig = {
    codec: track.codec,
    sampleRate: track.sampleRate,
    numberOfChannels: track.channels,
    description: track.description,
  };
  const encoderConfigFor = (
    sampleRate: number,
    channels: number,
  ): AudioEncoderConfig & { aac?: { format: string } } => ({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: channels >= 2 ? AUDIO_BITRATE_STEREO : AUDIO_BITRATE_MONO,
    aac: { format: 'aac' },
  });
  // Only the decoder can be asked up front. The encoder is chosen from what the
  // decoder actually produces, which the header does not say: an HE-AAC v2
  // clip's header reads 22.05 kHz mono and it decodes to 44.1 kHz stereo.
  // Asking the encoder about the header's numbers turned every such clip —
  // most TikTok downloads — away to the live recorder.
  try {
    if (!(await AudioDecoder.isConfigSupported(decoderConfig)).supported) return null;
  } catch {
    return null;
  }

  interface Encoding {
    rate: number;
    channels: number;
    /** The decoded sound has to be resampled (or narrowed) to reach it. */
    convert: boolean;
  }
  /**
   * The decoded format when the encoder takes it, which is nearly always;
   * otherwise the nearest one it does. Chrome's AAC encoder takes 44.1 and
   * 48 kHz only, so AAC at 22.05, 32 or 96 kHz is resampled rather than
   * sending the whole export to the live recorder.
   */
  const chooseEncoding = async (rate: number, channels: number): Promise<Encoding | null> => {
    const stereo = Math.min(channels, 2);
    const candidates: Array<[number, number]> = [
      [rate, channels],
      [48000, channels],
      [44100, channels],
      [48000, stereo],
      [44100, stereo],
    ];
    for (const [r, c] of candidates) {
      try {
        if ((await AudioEncoder.isConfigSupported(encoderConfigFor(r, c))).supported) {
          return { rate: r, channels: c, convert: r !== rate || c !== channels };
        }
      } catch {
        /* try the next */
      }
    }
    return null;
  };

  const range = decodeRange(track.samples, startUs, endUs);
  if (!range) return null;
  // AAC frames overlap their neighbours, so the one before the window is
  // decoded too and trimmed away — otherwise the first 20 ms are not right.
  const first = Math.max(0, range.first - 1);

  let failure: Error | null = null;
  const fail = (error: unknown) => {
    if (!failure) failure = error instanceof Error ? error : new Error(String(error));
  };
  let description: Uint8Array | null = null;
  const samples: MuxSample[] = [];
  const pending: AudioData[] = [];
  // Cast, not annotated: both are set inside callbacks, which TypeScript's
  // narrowing cannot see, and an annotated `null` would read as `never` below.
  let encoding = null as Encoding | null;
  let decodedRate = 0;
  /** Sound waiting to be resampled, per output channel, in window order. */
  const collected: Float32Array[][] = [];
  let collectedFrom = -1;
  /**
   * Where the next decoded buffer sits on the clip's timeline, in output
   * sample frames. Kept by counting rather than read off each buffer: the
   * decoder restarts its output clock at zero, so a stream whose edit list
   * puts its first frame *before* zero — every clip off a phone, by the AAC
   * encoder's priming — came out 48 ms late when its timestamps were trusted.
   * AAC decodes to a fixed run of frames per packet with nothing skipped, so
   * counting from the first packet's own time is exact to the sample.
   */
  let cursor = 0;
  const firstPts = track.samples[first]!.pts;

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const desc = metadata?.decoderConfig?.description;
      if (desc && !description) description = toBytes(desc);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0, key: true });
    },
    error: fail,
  });
  const decoder = new AudioDecoder({ output: (data) => pending.push(data), error: fail });

  const encodeTrimmed = (data: AudioData): void => {
    try {
      const timestampUs = Math.round((cursor * 1_000_000) / decodedRate);
      cursor += data.numberOfFrames;
      const cut = trimAudio(timestampUs, data.numberOfFrames, data.sampleRate, startUs, endUs);
      if (!cut) return;
      if (encoding!.convert) {
        // Kept as float, one plane per channel, and resampled in one pass once
        // the window is complete, so no buffer boundary can leave a seam.
        if (collectedFrom < 0) collectedFrom = cut.timestamp;
        for (let c = 0; c < encoding!.channels; c += 1) {
          const plane = new Float32Array(cut.take);
          data.copyTo(plane, { planeIndex: c, format: 'f32-planar', frameOffset: cut.skip, frameCount: cut.take });
          (collected[c] ??= []).push(plane);
        }
        return;
      }
      const planar = data.format?.endsWith('-planar') ?? false;
      const planes = planar ? data.numberOfChannels : 1;
      const sizes: number[] = [];
      let total = 0;
      for (let p = 0; p < planes; p += 1) {
        const size = data.allocationSize({ planeIndex: p, frameOffset: cut.skip, frameCount: cut.take });
        sizes.push(size);
        total += size;
      }
      const buffer = new Uint8Array(total);
      let at = 0;
      for (let p = 0; p < planes; p += 1) {
        data.copyTo(buffer.subarray(at, at + sizes[p]!), {
          planeIndex: p,
          frameOffset: cut.skip,
          frameCount: cut.take,
        });
        at += sizes[p]!;
      }
      const trimmed = new AudioData({
        format: data.format ?? 'f32-planar',
        sampleRate: data.sampleRate,
        numberOfFrames: cut.take,
        numberOfChannels: data.numberOfChannels,
        timestamp: cut.timestamp,
        data: buffer,
      });
      try {
        encoder.encode(trimmed);
      } finally {
        trimmed.close();
      }
    } catch (error) {
      fail(error);
    } finally {
      data.close();
    }
  };

  const drainPending = async () => {
    while (pending.length) {
      if (!encoding) {
        const head = pending[0]!;
        encoding = await chooseEncoding(head.sampleRate, head.numberOfChannels);
        if (!encoding) throw new OfflineUnavailable('No AAC encoder here takes this sound.');
        decodedRate = head.sampleRate;
        cursor = Math.round((firstPts * decodedRate) / 1_000_000);
        encoder.configure(encoderConfigFor(encoding.rate, encoding.channels));
      }
      encodeTrimmed(pending.shift()!);
      await drain(encoder, MAX_ENCODE_QUEUE, () => failure);
    }
  };

  const encodeConverted = async (target: Encoding) => {
    const planes = collected.map((chunks) => {
      const joined = new Float32Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
      let at = 0;
      for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.length;
      }
      return resample(joined, decodedRate, target.rate);
    });
    const frames = planes[0]?.length ?? 0;
    for (let at = 0; at < frames; at += CONVERTED_CHUNK) {
      if (signal?.aborted) throw new OfflineUnavailable('Export cancelled.');
      if (failure) throw failure;
      const take = Math.min(CONVERTED_CHUNK, frames - at);
      const buffer = new Float32Array(take * target.channels);
      planes.forEach((plane, c) => buffer.set(plane.subarray(at, at + take), c * take));
      const chunk = new AudioData({
        format: 'f32-planar',
        sampleRate: target.rate,
        numberOfFrames: take,
        numberOfChannels: target.channels,
        timestamp: collectedFrom + Math.round((at * 1_000_000) / target.rate),
        data: buffer,
      });
      try {
        encoder.encode(chunk);
      } finally {
        chunk.close();
      }
      await drain(encoder, MAX_ENCODE_QUEUE, () => failure);
    }
  };

  try {
    decoder.configure(decoderConfig);
    for (let i = first; i <= range.last; i += 1) {
      if (signal?.aborted) throw new OfflineUnavailable('Export cancelled.');
      if (failure) throw failure;
      const s = track.samples[i]!;
      decoder.decode(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: s.pts,
          duration: s.duration,
          data: new Uint8Array(bytes, s.offset, s.size),
        }),
      );
      await drain(decoder, MAX_DECODE_QUEUE, () => failure);
      await drainPending();
    }
    await bounded(decoder.flush(), 'The sound decoder');
    await drainPending();
    if (encoding?.convert) await encodeConverted(encoding);
    if (encoder.state === 'configured') await bounded(encoder.flush(), 'The sound encoder');
    if (failure) throw failure;
  } finally {
    for (const data of pending) data.close();
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch {
      /* closed */
    }
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      /* closed */
    }
  }

  if (!description || !samples.length) return null;
  return { description, samples, sampleRate: encoding!.rate, channels: encoding!.channels };
}

/* ------------------------------------------------------------------ */
/* Picture                                                             */
/* ------------------------------------------------------------------ */

/**
 * A frame the way the track matrix says to show it. Decoders hand back the
 * stored picture; a phone that filmed upright stores it sideways and asks the
 * player to turn it. A `<video>` does; a `VideoFrame` does not, so it is
 * turned here, once, into a canvas the card then draws from.
 */
function orient(frame: VideoFrame, rotation: number, into: HTMLCanvasElement): CanvasImageSource {
  if (rotation === 0) return frame;
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  const ctx = into.getContext('2d');
  if (!ctx) return frame;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(into.width / 2, into.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(frame, -w / 2, -h / 2, w, h);
  return into;
}

export function displaySize(track: DemuxedVideoTrack): { width: number; height: number } {
  const sideways = track.rotation === 90 || track.rotation === 270;
  return sideways
    ? { width: track.codedHeight, height: track.codedWidth }
    : { width: track.codedWidth, height: track.codedHeight };
}

/**
 * Runs the export. Throws `OfflineUnavailable` for anything the live recorder
 * should handle instead; other errors are the export failing outright.
 */
export async function exportOffline(options: OfflineExportOptions): Promise<OfflineExportResult> {
  const { bytes, state, scale, signal } = options;
  if (typeof VideoDecoder !== 'function' || typeof VideoEncoder !== 'function') {
    throw new OfflineUnavailable('WebCodecs decoders are not available here.');
  }
  const movie = demuxMp4(bytes);
  const track = movie?.video;
  if (!movie || !track) throw new OfflineUnavailable('Not an MP4 this exporter can read.');
  if (!track.codec || !track.description) {
    throw new OfflineUnavailable(`The clip's video codec is not one this exporter reads.`);
  }

  const startUs = Math.round(options.clipStart * 1_000_000);
  const endUs = startUs + Math.round(options.clipLength * 1_000_000);
  const range = decodeRange(track.samples, startUs, endUs);
  if (!range) throw new OfflineUnavailable('The clip window holds no frames.');
  const total = countFrames(track.samples, startUs, endUs);

  const decoderConfig: VideoDecoderConfig = {
    codec: track.codec,
    description: track.description,
    codedWidth: track.codedWidth,
    codedHeight: track.codedHeight,
    hardwareAcceleration: 'no-preference',
    optimizeForLatency: false,
  };
  try {
    const support = await VideoDecoder.isConfigSupported(decoderConfig);
    if (!support.supported) throw new OfflineUnavailable(`This machine cannot decode ${track.codec}.`);
  } catch (error) {
    if (error instanceof OfflineUnavailable) throw error;
    throw new OfflineUnavailable(`This machine cannot decode ${track.codec}.`);
  }

  const source = displaySize(track);
  const fps = Math.min(MAX_OUTPUT_FPS, Math.max(1, Math.round(track.fps || 30)));
  const canvas = document.createElement('canvas');
  const assets: RenderAssets = {
    ...options.assets,
    artwork: {
      kind: 'video',
      element: canvas, // replaced per frame
      width: source.width,
      height: source.height,
      duration: movie.duration,
    },
  };
  // Sizes the canvas before the encoder is planned around it.
  renderToCanvas(canvas, state, assets, scale);
  const bitrate = bitrateFor(canvas.width, canvas.height, fps);
  const plan = await planWebCodecs(canvas.width, canvas.height, fps, bitrate, null);
  if (!plan) throw new OfflineUnavailable('This machine has no H.264 encoder for WebCodecs.');

  const startedAt = performance.now();

  // Sound first: it is a fraction of the work and tells us early whether the
  // whole path is usable, before a minute of picture has been decoded.
  let audio: EncodedAudio | null = null;
  if (!options.muteAudio && movie.audio) {
    const t0 = now();
    audio = await transcodeAudio(bytes, movie.audio, startUs, endUs, signal);
    if (!audio) throw new OfflineUnavailable('The sound could not be decoded here.');
    if (timing) stats.audio = now() - t0;
  }
  if (timing) {
    stats.paint = stats.capture = stats.encode = stats.waitDecoder = stats.waitEncoder = stats.frames = 0;
  }

  const rotated = track.rotation !== 0 ? document.createElement('canvas') : null;
  if (rotated) {
    rotated.width = source.width;
    rotated.height = source.height;
  }

  let failure: Error | null = null;
  const fail = (error: unknown) => {
    if (!failure) failure = error instanceof Error ? error : new Error(String(error));
  };
  let description: Uint8Array | null = null;
  const videoSamples: MuxSample[] = [];
  const pending: VideoFrame[] = [];
  let written = 0;
  let lastKeyAt = -Infinity;
  let lastReported = 0;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const desc = metadata?.decoderConfig?.description;
      if (desc && !description) description = toBytes(desc);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      videoSamples.push({
        data,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? 0,
        key: chunk.type === 'key',
      });
    },
    error: fail,
  });
  const decoder = new VideoDecoder({ output: (frame) => pending.push(frame), error: fail });

  const paintAndEncode = (frame: VideoFrame): void => {
    try {
      const placed = placeFrame(frame.timestamp, frame.duration ?? 0, startUs, endUs);
      if (!placed) return;
      const t0 = now();
      assets.artwork!.element = orient(frame, track.rotation, rotated ?? canvas) as never;
      renderToCanvas(canvas, state, assets, scale);
      const t1 = now();
      const out = new VideoFrame(canvas, { timestamp: placed.timestamp, duration: placed.duration });
      const t2 = now();
      const key = placed.timestamp - lastKeyAt >= KEYFRAME_US;
      try {
        encoder.encode(out, { keyFrame: key });
      } finally {
        out.close();
      }
      if (timing) {
        stats.paint += t1 - t0;
        stats.capture += t2 - t1;
        stats.encode += now() - t2;
        stats.frames += 1;
      }
      if (key) lastKeyAt = placed.timestamp;
      written += 1;
    } catch (error) {
      fail(error);
    } finally {
      frame.close();
    }
  };

  const drainPending = async () => {
    while (pending.length) {
      paintAndEncode(pending.shift()!);
      const t0 = now();
      await drain(encoder, MAX_ENCODE_QUEUE, () => failure);
      if (timing) stats.waitEncoder += now() - t0;
    }
    if (total > 0 && written - lastReported >= Math.max(1, Math.floor(total / 50))) {
      lastReported = written;
      options.onProgress?.(Math.min(1, written / total));
      // Lets the progress bar paint; the codecs carry on in their own threads.
      await yieldToEvents();
    }
  };

  try {
    decoder.configure(decoderConfig);
    encoder.configure(plan.videoConfig);
    for (let i = range.first; i <= range.last; i += 1) {
      if (signal?.aborted) throw new Error('Export cancelled.');
      if (failure) throw failure;
      const s = track.samples[i]!;
      decoder.decode(
        new EncodedVideoChunk({
          type: s.key ? 'key' : 'delta',
          timestamp: s.pts,
          duration: s.duration,
          data: new Uint8Array(bytes, s.offset, s.size),
        }),
      );
      const t0 = now();
      await drain(decoder, MAX_DECODE_QUEUE, () => failure);
      if (timing) stats.waitDecoder += now() - t0;
      if (pending.length >= MAX_PENDING_FRAMES || decoder.decodeQueueSize === 0) await drainPending();
    }
    await bounded(decoder.flush(), 'The video decoder');
    await drainPending();
    await bounded(encoder.flush(), 'The video encoder');
    if (failure) throw failure;
  } catch (error) {
    // A decoder that refused the stream, or a codec that hung, before a single
    // frame came out: the live recorder can still do this one. Anything after
    // that is a failure of this export.
    if (written === 0 && !(error instanceof OfflineUnavailable) && !signal?.aborted) {
      throw new OfflineUnavailable(error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally {
    for (const frame of pending) frame.close();
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch {
      /* closed */
    }
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      /* closed */
    }
  }

  if (!description) throw new OfflineUnavailable('The encoder produced no stream description.');
  if (!videoSamples.length) throw new OfflineUnavailable('The encoder produced no frames.');

  const file = writeMp4({
    video: { width: canvas.width, height: canvas.height, description, samples: videoSamples },
    audio: audio
      ? {
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          description: audio.description,
          samples: audio.samples,
        }
      : null,
  });
  options.onProgress?.(1);
  if (timing) {
    stats.total = performance.now() - startedAt;
    (window as unknown as { __pnlExportStats?: ExportStats }).__pnlExportStats = { ...stats };
  }
  return {
    blob: new Blob([file.buffer], { type: 'video/mp4' }),
    width: canvas.width,
    height: canvas.height,
    duration: file.durationSeconds,
    videoSeconds: file.videoSeconds,
    audioSeconds: file.audioSeconds,
    frames: written,
    fps,
    elapsed: (performance.now() - startedAt) / 1000,
  };
}

/**
 * Exports the video studio's timeline: several clips one after another, the
 * card over them, and the clips' own sound mixed with any number of added
 * tracks, as one MP4.
 *
 * The picture works the way the frame-exact exporter does (`lib/offline.ts`):
 * every sample in each clip's window is decoded with a `VideoDecoder`, painted
 * once through `paintStudioFrame` and encoded at the source frame's own time,
 * shifted by where the clip sits on the timeline. Nothing is played, so every
 * frame is in the file however busy the machine is.
 *
 * The sound is mixed by an `OfflineAudioContext` — each clip's audio at its
 * volume, each added track at its place, trim and volume — and the mix is
 * encoded to AAC once. Mixing needs the decoded sound of everything at the
 * same rate anyway, and the audio context is the browser's own resampler and
 * mixer, exact to the sample.
 *
 * A single clip, card-shaped, with nothing added, does not come here: that is
 * the editor's export, and `renderCardVideo` keeps making it.
 */

import type { CardState, RenderAssets, StudioClip, StudioTrack } from '../../types';
import { openClipBytes } from '../images';
import { audioSpecificConfigFrom, demuxMp4, type DemuxedVideoTrack } from '../mp4read';
import { writeMp4, type MuxSample } from '../mp4write';
import { bitrateFor, planWebCodecs } from '../recorders';
import { countFrames, decodeRange, displaySize, MAX_OUTPUT_FPS, placeFrame } from '../offline';
import { prepareAssets } from '../render';
import { EXPORT_SIZE, ForegroundCache, paintStudioFrame, timeline } from './frame';
import { getSound } from './sounds';

const KEYFRAME_US = 2_000_000;
const MAX_DECODE_QUEUE = 6;
const MAX_ENCODE_QUEUE = 8;
const MAX_PENDING_FRAMES = 4;
const STALL_MS = 10_000;
const AUDIO_CHUNK = 1024;

export class StudioExportError extends Error {}

export interface StudioExportOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface StudioExportResult {
  blob: Blob;
  width: number;
  height: number;
  duration: number;
  frames: number;
  elapsed: number;
}

/* ------------------------------------------------------------------ */
/* Codec plumbing                                                      */
/* ------------------------------------------------------------------ */

type Queued = (VideoEncoder | VideoDecoder | AudioEncoder) & EventTarget;

function sizeOf(codec: Queued): number {
  return 'encodeQueueSize' in codec ? codec.encodeQueueSize : codec.decodeQueueSize;
}

function drain(codec: Queued, limit: number, failure: () => Error | null): Promise<void> {
  if (sizeOf(codec) <= limit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      codec.removeEventListener('dequeue', check);
      reject(new StudioExportError('The video codec stopped responding.'));
    }, STALL_MS);
    const check = () => {
      const failed = failure();
      if (failed || sizeOf(codec) <= limit) {
        clearTimeout(timer);
        codec.removeEventListener('dequeue', check);
        if (failed) reject(failed);
        else resolve();
      }
    };
    codec.addEventListener('dequeue', check);
  });
}

function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new StudioExportError(`${what} did not finish.`)), STALL_MS)),
  ]);
}

function toBytes(description: AllowSharedBufferSource): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description.slice(0));
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength));
  }
  return new Uint8Array(0);
}

function orient(frame: VideoFrame, rotation: number, into: HTMLCanvasElement): CanvasImageSource {
  if (rotation === 0) return frame;
  const ctx = into.getContext('2d');
  if (!ctx) return frame;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(into.width / 2, into.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2, frame.displayWidth, frame.displayHeight);
  return into;
}

const yieldToEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/* ------------------------------------------------------------------ */
/* Sound                                                               */
/* ------------------------------------------------------------------ */

interface MixedAudio {
  description: Uint8Array;
  samples: MuxSample[];
  sampleRate: number;
  channels: number;
}

async function encoderRate(): Promise<number | null> {
  if (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function') return null;
  for (const rate of [48_000, 44_100]) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: rate,
        numberOfChannels: 2,
        bitrate: 192_000,
      });
      if (supported) return rate;
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** Decodes any sound the browser can play; null for a file with none (a silent clip). */
async function decodeSound(context: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer | null> {
  try {
    return await context.decodeAudioData(bytes.slice(0));
  } catch {
    return null;
  }
}

/**
 * The timeline's sound: each clip's own at its volume, each track at its
 * place. Null when there is nothing to hear, or no AAC encoder here.
 */
async function mixAudio(
  clips: readonly StudioClip[],
  clipBytes: ArrayBuffer[],
  tracks: readonly StudioTrack[],
  total: number,
  signal?: AbortSignal,
): Promise<MixedAudio | null> {
  const audible = clips.some((clip) => clip.volume > 0) || tracks.some((track) => track.volume > 0);
  if (!audible || total <= 0) return null;
  const rate = await encoderRate();
  if (!rate) {
    console.warn('No AAC encoder here: the video is exported without sound.');
    return null;
  }

  const context = new OfflineAudioContext(2, Math.ceil(total * rate), rate);
  const { starts } = timeline(clips);
  let sources = 0;
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i]!;
    if (clip.volume <= 0) continue;
    const buffer = await decodeSound(context, clipBytes[i]!);
    if (!buffer) continue;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = clip.volume;
    source.connect(gain).connect(context.destination);
    source.start(starts[i]!, clip.start, clip.length);
    sources += 1;
  }
  for (const track of tracks) {
    if (track.volume <= 0 || track.at >= total) continue;
    const record = await getSound(track.soundId);
    if (!record) continue;
    const buffer = await decodeSound(context, await record.blob.arrayBuffer());
    if (!buffer) continue;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = track.volume;
    source.connect(gain).connect(context.destination);
    source.start(track.at, track.start, Math.min(track.length, total - track.at));
    sources += 1;
  }
  if (!sources) return null;
  if (signal?.aborted) throw new StudioExportError('Export cancelled.');
  const mixed = await context.startRendering();
  // A loud clip under a loud track adds up past full scale, and AAC would
  // clip it. The whole mix is turned down just enough, never up.
  let peak = 0;
  for (let c = 0; c < mixed.numberOfChannels; c += 1) {
    const data = mixed.getChannelData(c);
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]!));
  }
  if (peak > 0.98) {
    const gain = 0.98 / peak;
    for (let c = 0; c < mixed.numberOfChannels; c += 1) {
      const data = mixed.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) data[i]! *= gain;
    }
  }

  let failure: Error | null = null;
  let description: Uint8Array | null = null;
  const samples: MuxSample[] = [];
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const desc = metadata?.decoderConfig?.description;
      if (desc && !description) description = audioSpecificConfigFrom(toBytes(desc));
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0, key: true });
    },
    error: (error) => {
      failure ??= error instanceof Error ? error : new Error(String(error));
    },
  });
  try {
    encoder.configure({ codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: 2, bitrate: 192_000 });
    const left = mixed.getChannelData(0);
    const right = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : left;
    for (let at = 0; at < mixed.length; at += AUDIO_CHUNK) {
      if (failure) throw failure;
      const take = Math.min(AUDIO_CHUNK, mixed.length - at);
      const planes = new Float32Array(take * 2);
      planes.set(left.subarray(at, at + take), 0);
      planes.set(right.subarray(at, at + take), take);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: rate,
        numberOfFrames: take,
        numberOfChannels: 2,
        timestamp: Math.round((at * 1_000_000) / rate),
        data: planes,
      });
      try {
        encoder.encode(data);
      } finally {
        data.close();
      }
      await drain(encoder, MAX_ENCODE_QUEUE, () => failure);
    }
    await bounded(encoder.flush(), 'The sound encoder');
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (!description || !samples.length) return null;
  return { description, samples, sampleRate: rate, channels: 2 };
}

/* ------------------------------------------------------------------ */
/* Picture                                                             */
/* ------------------------------------------------------------------ */

interface OpenedClip {
  clip: StudioClip;
  bytes: ArrayBuffer;
  track: DemuxedVideoTrack;
  startUs: number;
  endUs: number;
  frames: number;
}

function openTrack(clip: StudioClip, bytes: ArrayBuffer): OpenedClip {
  let movie: ReturnType<typeof demuxMp4>;
  try {
    movie = demuxMp4(bytes);
  } catch {
    movie = null;
  }
  const track = movie?.video;
  if (!track?.codec || !track.description) {
    throw new StudioExportError(
      'One of the clips is not an MP4 or MOV this exporter can read. Export it from your phone or editor as MP4.',
    );
  }
  const startUs = Math.round(clip.start * 1_000_000);
  const endUs = startUs + Math.round(clip.length * 1_000_000);
  return { clip, bytes, track, startUs, endUs, frames: countFrames(track.samples, startUs, endUs) };
}

export async function exportStudio(state: CardState, options: StudioExportOptions = {}): Promise<StudioExportResult> {
  const { signal } = options;
  const studio = state.studio;
  if (!studio.clips.length) throw new StudioExportError('Add a clip to the timeline first.');
  if (typeof VideoDecoder !== 'function' || typeof VideoEncoder !== 'function') {
    throw new StudioExportError('This browser cannot build videos here. Use Chrome, Edge or Safari 16.4+.');
  }
  const startedAt = performance.now();

  // Every clip's bytes up front: the sound mix needs them too.
  const bytes: ArrayBuffer[] = [];
  for (const clip of studio.clips) {
    const opened = await openClipBytes(clip.mediaId);
    if (!opened) throw new StudioExportError('One of the clips is no longer in your library.');
    bytes.push(opened.bytes);
  }
  const opened = studio.clips.map((clip, i) => openTrack(clip, bytes[i]!));
  const totalFrames = opened.reduce((n, c) => n + c.frames, 0);
  const { starts, total } = timeline(studio.clips);

  const audio = await mixAudio(studio.clips, bytes, studio.tracks, total, signal);

  const { width, height } = EXPORT_SIZE[studio.aspect];
  const fps = Math.min(MAX_OUTPUT_FPS, Math.max(1, Math.round(Math.max(...opened.map((c) => c.track.fps || 30)))));
  const plan = await planWebCodecs(width, height, fps, bitrateFor(width, height, fps), null);
  if (!plan) throw new StudioExportError('This browser has no H.264 encoder for building videos.');

  const base = await prepareAssets(state);
  const assets: RenderAssets = { ...base, artwork: null };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new StudioExportError('The browser would not give a canvas to draw on.');
  const cache = new ForegroundCache();

  let failure: Error | null = null;
  const fail = (error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
  };
  let description: Uint8Array | null = null;
  const videoSamples: MuxSample[] = [];
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const desc = metadata?.decoderConfig?.description;
      if (desc && !description) description = toBytes(desc);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      videoSamples.push({ data, timestamp: chunk.timestamp, duration: chunk.duration ?? 0, key: chunk.type === 'key' });
    },
    error: fail,
  });
  encoder.configure(plan.videoConfig);

  let written = 0;
  let lastKeyAt = -Infinity;
  let lastReported = 0;

  try {
    for (let c = 0; c < opened.length; c += 1) {
      const { clip, bytes: clipBytes, track, startUs, endUs } = opened[c]!;
      const offsetUs = Math.round(starts[c]! * 1_000_000);
      const config: VideoDecoderConfig = {
        codec: track.codec!,
        description: track.description!,
        codedWidth: track.codedWidth,
        codedHeight: track.codedHeight,
        hardwareAcceleration: 'no-preference',
      };
      const supported = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
      if (!supported.supported) throw new StudioExportError(`This machine cannot decode one of the clips (${track.codec}).`);
      const range = decodeRange(track.samples, startUs, endUs);
      if (!range) continue;
      const size = displaySize(track);
      const rotated = track.rotation !== 0 ? document.createElement('canvas') : null;
      if (rotated) {
        rotated.width = size.width;
        rotated.height = size.height;
      }

      const pending: VideoFrame[] = [];
      const decoder = new VideoDecoder({ output: (frame) => pending.push(frame), error: fail });
      const paint = async () => {
        while (pending.length) {
          const frame = pending.shift()!;
          try {
            const placed = placeFrame(frame.timestamp, frame.duration ?? 0, startUs, endUs);
            if (!placed) continue;
            const element = orient(frame, track.rotation, rotated ?? canvas);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            paintStudioFrame(ctx, width, height, state, clip, { element, ...size }, assets, cache);
            const timestamp = offsetUs + placed.timestamp;
            const out = new VideoFrame(canvas, { timestamp, duration: placed.duration });
            const key = timestamp - lastKeyAt >= KEYFRAME_US;
            try {
              encoder.encode(out, { keyFrame: key });
            } finally {
              out.close();
            }
            if (key) lastKeyAt = timestamp;
            written += 1;
          } finally {
            frame.close();
          }
          await drain(encoder, MAX_ENCODE_QUEUE, () => failure);
        }
        if (totalFrames > 0 && written - lastReported >= Math.max(1, Math.floor(totalFrames / 50))) {
          lastReported = written;
          options.onProgress?.(Math.min(0.99, written / totalFrames));
          await yieldToEvents();
        }
      };
      try {
        decoder.configure(config);
        for (let i = range.first; i <= range.last; i += 1) {
          if (signal?.aborted) throw new StudioExportError('Export cancelled.');
          if (failure) throw failure;
          const s = track.samples[i]!;
          decoder.decode(
            new EncodedVideoChunk({
              type: s.key ? 'key' : 'delta',
              timestamp: s.pts,
              duration: s.duration,
              data: new Uint8Array(clipBytes, s.offset, s.size),
            }),
          );
          await drain(decoder, MAX_DECODE_QUEUE, () => failure);
          if (pending.length >= MAX_PENDING_FRAMES || decoder.decodeQueueSize === 0) await paint();
        }
        // Painted while the flush runs: a decoder holds only a few frames, and
        // one waiting for them to be closed would never finish flushing.
        let flushed = false;
        const flush = decoder.flush().then(() => {
          flushed = true;
        });
        const deadline = performance.now() + STALL_MS;
        while (!flushed) {
          if (failure) throw failure;
          if (performance.now() > deadline) throw new StudioExportError('The video decoder did not finish.');
          await paint();
          await new Promise((resolve) => setTimeout(resolve, 4));
        }
        await flush;
        await paint();
      } finally {
        for (const frame of pending) frame.close();
        if (decoder.state !== 'closed') decoder.close();
      }
    }
    await bounded(encoder.flush(), 'The video encoder');
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  if (!description || !videoSamples.length) throw new StudioExportError('The encoder produced no video.');
  const file = writeMp4({
    video: { width, height, description, samples: videoSamples },
    audio: audio
      ? { sampleRate: audio.sampleRate, channels: audio.channels, description: audio.description, samples: audio.samples }
      : null,
  });
  options.onProgress?.(1);
  return {
    blob: new Blob([file.buffer], { type: 'video/mp4' }),
    width,
    height,
    duration: file.durationSeconds,
    frames: written,
    elapsed: (performance.now() - startedAt) / 1000,
  };
}

/** Exports and saves the file. */
export async function downloadStudio(state: CardState, name: string, options: StudioExportOptions = {}) {
  const result = await exportStudio(state, options);
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.mp4`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return result;
}

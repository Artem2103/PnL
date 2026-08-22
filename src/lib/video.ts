/**
 * Video export.
 *
 * The card invariant still holds: there is exactly one function that paints a
 * card, `drawCard`, reached through `renderToCanvas`. A video is nothing more
 * than that same function called once per frame while the background clip
 * plays, with `MediaRecorder` encoding the canvas. Every number, label and
 * colour on a video frame is produced by the code that produces the PNG.
 *
 * Recording happens in real time — the browser has no way to encode a canvas
 * faster than playback — so a 15 s clip takes 15 s to export.
 */

import type { CardState, RenderAssets } from '../types';
import { MAX_CLIP_SECONDS, openVideoForExport } from './images';
import { prepareAssets, renderToCanvas } from './render';
import { slugify } from './format';

/** Encoding above 2× costs far more time than the extra pixels are worth. */
export const MAX_VIDEO_SCALE = 2;

/** Frame rate of the exported file. */
export const VIDEO_FPS = 30;

export interface Candidate {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

/**
 * MP4 first: X, Instagram and iOS all take it without transcoding, while WebM
 * is rejected or silently re-encoded by several of them. Chrome 126+ and
 * Safari can record it; everything else falls back to WebM.
 */
const CANDIDATES: Candidate[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];

/** Split out from `videoSupport` so the preference order can be unit-tested. */
export function pickMimeType(
  isSupported: (mimeType: string) => boolean,
  candidates: Candidate[] = CANDIDATES,
): Candidate | null {
  return candidates.find((candidate) => isSupported(candidate.mimeType)) ?? null;
}

export interface VideoSupport {
  supported: boolean;
  mimeType: string | null;
  extension: 'mp4' | 'webm' | null;
}

export function videoSupport(): VideoSupport {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    return { supported: false, mimeType: null, extension: null };
  }
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return { supported: false, mimeType: null, extension: null };
  }
  const picked = pickMimeType((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
  if (!picked) return { supported: false, mimeType: null, extension: null };
  return { supported: true, mimeType: picked.mimeType, extension: picked.extension };
}

export interface ClipWindow {
  start: number;
  length: number;
}

/**
 * The slice of the source clip the card plays. Kept pure: the preview loop and
 * the exporter both derive their window from it, so what loops on screen is
 * what lands in the file.
 */
export function resolveClip(duration: number, start: number, length: number): ClipWindow {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, length: 0 };
  const safeStart = Math.min(Math.max(Number.isFinite(start) ? start : 0, 0), Math.max(0, duration - 0.1));
  const available = duration - safeStart;
  const wanted = Number.isFinite(length) && length > 0 ? length : MAX_CLIP_SECONDS;
  return { start: safeStart, length: Math.min(wanted, available, MAX_CLIP_SECONDS) };
}

export function videoFileName(state: CardState, extension: string): string {
  const base =
    state.mode === 'trade' ? state.trade.symbol || 'trade' : state.period.title || 'period';
  return `${slugify(base, 'pnl')}-pnl.${extension}`;
}

export interface VideoExportOptions {
  scale: number;
  /** 0..1, called a few times a second while recording. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
  duration: number;
}

export class VideoExportError extends Error {}

function waitForEvent(target: EventTarget, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(name, handler);
      reject(new VideoExportError(`The clip stopped responding while waiting for "${name}".`));
    }, timeoutMs);
    const handler = () => {
      clearTimeout(timer);
      target.removeEventListener(name, handler);
      resolve();
    };
    target.addEventListener(name, handler);
  });
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) >= 0.001) {
    const seeked = waitForEvent(video, 'seeked', 10_000);
    video.currentTime = time;
    await seeked;
  }
  // HAVE_CURRENT_DATA or better, or the first frames would record as the empty
  // themed background while the decoder catches up.
  if (video.readyState < 2) await waitForEvent(video, 'loadeddata', 15_000);
}

/**
 * Attaches the clip's own audio to the recording without letting it out of the
 * speakers: a `MediaElementAudioSourceNode` takes the element's output over,
 * and it is connected only to the recorder's stream destination.
 *
 * The context is started *before* the element is routed into it. Routing a
 * playing element into a suspended context leaves it with a sink that never
 * drains, which stalls decoding — the clip then plays at a crawl and the
 * recording is minutes of frozen frames. That state is unrecoverable once the
 * source node exists, so the check has to come first.
 */
async function attachAudio(
  video: HTMLVideoElement,
  stream: MediaStream,
): Promise<(() => void) | null> {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  let context: AudioContext;
  try {
    context = new Ctor();
    await context.resume();
  } catch {
    return null;
  }
  if (context.state !== 'running') {
    await context.close().catch(() => undefined);
    return null;
  }

  try {
    const source = context.createMediaElementSource(video);
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error('no audio track');
    stream.addTrack(track);
    video.muted = false;
    video.volume = 1;
    return () => {
      try {
        source.disconnect();
      } catch {
        /* already torn down */
      }
      void context.close();
    };
  } catch {
    await context.close().catch(() => undefined);
    return null;
  }
}

function bitrateFor(width: number, height: number): number {
  // ~0.09 bits per pixel per frame: clean on flat card graphics without
  // producing a file too large to post.
  return Math.min(24_000_000, Math.round(width * height * VIDEO_FPS * 0.09));
}

/**
 * Records the card over its background clip and returns the encoded file.
 *
 * Runs on a fresh, detached `<video>` so the preview keeps playing untouched.
 */
export async function renderCardVideo(
  state: CardState,
  options: VideoExportOptions,
): Promise<VideoExportResult> {
  const support = videoSupport();
  if (!support.supported || !support.mimeType || !support.extension) {
    throw new VideoExportError('This browser cannot record video. Try Chrome, Edge or Safari.');
  }
  if (!state.artwork.imageId) {
    throw new VideoExportError('Pick a background clip first.');
  }

  const opened = await openVideoForExport(state.artwork.imageId);
  if (!opened) throw new VideoExportError('That background is a photo, not a clip.');

  const { element: video, duration, release } = opened;
  const clip = resolveClip(duration, state.artwork.clipStart, state.artwork.clipLength);
  if (clip.length <= 0) {
    release();
    throw new VideoExportError('That clip window is empty. Move the start point back.');
  }

  const scale = Math.min(Math.max(options.scale, 1), MAX_VIDEO_SCALE);
  const base = await prepareAssets(state);
  const assets: RenderAssets = {
    ...base,
    artwork: {
      kind: 'video',
      element: video,
      width: video.videoWidth,
      height: video.videoHeight,
      duration,
    },
  };

  const canvas = document.createElement('canvas');
  let detachAudio: (() => void) | null = null;
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;

  try {
    await seekTo(video, clip.start);
    // First paint sizes the canvas and gives the stream a complete frame to
    // start from, so no empty frame can lead the file.
    renderToCanvas(canvas, state, assets, scale);

    stream = canvas.captureStream(VIDEO_FPS);
    if (!state.artwork.muteAudio) detachAudio = await attachAudio(video, stream);

    const active = new MediaRecorder(stream, {
      mimeType: support.mimeType,
      videoBitsPerSecond: bitrateFor(canvas.width, canvas.height),
    });
    recorder = active;

    const chunks: Blob[] = [];
    active.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      active.onstop = () => resolve();
      active.onerror = () => reject(new VideoExportError('The recorder failed mid-export.'));
    });
    // Marks the rejection handled if the export is cancelled before the await
    // below is reached; awaiting it still surfaces the failure.
    stopped.catch(() => undefined);

    try {
      await video.play();
    } catch {
      // Autoplay policy refused an audible element; record it silent instead.
      detachAudio?.();
      detachAudio = null;
      video.muted = true;
      await video.play();
    }
    // Started after playback so the file does not open on a held frame while
    // the decoder spins up. Tracks added later would not be recorded, which is
    // why the audio is wired in above.
    active.start(250);

    const end = clip.start + clip.length;
    // Recording is real time, so a clip that stalls would otherwise sit here
    // forever and hand back a file minutes long full of frozen frames.
    const deadline = performance.now() + clip.length * 1000 * 3 + 10_000;

    await new Promise<void>((resolve, reject) => {
      let painted = 0;
      let frames = 0;
      let raf = 0;
      let timer = 0;
      let tail = 0;
      let done = false;

      const finish = (error?: Error) => {
        done = true;
        cancelAnimationFrame(raf);
        clearInterval(timer);
        clearTimeout(tail);
        if (error) reject(error);
        else resolve();
      };

      const paint = (fromRaf: boolean) => {
        if (done) return;
        const now = performance.now();
        // The interval only exists as a backstop; skip it when rAF is healthy.
        if (!fromRaf && now - painted < 1000 / VIDEO_FPS) return;
        painted = now;

        if (options.signal?.aborted) {
          finish(new VideoExportError('Export cancelled.'));
          return;
        }
        renderToCanvas(canvas, state, assets, scale);
        const elapsed = Math.max(0, video.currentTime - clip.start);
        // Reporting every frame would re-render React 30 times a second for a
        // progress bar that moves 3%.
        if (frames % 6 === 0) options.onProgress?.(Math.min(1, elapsed / clip.length));
        frames += 1;

        if (video.ended || video.currentTime >= end) {
          finish();
          return;
        }
        if (now > deadline) {
          finish(
            new VideoExportError(
              'The clip stalled while recording. Keep this tab in front while it runs, then try again.',
            ),
          );
        }
      };

      // rAF alone stops firing when the window is hidden or fully covered,
      // which would freeze the picture while the clip kept playing. The timer
      // keeps painting — slowly — in that case.
      const loop = () => {
        paint(true);
        if (!done) raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      timer = setInterval(() => paint(false), Math.round(1000 / VIDEO_FPS)) as unknown as number;

      // The loop notices the end of the window only when it paints, so a
      // throttled page would overrun by however long it slept. Wall clock
      // bounds the tail independently.
      tail = setTimeout(
        () => {
          if (!done) finish();
        },
        clip.length * 1000 + 150,
      ) as unknown as number;
    });

    video.pause();
    active.stop();
    await stopped;
    options.onProgress?.(1);

    const blob = new Blob(chunks, { type: support.mimeType });
    if (blob.size === 0) throw new VideoExportError('The recorder produced an empty file.');

    return {
      blob,
      mimeType: support.mimeType,
      extension: support.extension,
      width: canvas.width,
      height: canvas.height,
      duration: clip.length,
    };
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    detachAudio?.();
    stream?.getTracks().forEach((track) => track.stop());
    release();
  }
}

export async function downloadCardVideo(
  state: CardState,
  options: VideoExportOptions,
): Promise<VideoExportResult> {
  const result = await renderCardVideo(state, options);
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = videoFileName(state, result.extension);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke late: Safari reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return result;
}

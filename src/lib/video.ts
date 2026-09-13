/**
 * Video export.
 *
 * The card invariant still holds: there is exactly one function that paints a
 * card, `drawCard`, reached through `renderToCanvas`. A video is nothing more
 * than that same function called once per frame of the background clip. Every
 * number, label and colour on a video frame is produced by the code that
 * produces the PNG.
 *
 * There are two ways the frames get made, tried in this order:
 *
 * 1. **Frame-exact** (`lib/offline.ts`): the clip's own frames, decoded from
 *    its file with `VideoDecoder`, painted once each and encoded with
 *    `VideoEncoder`, on the clip's own timestamps; the sound decoded from the
 *    same file and re-encoded on the same timeline. Every frame lands, at the
 *    clip's own frame rate, whatever the machine is doing, and it runs as fast
 *    as the codecs allow. Needs an MP4/MOV with H.264 or HEVC and AAC.
 * 2. **Live** (`lib/recorders.ts`): the clip plays in a detached `<video>`
 *    while the canvas is repainted and sampled thirty times a second. Real
 *    time, and only as smooth as the machine manages to play — which is why
 *    it is the fallback now: WebM sources, codecs this machine will not
 *    decode, browsers without the decoders. `WebCodecsRecorder` writes the
 *    file itself (`lib/mp4write.ts`); `MediaStreamRecorder` is `MediaRecorder`
 *    with `repairFragmentedMp4` (`lib/mp4.ts`) after it.
 */

import type { CardState, RenderAssets } from '../types';
import { MAX_CLIP_SECONDS, openClipBytes, openVideoForExport } from './images';
import type { RecordingRepair } from './mp4';
import { OfflineUnavailable, exportOffline } from './offline';
import {
  MediaStreamRecorder,
  WebCodecsRecorder,
  bitrateFor,
  planWebCodecs,
  type AudioGraph,
  type CardRecorder,
} from './recorders';
import { prepareAssets, renderToCanvas } from './render';
import { slugify } from './format';

/** Encoding above 2× costs far more time than the extra pixels are worth. */
export const MAX_VIDEO_SCALE = 2;

/**
 * A PNG at 1× is a perfectly good 840×570 image. A *video* at 1× is not: it is
 * re-encoded by every platform it is posted to, and a card that small arrives
 * with its numbers smeared. Video ignores the 1× chip and records at 2×.
 */
export const MIN_VIDEO_SCALE = 2;

/** The scale a clip actually records at, given the chosen export scale. */
export function videoScaleFor(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_VIDEO_SCALE;
  return Math.min(MAX_VIDEO_SCALE, Math.max(MIN_VIDEO_SCALE, scale));
}

/**
 * Frame rate of a *live-recorded* file. The frame-exact path keeps the
 * clip's own rate instead (up to `MAX_OUTPUT_FPS` in `lib/offline.ts`).
 */
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

/** Whether the WebCodecs recorder can exist here at all; the codecs are checked at export time. */
export function webCodecsAvailable(): boolean {
  return (
    typeof VideoEncoder === 'function' &&
    typeof VideoFrame === 'function' &&
    typeof AudioEncoder === 'function' &&
    typeof HTMLCanvasElement !== 'undefined'
  );
}

/** Whether the frame-exact exporter can exist here; the clip decides the rest. */
export function frameExactAvailable(): boolean {
  return (
    webCodecsAvailable() &&
    typeof VideoDecoder === 'function' &&
    typeof AudioDecoder === 'function' &&
    typeof EncodedVideoChunk === 'function'
  );
}

export function videoSupport(): VideoSupport {
  if (typeof HTMLCanvasElement === 'undefined') {
    return { supported: false, mimeType: null, extension: null };
  }
  // WebCodecs writes MP4 itself (`lib/mp4write.ts`), so it does not need
  // MediaRecorder to know the type. See `lib/recorders.ts` for why it is
  // preferred wherever it exists.
  if (webCodecsAvailable()) {
    return { supported: true, mimeType: 'video/mp4', extension: 'mp4' };
  }
  if (typeof MediaRecorder === 'undefined') {
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

/** The MediaRecorder type to fall back to, if any, when WebCodecs cannot be used. */
function mediaRecorderSupport(): Candidate | null {
  if (typeof MediaRecorder === 'undefined') return null;
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return pickMimeType((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
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
  /** Measured from the finished file, not from the window that was asked for. */
  duration: number;
  /** What the container repair found and changed; nothing, on the WebCodecs path. */
  repair: RecordingRepair;
  /**
   * Which path made the file. `frame-exact` decoded the clip's own frames
   * (`lib/offline.ts`); the other two recorded a playing `<video>` live.
   */
  recorder: 'frame-exact' | 'webcodecs' | 'mediarecorder';
  /** Frames the encoder was too busy to take; zero on a machine that keeps up. */
  framesSkipped: number;
  /** Frames per second the file carries. */
  fps: number;
  /** Wall-clock seconds the export took. */
  elapsed: number;
}

export class VideoExportError extends Error {}

/**
 * Chrome does not decode media in a page it considers hidden — and a window
 * covered by another app counts as hidden, not just a background tab. A
 * recording started in that state produced either a 20 s wait on metadata that
 * never arrived or a file of frozen frames, and blamed the clip for both.
 *
 * Kept pure so the rule is testable; the caller passes `document.visibilityState`.
 */
export function blockedByVisibility(visibility: string): string | null {
  return visibility === 'visible'
    ? null
    : 'This window has to be in front to record: browsers stop decoding video in a ' +
        'background window. Bring it forward and press Download again.';
}

/**
 * How long the export waits, paused, for a window that went away. Long enough
 * to answer a message and come back, short enough not to look like a hang.
 */
export const MAX_HIDDEN_SECONDS = 60;

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

/**
 * The next decoded frame, read as `currentTime` moving, or a short wait if
 * it never does.
 *
 * **Not `requestVideoFrameCallback`.** On this element — opened for the export
 * and never attached to the document — one call to it freezes the clip for
 * about a quarter of a second, 1.0–1.1 s later: picture and sound both stop
 * while the clock runs on, and the frames come back with a jump. It does not
 * matter whether the element is recording, paused in between or seeked; the
 * freeze follows the call. This function used it, once, right after the
 * warm-up play in an earlier version, which put the freeze 0.4 s into every
 * exported file (`dev/start-check.html`, controls `rvfc-only` and
 * `rvfc-late`, is where that was pinned down). A moving `currentTime` says
 * "a frame has arrived" a few milliseconds more coarsely and has no such
 * side effect. The preview loop, on an element that *is* in the document,
 * still uses `requestVideoFrameCallback` and has not shown this.
 *
 * Never hangs: every caller has a deadline of its own behind it, and a missed
 * frame here only costs the moment it was there to save.
 */
function nextDecodedFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((settle) => {
    const at = video.currentTime;
    let over = false;
    let poll = 0;
    let guard = 0;
    const once = () => {
      if (over) return;
      over = true;
      clearInterval(poll);
      clearTimeout(guard);
      settle();
    };
    guard = setTimeout(once, 1200) as unknown as number;
    poll = setInterval(() => {
      if (video.currentTime > at) once();
    }, 8) as unknown as number;
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

interface AudioRoute {
  /** The nodes, for a recorder that wants to tap the sound directly. */
  graph: AudioGraph;
  /** Brings the context back after a hidden page suspended it. */
  resume: () => Promise<void>;
  detach: () => void;
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
): Promise<AudioRoute | null> {
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

    // A destination whose only input is a media element that has not started
    // decoding has nothing to hand anyone, and the sound track then begins
    // whenever the decoder gets round to it — over a second into the file, on
    // the exports that prompted this. A source that is always running keeps
    // the track live from the moment it exists, so it is producing before the
    // recorder asks. -100 dBFS is a third of a bit at 16 bits: silence in
    // every respect except being there.
    const keepAlive =
      typeof context.createConstantSource === 'function' ? context.createConstantSource() : null;
    if (keepAlive) {
      const floor = context.createGain();
      floor.gain.value = 1e-5;
      keepAlive.connect(floor);
      floor.connect(destination);
      keepAlive.start();
    }

    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error('no audio track');
    stream.addTrack(track);
    video.muted = false;
    video.volume = 1;
    return {
      graph: { context, source, destination },
      resume: async () => {
        if (context.state === 'suspended') await context.resume().catch(() => undefined);
      },
      detach: () => {
        try {
          keepAlive?.stop();
          source.disconnect();
        } catch {
          /* already torn down */
        }
        void context.close();
      },
    };
  } catch {
    await context.close().catch(() => undefined);
    return null;
  }
}

/**
 * The frame-exact path: the clip's own frames, decoded and painted one by one.
 * Throws `OfflineUnavailable` when this clip or this browser cannot take it,
 * in which case the caller records live instead.
 */
async function renderCardVideoFrameExact(
  state: CardState,
  options: VideoExportOptions,
): Promise<VideoExportResult> {
  const clipBytes = await openClipBytes(state.artwork.imageId!);
  if (!clipBytes) throw new VideoExportError('That background is a photo, not a clip.');
  const clip = resolveClip(clipBytes.duration, state.artwork.clipStart, state.artwork.clipLength);
  if (clip.length <= 0) {
    throw new VideoExportError('That clip window is empty. Move the start point back.');
  }
  // Avatar and logo only: the artwork slot is filled per frame by the
  // exporter, and resolving the clip here would spin up a `<video>` for it.
  const assets = await prepareAssets({ ...state, artwork: { ...state.artwork, imageId: null } });
  const result = await exportOffline({
    bytes: clipBytes.bytes,
    state,
    assets,
    scale: videoScaleFor(options.scale),
    clipStart: clip.start,
    clipLength: clip.length,
    muteAudio: state.artwork.muteAudio,
    onProgress: options.onProgress,
    signal: options.signal,
  });
  return {
    blob: result.blob,
    mimeType: 'video/mp4',
    extension: 'mp4',
    width: result.width,
    height: result.height,
    duration: result.duration,
    repair: {
      patched: false,
      videoSeconds: result.videoSeconds,
      audioSeconds: result.audioSeconds,
      audioLeadSeconds: 0,
      durationSeconds: result.duration,
    },
    recorder: 'frame-exact',
    framesSkipped: 0,
    fps: result.fps,
    elapsed: result.elapsed,
  };
}

/**
 * Records the card over its background clip and returns the encoded file.
 *
 * Frame-exact wherever it can be (`lib/offline.ts`); otherwise a live
 * recording on a fresh, detached `<video>`, so the preview is left untouched.
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

  if (frameExactAvailable()) {
    try {
      return await renderCardVideoFrameExact(state, options);
    } catch (error) {
      if (!(error instanceof OfflineUnavailable)) throw error;
      // WebM, a codec this machine will not decode, a decoder that gave up
      // before the first frame: the live recorder still handles all of these.
      console.warn(
        'Frame-exact export unavailable for this clip; recording live instead:',
        error.message,
      );
      options.onProgress?.(0);
    }
  }

  const blocked = typeof document === 'undefined' ? null : blockedByVisibility(document.visibilityState);
  if (blocked) throw new VideoExportError(blocked);

  const opened = await openVideoForExport(state.artwork.imageId);
  if (!opened) throw new VideoExportError('That background is a photo, not a clip.');

  const { element: video, duration, release } = opened;
  const clip = resolveClip(duration, state.artwork.clipStart, state.artwork.clipLength);
  if (clip.length <= 0) {
    release();
    throw new VideoExportError('That clip window is empty. Move the start point back.');
  }

  const scale = videoScaleFor(options.scale);
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
  let audio: AudioRoute | null = null;
  let stream: MediaStream | null = null;
  let recorder: CardRecorder | null = null;

  try {
    await seekTo(video, clip.start);
    // First paint sizes the canvas and gives the recorder a complete frame to
    // start from, so no empty frame can lead the file.
    renderToCanvas(canvas, state, assets, scale);

    // The MediaRecorder path records this stream; the WebCodecs path only
    // needs the audio destination it carries. It is made either way, so the
    // sound is wired up identically whichever recorder is chosen.
    stream = canvas.captureStream(VIDEO_FPS);
    if (!state.artwork.muteAudio) audio = await attachAudio(video, stream);

    const bitrate = bitrateFor(canvas.width, canvas.height, VIDEO_FPS);
    const withMediaRecorder = (): CardRecorder => {
      const fallback = mediaRecorderSupport();
      if (!fallback) {
        throw new VideoExportError('This browser cannot record video. Try Chrome, Edge or Safari.');
      }
      return new MediaStreamRecorder(stream!, fallback.mimeType, fallback.extension, bitrate);
    };
    const plan = await planWebCodecs(canvas.width, canvas.height, VIDEO_FPS, bitrate, audio?.graph ?? null);
    recorder = plan ? new WebCodecsRecorder(canvas, VIDEO_FPS, plan, audio?.graph ?? null) : withMediaRecorder();

    const play = async () => {
      try {
        await video.play();
      } catch {
        // Autoplay policy refused an audible element; record it silent instead.
        audio?.detach();
        audio = null;
        video.muted = true;
        await video.play();
      }
    };

    /**
     * Pre-roll on the still frame, then one play, straight into the take.
     *
     * An earlier version ran the clip for half a second first, paused it and
     * seeked back to the start, to have both decoders delivering before the
     * recorder started. Every file it made froze for a quarter of a second
     * about 0.4 s in. Two things were behind that, and neither was the
     * warm-up play as such:
     *
     * - `requestVideoFrameCallback`, which the warm-up used to wait for its
     *   first frame, freezes this detached element 1.0–1.1 s after the call —
     *   see `nextDecodedFrame`, which no longer uses it.
     * - an encoder coming up freezes the clip's decoder for 100–250 ms, a
     *   quarter of a second after it is handed its first frame — so the
     *   recorder is brought up here, on the still frame, while the clip is
     *   still paused and there is nothing to disturb. See `lib/recorders.ts`
     *   for what each recorder can do with the frames that costs.
     *
     * With both moved out of the way, a first play from a fresh seek records
     * clean from its first frame, so there is no longer a warm-up play, and
     * nothing here pauses or seeks the element between `play()` and the end
     * of the take.
     *
     * `play()` resolves before the decoder is delivering, and the take begins
     * only once a decoded frame has actually arrived and been painted. The
     * sound is live from the moment the graph exists (see `attachAudio`).
     */
    if (!(await recorder.preroll())) {
      // The WebCodecs encoder took frames and gave nothing back. There is
      // still time to record the take the old way.
      recorder.abort();
      recorder = withMediaRecorder();
      await recorder.preroll();
    }
    const active = recorder;

    await play();
    await nextDecodedFrame(video);
    renderToCanvas(canvas, state, assets, scale);
    const takeStartedAt = performance.now();
    active.begin();
    active.frame();

    const end = clip.start + clip.length;
    // Recording is real time, so a clip that stalls would otherwise sit here
    // forever and hand back a file minutes long full of frozen frames. Time
    // spent paused for a hidden window is added back below, so a pause is not
    // mistaken for a stall.
    let deadline = performance.now() + clip.length * 1000 * 3 + 10_000;

    await new Promise<void>((resolve, reject) => {
      /**
       * `captureStream` samples the canvas when it changes, and enforces a
       * minimum of 1/VIDEO_FPS between the frames it keeps. So the canvas must
       * be repainted *faster* than the recorder samples: paint exactly at the
       * sample rate and ordinary timer jitter lands half the paints just
       * inside the previous interval, where they are discarded — the file then
       * holds 15–20 irregularly spaced frames a second and plays back as
       * judder. Painting at twice the rate guarantees fresh pixels are always
       * waiting when the sampler comes round, and costs ~0.2 ms a paint now
       * that the foreground is cached.
       */
      const paintGap = 1000 / (VIDEO_FPS * 2);

      let painted = 0;
      let frames = 0;
      let raf = 0;
      let timer = 0;
      let done = false;

      /**
       * The window went behind something. Chrome stops decoding the clip
       * there, so carrying on would encode however many seconds of frozen
       * frames the person was away for — which is what "the recording failed"
       * looked like from the outside. Both ends are held instead: the clip
       * pauses where it is and the recorder pauses with it, and the file picks
       * up on the same frame when the window comes back.
       *
       * `resuming` is the state that closes the seam. Coming back, the decoder
       * needs a few hundred ms to hand over its first frame, and a recorder
       * resumed before then stamps that whole wait onto the last frame — a
       * visible ~0.4 s freeze at the join. So the recorder stays paused, which
       * excludes the wait from the timeline entirely, until there are fresh
       * pixels on the canvas to give it.
       */
      type Phase = 'recording' | 'paused' | 'resuming';
      let phase: Phase = 'recording';
      let hiddenSince = 0;

      // The loop notices the end of the window only when it paints, so a
      // throttled page would overrun by however long it slept. Wall clock
      // bounds the tail independently — and moves with the pauses.
      let tailAt = performance.now() + clip.length * 1000 + 150;

      const finish = (error?: Error) => {
        done = true;
        cancelAnimationFrame(raf);
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibility);
        if (error) reject(error);
        else resolve();
      };

      async function resumeAfterHidden() {
        try {
          await video.play();
        } catch {
          finish(new VideoExportError('The clip would not restart after the window came back.'));
          return;
        }
        await nextDecodedFrame(video);
        if (done) return;
        // Went away again while the decoder was warming up: stay paused rather
        // than resume into a window that is not there.
        if (document.visibilityState !== 'visible') {
          video.pause();
          phase = 'paused';
          hiddenSince = performance.now();
          return;
        }

        // The pixels the recorder will be handed, painted before it is running
        // so its first sample after the resume is already the new frame.
        renderToCanvas(canvas, state, assets, scale);
        painted = performance.now();

        // Everything that measures elapsed time slides by the whole gap —
        // including the warm-up above — or the tail fires on the way back in.
        const away = performance.now() - hiddenSince;
        deadline += away;
        tailAt += away;

        await audio?.resume();
        active.resume();
        active.frame();
        hiddenSince = 0;
        phase = 'recording';
      }

      function onVisibility() {
        if (done) return;
        if (document.visibilityState !== 'visible') {
          if (phase !== 'recording') return;
          phase = 'paused';
          hiddenSince = performance.now();
          // Recorder first: any frame painted between here and the video
          // stopping would be encoded as part of the pause.
          active.pause();
          video.pause();
          return;
        }
        if (phase !== 'paused') return;
        phase = 'resuming';
        void resumeAfterHidden();
      }

      const tick = () => {
        if (done) return;
        const now = performance.now();

        if (options.signal?.aborted) {
          finish(new VideoExportError('Export cancelled.'));
          return;
        }

        if (phase !== 'recording') {
          // Paused, waiting for the window. Not forever, though: an export
          // left behind for good should say so rather than look like a hang.
          if (phase === 'paused' && now - hiddenSince > MAX_HIDDEN_SECONDS * 1000) {
            finish(
              new VideoExportError(
                `The window stayed in the background for over ${MAX_HIDDEN_SECONDS} s, so the ` +
                  'recording was stopped. Keep it in front and try again.',
              ),
            );
          }
          return;
        }

        if (now - painted >= paintGap - 1) {
          painted = now;
          renderToCanvas(canvas, state, assets, scale);
          active.frame();
          const elapsed = Math.max(0, video.currentTime - clip.start);
          // Reporting every paint would re-render React 60 times a second for
          // a progress bar that moves 2%.
          if (frames % 12 === 0) options.onProgress?.(Math.min(1, elapsed / clip.length));
          frames += 1;
        }

        if (video.ended || video.currentTime >= end || now >= tailAt) {
          finish();
          return;
        }
        if (now > deadline) {
          finish(
            new VideoExportError(
              'The clip stalled while recording. Keep this window in front while it runs, then try again.',
            ),
          );
        }
      };

      // rAF alone stops firing when the window is hidden or fully covered, and
      // that is exactly when the pause above has to be noticed. The timer keeps
      // ticking — slowly — in that case.
      const loop = () => {
        tick();
        if (!done) raf = requestAnimationFrame(loop);
      };
      document.addEventListener('visibilitychange', onVisibility);
      raf = requestAnimationFrame(loop);
      timer = setInterval(tick, Math.round(paintGap)) as unknown as number;
    });

    video.pause();
    let file;
    try {
      file = await active.finish();
    } catch (error) {
      throw new VideoExportError(
        error instanceof Error ? error.message : 'The recorder failed to finish the file.',
      );
    }
    recorder = null;
    options.onProgress?.(1);

    return {
      blob: file.blob,
      mimeType: file.mimeType,
      extension: file.extension,
      width: canvas.width,
      height: canvas.height,
      duration: file.duration || clip.length,
      repair: file.repair,
      recorder: file.recorder,
      framesSkipped: file.framesSkipped,
      fps: VIDEO_FPS,
      elapsed: (performance.now() - takeStartedAt) / 1000,
    };
  } finally {
    recorder?.abort();
    audio?.detach();
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

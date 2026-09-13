/**
 * The two ways a card video gets encoded.
 *
 * `renderCardVideo` paints the card into a canvas at 60 Hz while the clip
 * plays; what turns those paints into a file is one of the recorders here.
 * Both are driven the same way — `preroll` before the clip plays, `begin`
 * on the first decoded frame, `frame` after every paint, `pause`/`resume`
 * around a hidden window, `finish` at the end — so the loop that paints does
 * not know which one it has.
 *
 * `WebCodecsRecorder` is the one that is used whenever the browser can. It
 * exists because of what `MediaRecorder` does at the start of a take: its
 * encoder comes up on the first frame it is handed and freezes the clip's
 * decoder for 100–250 ms while it does, a quarter of a second into every
 * file. The only cure with `MediaRecorder` is to start it on a still frame
 * before the clip plays — and everything it encodes is in the file, so the
 * file then opens on a third of a second of still. With WebCodecs the frames
 * encoded before the take are simply thrown away, and the first frame of the
 * take is forced to be a key frame, so the file opens exactly where the clip
 * window does. It also lets the file be written whole (`lib/mp4write.ts`),
 * with real durations, instead of the blank-headered fragmented MP4
 * `MediaRecorder` leaves behind, and it records sound at 192 kbit/s AAC.
 *
 * `MediaStreamRecorder` is the fallback for browsers without WebCodecs. It
 * keeps the behaviour the exporter had: start at the take, repair the
 * container afterwards.
 */

import { repairFragmentedMp4, type RecordingRepair } from './mp4';
import { writeMp4, type MuxSample } from './mp4write';

export interface RecordedFile {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  /** Seconds, measured from the finished file. */
  duration: number;
  /** What the container repair found and changed; nothing, for WebCodecs. */
  repair: RecordingRepair;
  recorder: 'webcodecs' | 'mediarecorder';
  /** Frames the encoder was too busy to take. Zero unless the machine is struggling. */
  framesSkipped: number;
}

export interface CardRecorder {
  readonly kind: 'webcodecs' | 'mediarecorder';
  /**
   * Brings the encoders up on whatever is on the canvas now. Called with the
   * clip paused and the first frame painted; resolves when the take can begin.
   * False means the encoder never produced anything and the caller should
   * `abort` this recorder and use another.
   */
  preroll(): Promise<boolean>;
  /** The take starts now: from here on, frames are kept. */
  begin(): void;
  /** After every paint of the canvas while recording. */
  frame(): void;
  /** The window went away; keep nothing until `resume`. */
  pause(): void;
  /** The window is back and the canvas holds a fresh frame. */
  resume(): void;
  /** Ends the take and hands back the file. */
  finish(): Promise<RecordedFile>;
  /** Tears everything down with no file; safe to call at any point. */
  abort(): void;
}

/**
 * The audio graph the clip's sound runs through, as `attachAudio` in
 * `video.ts` builds it: element → source → destination, with the destination
 * feeding a stream track. The WebCodecs recorder splices a tap in between.
 */
export interface AudioGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  destination: MediaStreamAudioDestinationNode;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Bitrate                                                             */
/* ------------------------------------------------------------------ */

/**
 * Bits per pixel per frame at 30 fps. 0.09 was budgeted for flat card
 * graphics, but the background is a photographic clip — grain, motion and
 * film-like detail — and at that rate it came out mushy and blocked up around
 * the moving parts. Raised again with the frame-exact exporter, which is not
 * racing the clock and can afford it.
 */
const BITS_PER_PIXEL = 0.18;
/** Frames past 30 a second look more like their neighbours and cost half. */
const BITS_PER_EXTRA_PIXEL = 0.09;
/** A card is mostly type. Under this it stops surviving a platform re-encode. */
const MIN_BITRATE = 6_000_000;
const MAX_BITRATE = 24_000_000;

/** The video bitrate for a frame size and rate, bits per second. */
export function bitrateFor(width: number, height: number, fps = 30): number {
  const base = Math.min(fps, 30) * BITS_PER_PIXEL;
  const extra = Math.max(0, fps - 30) * BITS_PER_EXTRA_PIXEL;
  const budget = Math.round(width * height * (base + extra));
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, budget));
}

/* ------------------------------------------------------------------ */
/* WebCodecs                                                           */
/* ------------------------------------------------------------------ */

/** Key frame every two seconds: seekable, and what platforms re-encode best. */
const KEYFRAME_SECONDS = 2;
/** 192 kbit/s AAC-LC: transparent for a clip's sound, and what phones write. */
const AUDIO_BITRATE = 192_000;
/**
 * Frames still waiting at the encoder before a new one is skipped rather than
 * queued. A dozen is a third of a second of backlog; past that the machine is
 * not keeping up and queueing more only costs memory.
 */
const MAX_ENCODE_QUEUE = 12;
/**
 * How long the pre-roll feeds still frames. The encoder's start-up is over
 * once it has produced output, which is what `preroll` actually waits for;
 * this is the ceiling on that wait.
 */
const PREROLL_MAX_MS = 1500;
const PREROLL_MIN_MS = 300;
/** The most `finish` waits for the encoders to hand over what they still hold. */
const FLUSH_MAX_MS = 5000;

/**
 * High profile at level 4.0 — better pictures per bit than Baseline, and
 * decoded by everything a card is posted to. Baseline is the fallback for a
 * machine whose encoder will not do High.
 */
const H264_CANDIDATES = ['avc1.640028', 'avc1.4D0028', 'avc1.42E028'];

export interface WebCodecsPlan {
  videoConfig: VideoEncoderConfig;
  audioConfig: AudioEncoderConfig | null;
}

/**
 * Whether the WebCodecs path can run here, and with what. Answers null when it
 * cannot, in which case the caller falls back to `MediaStreamRecorder`.
 */
export async function planWebCodecs(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
  audio: AudioGraph | null,
): Promise<WebCodecsPlan | null> {
  if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') return null;
  if (audio && (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function')) return null;
  if (audio && typeof AudioWorkletNode !== 'function') return null;

  let videoConfig: VideoEncoderConfig | null = null;
  for (const codec of H264_CANDIDATES) {
    // `realtime`, not `quality`: in quality mode the hardware encoder here
    // buffered a dozen frames, produced five in six seconds and never came
    // back from `flush()`. Realtime mode is what the canvas is anyway — a
    // frame every 33 ms, encoded as it comes — and it is the mode that was
    // measured clean (`dev/start-check.html`, `webcodecs-preroll`).
    const candidate: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      bitrateMode: 'variable',
      latencyMode: 'realtime',
      hardwareAcceleration: 'no-preference',
      avc: { format: 'avc' },
    };
    try {
      const support = await VideoEncoder.isConfigSupported(candidate);
      if (support.supported) {
        videoConfig = candidate;
        break;
      }
    } catch {
      // Not this one.
    }
  }
  if (!videoConfig) return null;

  let audioConfig: AudioEncoderConfig | null = null;
  if (audio) {
    const candidate: AudioEncoderConfig & { aac?: { format: string } } = {
      codec: 'mp4a.40.2',
      sampleRate: audio.context.sampleRate,
      numberOfChannels: 2,
      bitrate: AUDIO_BITRATE,
      aac: { format: 'aac' },
    };
    try {
      const support = await AudioEncoder.isConfigSupported(candidate);
      if (!support.supported) return null;
      audioConfig = candidate;
    } catch {
      return null;
    }
  }
  return { videoConfig, audioConfig };
}

/**
 * The worklet that taps the clip's sound. Runs on the audio thread: copies
 * each render quantum through unchanged and posts them to the main thread in
 * ~21 ms batches, stamped with the audio clock's frame count.
 */
const TAP_WORKLET = `
class PnlTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.frames = 0;
    this.startFrame = -1;
  }
  flush() {
    if (!this.chunks.length) return;
    const channels = this.chunks[0].length;
    const out = new Float32Array(channels * this.frames);
    let at = 0;
    for (let c = 0; c < channels; c += 1) {
      for (const chunk of this.chunks) {
        out.set(chunk[Math.min(c, chunk.length - 1)], at);
        at += chunk[0].length;
      }
    }
    this.port.postMessage({ startFrame: this.startFrame, frames: this.frames, channels, data: out }, [out.buffer]);
    this.chunks = [];
    this.frames = 0;
    this.startFrame = -1;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (input && input.length && input[0].length) {
      for (let c = 0; c < output.length; c += 1) output[c].set(input[Math.min(c, input.length - 1)]);
      if (this.startFrame < 0) this.startFrame = currentFrame;
      this.chunks.push(input.map((ch) => Float32Array.from(ch)));
      this.frames += input[0].length;
      if (this.frames >= 1024) this.flush();
    }
    return true;
  }
}
registerProcessor('pnl-tap', PnlTap);
`;

interface TapMessage {
  startFrame: number;
  frames: number;
  channels: number;
  data: Float32Array;
}

/**
 * Which 1/fps slot an instant falls in. Pure, so the cadence is testable.
 * Multiplied before dividing so a whole second lands on slot `fps` exactly
 * rather than a rounding error under it.
 */
export function frameSlot(elapsedUs: number, fps: number): number {
  return Math.floor((elapsedUs * fps) / 1_000_000);
}

export class WebCodecsRecorder implements CardRecorder {
  readonly kind = 'webcodecs' as const;

  private video: VideoEncoder | null = null;
  private audio: AudioEncoder | null = null;
  private tap: AudioWorkletNode | null = null;
  private videoSamples: MuxSample[] = [];
  private audioSamples: MuxSample[] = [];
  private videoDescription: Uint8Array | null = null;
  private audioDescription: Uint8Array | null = null;
  private videoOutputs = 0;
  private failure: Error | null = null;

  private taking = false;
  private paused = false;
  /** performance.now() at `begin`, moved forward by every pause. */
  private takeStart = 0;
  /**
   * Timestamp (µs) of the take's first frame. The pre-roll frames sit below
   * it, so the encoder sees one monotonic timeline — it must: a negative
   * pre-roll timestamp stalled the hardware encoder after five frames and its
   * `flush()` never returned. Chunks under `base` are the pre-roll and are
   * dropped; the muxer removes `base` from everything else.
   */
  private base = 0;
  private pausedAt = 0;
  private lastSlot = -1;
  private lastKeySlot = -1;
  private forceKey = false;
  private prerollTimer = 0;
  private prerollFrames = 0;
  framesSkipped = 0;

  /** Audio clock (seconds) that maps to recording time zero; moves with pauses. */
  private audioOrigin = 0;
  private audioPausedAt = 0;
  /** End of the last accepted audio buffer, in recording seconds. */
  private audioEnd = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly fps: number,
    private readonly plan: WebCodecsPlan,
    private readonly graph: AudioGraph | null,
  ) {}

  private fail(error: unknown): void {
    if (!this.failure) this.failure = error instanceof Error ? error : new Error(String(error));
  }

  async preroll(): Promise<boolean> {
    const video = new VideoEncoder({
      output: (chunk, metadata) => this.onVideoChunk(chunk, metadata),
      error: (error) => this.fail(error),
    });
    video.configure(this.plan.videoConfig);
    this.video = video;

    if (this.graph && this.plan.audioConfig) {
      const audio = new AudioEncoder({
        output: (chunk, metadata) => this.onAudioChunk(chunk, metadata),
        error: (error) => this.fail(error),
      });
      audio.configure(this.plan.audioConfig);
      this.audio = audio;
      try {
        await this.spliceTap(this.graph);
      } catch (error) {
        this.fail(error);
        return false;
      }
    }

    // Still frames, at the take's own cadence, until the encoder has shown it
    // is up by producing output — or for long enough that it plainly will not.
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const step = () => {
        this.encodeCanvas(this.prerollFrames * Math.round(1_000_000 / this.fps), this.prerollFrames === 0);
        this.prerollFrames += 1;
        const elapsed = performance.now() - started;
        if ((this.videoOutputs > 0 && elapsed >= PREROLL_MIN_MS) || elapsed >= PREROLL_MAX_MS || this.failure) {
          resolve();
          return;
        }
        this.prerollTimer = setTimeout(step, 1000 / this.fps) as unknown as number;
      };
      step();
    });
    // An encoder that has taken a second and a half of frames and returned
    // nothing is not going to start now; say so while there is still time to
    // record another way.
    return this.videoOutputs > 0 && !this.failure;
  }

  private async spliceTap(graph: AudioGraph): Promise<void> {
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
    try {
      await graph.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const tap = new AudioWorkletNode(graph.context, 'pnl-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    tap.port.onmessage = (event: MessageEvent<TapMessage>) => this.onAudio(event.data);
    // element → source → tap → destination: the destination keeps the tap
    // pulled, and the stream it feeds is unchanged for anything else.
    graph.source.disconnect(graph.destination);
    graph.source.connect(tap);
    tap.connect(graph.destination);
    this.tap = tap;
  }

  begin(): void {
    clearTimeout(this.prerollTimer);
    this.taking = true;
    this.paused = false;
    this.takeStart = performance.now();
    // One empty slot after the last pre-roll frame, so nothing can share it.
    this.base = (this.prerollFrames + 1) * Math.round(1_000_000 / this.fps);
    this.lastSlot = -1;
    this.lastKeySlot = -1;
    this.forceKey = true;
    if (this.graph) {
      this.audioOrigin = this.graph.context.currentTime;
      this.audioEnd = 0;
    }
  }

  frame(): void {
    if (!this.taking || this.paused || !this.video) return;
    const elapsedUs = (performance.now() - this.takeStart) * 1000;
    const slot = frameSlot(elapsedUs, this.fps);
    if (slot <= this.lastSlot) return;
    if (this.video.encodeQueueSize > MAX_ENCODE_QUEUE) {
      this.framesSkipped += 1;
      return;
    }
    const key = this.forceKey || slot - this.lastKeySlot >= KEYFRAME_SECONDS * this.fps;
    this.encodeCanvas(this.base + Math.round(slot * (1_000_000 / this.fps)), key);
    this.lastSlot = slot;
    if (key) {
      this.lastKeySlot = slot;
      this.forceKey = false;
    }
  }

  private encodeCanvas(timestamp: number, key: boolean): void {
    if (!this.video || this.video.state !== 'configured') return;
    let frame: VideoFrame;
    try {
      frame = new VideoFrame(this.canvas, { timestamp });
    } catch (error) {
      this.fail(error);
      return;
    }
    try {
      this.video.encode(frame, { keyFrame: key });
    } catch (error) {
      this.fail(error);
    } finally {
      frame.close();
    }
  }

  pause(): void {
    if (!this.taking || this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
    if (this.graph) this.audioPausedAt = this.graph.context.currentTime;
  }

  resume(): void {
    if (!this.taking || !this.paused) return;
    const away = performance.now() - this.pausedAt;
    this.takeStart += away;
    if (this.graph) this.audioOrigin += this.graph.context.currentTime - this.audioPausedAt;
    this.paused = false;
    // A key frame at every join: a player that seeks lands on a clean picture.
    this.forceKey = true;
  }

  private onVideoChunk(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata): void {
    this.videoOutputs += 1;
    const description = metadata?.decoderConfig?.description;
    if (description && !this.videoDescription) this.videoDescription = toBytes(description);
    // Pre-roll frames sit below `base` and are not part of the file.
    if (!this.taking && !this.base) return;
    if (chunk.timestamp < this.base) return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.videoSamples.push({
      data,
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? Math.round(1_000_000 / this.fps),
      key: chunk.type === 'key',
    });
  }

  private onAudioChunk(chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata): void {
    const description = metadata?.decoderConfig?.description;
    if (description && !this.audioDescription) this.audioDescription = toBytes(description);
    if (chunk.timestamp < this.base) return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.audioSamples.push({
      data,
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? 0,
      key: true,
    });
  }

  private onAudio(message: TapMessage): void {
    if (!this.audio || this.audio.state !== 'configured' || !this.graph) return;
    if (!this.taking || this.paused) return;
    const rate = this.graph.context.sampleRate;
    let start = message.startFrame / rate - this.audioOrigin;
    let frames = message.frames;
    let offset = 0;
    // A buffer that straddles the take's start, or overlaps what has already
    // been accepted after a resume, is trimmed to the part that is new.
    const skipTo = Math.max(0, this.audioEnd);
    if (start < skipTo) {
      const drop = Math.min(frames, Math.round((skipTo - start) * rate));
      offset = drop;
      frames -= drop;
      start += drop / rate;
    }
    if (frames <= 0) return;
    const channels = message.channels;
    const planar = new Float32Array(channels * frames);
    for (let c = 0; c < channels; c += 1) {
      planar.set(message.data.subarray(c * message.frames + offset, c * message.frames + offset + frames), c * frames);
    }
    let data: AudioData;
    try {
      data = new AudioData({
        format: 'f32-planar',
        sampleRate: rate,
        numberOfFrames: frames,
        numberOfChannels: channels,
        // On the same timeline as the picture: `base` plus recording time.
        timestamp: this.base + Math.round(start * 1_000_000),
        data: planar,
      });
    } catch (error) {
      this.fail(error);
      return;
    }
    try {
      this.audio.encode(data);
      this.audioEnd = start + frames / rate;
    } catch (error) {
      this.fail(error);
    } finally {
      data.close();
    }
  }

  async finish(): Promise<RecordedFile> {
    clearTimeout(this.prerollTimer);
    this.taking = false;
    const video = this.video;
    const audio = this.audio;
    // Bounded: an encoder that never answers its flush must not hang the
    // export. Whatever it has produced by then is the file.
    const flushBudget = wait(FLUSH_MAX_MS);
    try {
      if (video && video.state === 'configured') await Promise.race([video.flush(), flushBudget]);
      if (audio && audio.state === 'configured') await Promise.race([audio.flush(), flushBudget]);
    } catch (error) {
      this.fail(error);
    }
    this.teardown();
    if (this.failure) throw this.failure;
    if (!this.videoDescription) throw new Error('The encoder produced no stream description.');
    if (!this.videoSamples.length) throw new Error('The encoder produced no frames.');

    const written = writeMp4({
      video: {
        width: this.canvas.width,
        height: this.canvas.height,
        description: this.videoDescription,
        samples: this.videoSamples,
      },
      audio:
        this.graph && this.audioDescription && this.audioSamples.length
          ? {
              sampleRate: this.graph.context.sampleRate,
              channels: 2,
              description: this.audioDescription,
              samples: this.audioSamples,
            }
          : null,
    });
    return {
      blob: new Blob([written.buffer], { type: 'video/mp4' }),
      mimeType: 'video/mp4',
      extension: 'mp4',
      duration: written.durationSeconds,
      repair: {
        patched: false,
        videoSeconds: written.videoSeconds,
        audioSeconds: written.audioSeconds,
        audioLeadSeconds: 0,
        durationSeconds: written.durationSeconds,
      },
      recorder: 'webcodecs',
      framesSkipped: this.framesSkipped,
    };
  }

  abort(): void {
    clearTimeout(this.prerollTimer);
    this.taking = false;
    this.teardown();
  }

  private teardown(): void {
    try {
      if (this.video && this.video.state !== 'closed') this.video.close();
    } catch {
      /* closed */
    }
    try {
      if (this.audio && this.audio.state !== 'closed') this.audio.close();
    } catch {
      /* closed */
    }
    if (this.tap && this.graph) {
      try {
        this.tap.port.onmessage = null;
        this.tap.disconnect();
        this.graph.source.disconnect();
        this.graph.source.connect(this.graph.destination);
      } catch {
        /* the context is going away with the export */
      }
    }
    this.video = null;
    this.audio = null;
    this.tap = null;
  }
}

function toBytes(description: AllowSharedBufferSource): Uint8Array {
  if (description instanceof ArrayBuffer) return new Uint8Array(description.slice(0));
  if (ArrayBuffer.isView(description)) {
    return new Uint8Array(description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength));
  }
  return new Uint8Array(0);
}

/* ------------------------------------------------------------------ */
/* MediaRecorder                                                       */
/* ------------------------------------------------------------------ */

export class MediaStreamRecorder implements CardRecorder {
  readonly kind = 'mediarecorder' as const;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopped: Promise<void> | null = null;
  private readonly frameRequest: (() => void) | null;

  constructor(
    private readonly stream: MediaStream,
    private readonly mimeType: string,
    private readonly extension: 'mp4' | 'webm',
    private readonly bitrate: number,
  ) {
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    this.frameRequest = track && typeof track.requestFrame === 'function' ? () => track.requestFrame() : null;
  }

  async preroll(): Promise<boolean> {
    // Nothing to bring up ahead of time: everything a MediaRecorder encodes is
    // in the file, so it can only start with the take.
    const recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.bitrate,
    });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error('The recorder failed mid-export.'));
    });
    // Marks the rejection handled if the export is cancelled before `finish`
    // awaits it; awaiting it there still surfaces the failure.
    this.stopped.catch(() => undefined);
    this.recorder = recorder;
    await wait(0);
    return true;
  }

  begin(): void {
    this.recorder?.start(250);
  }

  frame(): void {
    // `captureStream` samples the canvas on its own whenever it is drawn to.
  }

  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume();
    // `captureStream` would otherwise wait for its own next sampling instant,
    // which is up to a frame of dead time at the join.
    this.frameRequest?.();
  }

  async finish(): Promise<RecordedFile> {
    const recorder = this.recorder;
    if (!recorder || !this.stopped) throw new Error('The recorder was never started.');
    if (recorder.state !== 'inactive') recorder.stop();
    await this.stopped;
    const recorded = new Blob(this.chunks, { type: this.mimeType });
    if (recorded.size === 0) throw new Error('The recorder produced an empty file.');
    // What comes out of `MediaRecorder` says it is zero seconds long and, when
    // the sound started late, plays out of step for its whole length. Both are
    // a few fields in the container. See `lib/mp4.ts`.
    const { buffer, repair } = repairFragmentedMp4(await recorded.arrayBuffer());
    const blob = repair.patched ? new Blob([buffer], { type: this.mimeType }) : recorded;
    return {
      blob,
      mimeType: this.mimeType,
      extension: this.extension,
      duration: repair.patched ? repair.durationSeconds : 0,
      repair,
      recorder: 'mediarecorder',
      framesSkipped: 0,
    };
  }

  abort(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }
}

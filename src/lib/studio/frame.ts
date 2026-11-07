/**
 * The video studio's frame: the card in a chosen shape (`canvas/spec.ts`
 * `FRAMES`) with a clip as its background. `aspect: 'card'` is the card exactly
 * as the editor has always made it; in the others the frame extends and the
 * card's content stays at its own left margin.
 *
 * One function paints a frame (`paintStudioFrame`). The live preview calls it
 * with a playing `<video>`; the exporter (`compose.ts`) calls it with each
 * decoded frame. Same function, same pixels.
 *
 * Both halves are the card renderer's own, so a video frame and a PNG of the
 * same shape match; nothing about the card is drawn twice.
 */

import type { CardState, RenderAssets, StudioAspect, StudioClip, StudioState } from '../../types';
import { buildContent } from '../content';
import { computeCard } from '../pnl';
import { ASPECTS, CARD, VIDEO_SIZE, cardTop, frameOf } from '../canvas/spec';
import { drawCardBackground, drawCardForeground, foregroundKey, type DrawInput } from '../canvas/draw';
import type { Ctx2D } from '../canvas/primitives';

export { ASPECTS };

/** Exported picture size per frame. */
export const EXPORT_SIZE: Record<StudioAspect, { width: number; height: number }> = VIDEO_SIZE;

export function aspectRatio(aspect: StudioAspect): number {
  const { width, height } = EXPORT_SIZE[aspect];
  return width / height;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the card's own 840×570 sits in a `width × height` frame: flush left,
 * centred down. The card does not move — only the clip behind it does — so
 * this is the same rectangle in the preview and in the file.
 */
export function cardRect(studio: StudioState, width: number, height: number): Rect {
  const frame = frameOf(studio.aspect);
  const sx = width / frame.width;
  const sy = height / frame.height;
  return { x: 0, y: cardTop(studio.aspect) * sy, w: CARD.width * sx, h: CARD.height * sy };
}

/** A picture to paint: a playing `<video>`, a decoded `VideoFrame`, a canvas. */
export interface FrameSource {
  element: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * The card's foreground at one pixel size, painted once and reused while the
 * clip moves under it. Keyed like `renderToCanvas`'s own layer.
 */
export class ForegroundCache {
  private canvas: HTMLCanvasElement | null = null;
  private key = '';

  get(input: DrawInput, w: number, h: number): HTMLCanvasElement | null {
    const pw = Math.max(1, Math.round(w));
    const ph = Math.max(1, Math.round(h));
    const key = `${foregroundKey(input)}\u0000${pw}x${ph}`;
    if (this.canvas && key === this.key) return this.canvas;
    const canvas = this.canvas ?? document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    const frame = frameOf(input.state.display.aspect);
    ctx.setTransform(pw / frame.width, 0, 0, ph / frame.height, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    drawCardForeground(ctx, input);
    this.canvas = canvas;
    this.key = key;
    return canvas;
  }
}

/** The card state as the frame paints it: the studio's shape, the clip as its background. */
export function stateForClip(state: CardState, clip: StudioClip | null): CardState {
  const shaped = { ...state, display: { ...state.display, aspect: state.studio.aspect } };
  if (!clip) return shaped;
  return {
    ...shaped,
    artwork: {
      ...state.artwork,
      imageId: clip.mediaId,
      sceneId: null,
      zoom: clip.zoom,
      offsetX: clip.offsetX,
      offsetY: clip.offsetY,
    },
  };
}

/**
 * Paints one frame of the studio into `ctx`, which is `width × height` pixels
 * with an identity transform.
 */
export function paintStudioFrame(
  ctx: Ctx2D,
  width: number,
  height: number,
  state: CardState,
  clip: StudioClip | null,
  source: FrameSource | null,
  assets: RenderAssets,
  cache: ForegroundCache,
): void {
  const clipState = stateForClip(state, clip);
  const result = computeCard(clipState);
  const media =
    source && source.width > 0 && source.height > 0
      ? { kind: 'video' as const, element: source.element as never, width: source.width, height: source.height, duration: 0 }
      : null;
  const input: DrawInput = {
    state: clipState,
    content: buildContent(clipState, result),
    result,
    assets: { ...assets, artwork: media },
  };

  ctx.save();
  // The card exactly as the editor paints it, with this clip behind it.
  const frame = frameOf(clipState.display.aspect);
  ctx.setTransform(width / frame.width, 0, 0, height / frame.height, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  if (!media) {
    // No clip yet: the card's own ground, so the frame is never empty.
    drawCardBackground(ctx, { ...input, state: { ...clipState, artwork: { ...clipState.artwork, imageId: null } } });
  } else {
    drawCardBackground(ctx, input);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const layer = cache.get(input, width, height);
  if (layer) ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* The timeline                                                        */
/* ------------------------------------------------------------------ */

/** Clips laid end to end: where each starts on the timeline, and the total. */
export function timeline(clips: readonly StudioClip[]): { starts: number[]; total: number } {
  const starts: number[] = [];
  let total = 0;
  for (const clip of clips) {
    starts.push(total);
    total += Math.max(0, clip.length);
  }
  return { starts, total };
}

/** The clip playing at timeline time `t`, and how far into the file it is. */
export function clipAt(
  clips: readonly StudioClip[],
  t: number,
): { index: number; clip: StudioClip; fileTime: number } | null {
  const { starts, total } = timeline(clips);
  if (!clips.length || total <= 0) return null;
  const at = Math.min(Math.max(0, t), total - 1e-6);
  for (let i = clips.length - 1; i >= 0; i -= 1) {
    if (at >= starts[i]!) {
      const clip = clips[i]!;
      return { index: i, clip, fileTime: clip.start + (at - starts[i]!) };
    }
  }
  return null;
}

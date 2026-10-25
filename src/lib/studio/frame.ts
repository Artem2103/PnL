/**
 * The video studio's frame: a clip filling a 16:9, 4:3 or 1:1 picture with the
 * card laid over it, or — `aspect: 'card'` — the card itself with the clip as
 * its background, exactly as the editor has always made it.
 *
 * One function paints a frame (`paintStudioFrame`). The live preview calls it
 * with a playing `<video>`; the exporter (`compose.ts`) calls it with each
 * decoded frame. Same function, same pixels.
 *
 * The card part is the card renderer's own foreground (`drawCardForeground`),
 * drawn into the card's rectangle; nothing about the card is drawn twice.
 */

import type { CardState, RenderAssets, StudioAspect, StudioClip, StudioState } from '../../types';
import { buildContent } from '../content';
import { computeCard } from '../pnl';
import { CARD } from '../canvas/spec';
import { drawCardBackground, drawCardForeground, foregroundKey, type DrawInput } from '../canvas/draw';
import { placeCover } from '../canvas/placement';
import type { Ctx2D } from '../canvas/primitives';

/** Exported picture size per frame. The card keeps the editor's 2× export. */
export const EXPORT_SIZE: Record<StudioAspect, { width: number; height: number }> = {
  card: { width: CARD.width * 2, height: CARD.height * 2 },
  '16:9': { width: 1920, height: 1080 },
  '4:3': { width: 1440, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

export const ASPECTS: readonly { id: StudioAspect; label: string }[] = [
  { id: 'card', label: 'Card' },
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: '1:1', label: '1:1' },
];

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
 * Where the card sits in a `width × height` frame: as large as fits, centred.
 * The card does not move — only the clip behind it does — so this is the
 * same rectangle in the preview and in the file.
 */
export function cardRect(studio: StudioState, width: number, height: number): Rect {
  if (studio.aspect === 'card') return { x: 0, y: 0, w: width, h: height };
  let w = width;
  let h = (w * CARD.height) / CARD.width;
  if (h > height) {
    h = height;
    w = (h * CARD.width) / CARD.height;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
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
    ctx.setTransform(pw / CARD.width, 0, 0, ph / CARD.height, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    drawCardForeground(ctx, input);
    this.canvas = canvas;
    this.key = key;
    return canvas;
  }
}

/** The card state as the frame paints it: the clip as its background, placed as the clip says. */
export function stateForClip(state: CardState, clip: StudioClip | null): CardState {
  if (!clip) return state;
  return {
    ...state,
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
  const studio = state.studio;
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
  if (studio.aspect === 'card') {
    // The card exactly as the editor paints it, with this clip behind it.
    ctx.setTransform(width / CARD.width, 0, 0, height / CARD.height, 0, 0);
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
    return;
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (media && clip) {
    const placed = placeCover(media.width, media.height, width, height, clip.zoom, clip.offsetX, clip.offsetY);
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(source!.element, placed.x, placed.y, placed.w, placed.h);
  }

  const rect = cardRect(studio, width, height);
  const layer = cache.get(input, rect.w, rect.h);
  if (layer) ctx.drawImage(layer, Math.round(rect.x), Math.round(rect.y));
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

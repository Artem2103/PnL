import type { BackgroundMedia, CardState, RenderAssets } from '../types';
import { buildContent } from './content';
import { drawCardBackground, drawCardForeground, foregroundKey, type DrawInput } from './canvas/draw';
import { CARD } from './canvas/spec';
import { ensureFonts } from './fonts';
import { loadImageElement, loadMedia, peekImageElement, peekMedia } from './images';
import { computeCard } from './pnl';

/** Browsers cap canvas dimensions; 8192 is the safe floor across engines. */
const MAX_CANVAS_EDGE = 8192;

export { CARD };

/** Highest scale that keeps both edges within the canvas limit. */
export function clampScale(scale: number): number {
  const limit = MAX_CANVAS_EDGE / Math.max(CARD.width, CARD.height);
  return Math.max(0.25, Math.min(scale, limit));
}

async function resolve(id: string | null): Promise<HTMLImageElement | null> {
  if (!id) return null;
  return peekImageElement(id) ?? (await loadImageElement(id));
}

async function resolveBackground(id: string | null): Promise<BackgroundMedia | null> {
  if (!id) return null;
  const media = peekMedia(id) ?? (await loadMedia(id));
  if (!media) return null;
  return {
    kind: media.kind,
    element: media.element,
    width: media.width,
    height: media.height,
    duration: media.duration,
  };
}

/**
 * Resolves everything asynchronous the renderer needs. Callers await this once
 * and then paint synchronously, so every frame is complete — no half-drawn
 * card can reach the screen, a PNG or a video frame.
 */
export async function prepareAssets(state: CardState): Promise<RenderAssets> {
  await ensureFonts();
  const [artwork, avatar, logo] = await Promise.all([
    resolveBackground(state.artwork.imageId),
    resolve(state.avatarId),
    resolve(state.logoId),
  ]);
  return { artwork, avatar, logo };
}

/* ------------------------------------------------------------------ */
/* Foreground layer cache                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything above the background — title, block, rows, handle, footer — is
 * identical from frame to frame while a clip plays, yet it is by far the most
 * expensive half to paint: a dozen shaped, ink-aligned strings. So it is
 * painted once into a transparent layer the size of the target canvas and
 * blitted 1:1 on every subsequent frame.
 *
 * This is a cache, not a second renderer. `drawCardForeground` is still the
 * only code that paints those pixels, and the PNG, the preview and every video
 * frame all go through this same function — so the three cannot drift apart.
 * The layer is keyed by the target size and by everything the foreground
 * reads, and is repainted the moment any of it changes.
 */
interface ForegroundLayer {
  canvas: HTMLCanvasElement;
  key: string;
  width: number;
  height: number;
}

const layers = new WeakMap<HTMLCanvasElement, ForegroundLayer>();

function foregroundLayerFor(
  target: HTMLCanvasElement,
  input: DrawInput,
  pixelWidth: number,
  pixelHeight: number,
): HTMLCanvasElement | null {
  const key = foregroundKey(input);
  const cached = layers.get(target);
  if (cached && cached.key === key && cached.width === pixelWidth && cached.height === pixelHeight) {
    return cached.canvas;
  }

  const canvas = cached?.canvas ?? document.createElement('canvas');
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  ctx.setTransform(pixelWidth / CARD.width, 0, 0, pixelHeight / CARD.height, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  drawCardForeground(ctx, input);

  layers.set(target, { canvas, key, width: pixelWidth, height: pixelHeight });
  return canvas;
}

/**
 * Paints `state` into `canvas` at `scale`× the design size.
 *
 * This is the single painting path in the app. The on-screen preview calls it
 * with the device pixel ratio; the exporter calls it with 2× or 3× on a
 * detached canvas. Same function, same inputs, same pixels.
 */
export function renderToCanvas(
  canvas: HTMLCanvasElement,
  state: CardState,
  assets: RenderAssets,
  scale: number,
): void {
  const safeScale = clampScale(scale);
  const pixelWidth = Math.round(CARD.width * safeScale);
  const pixelHeight = Math.round(CARD.height * safeScale);

  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const result = computeCard(state);
  const input: DrawInput = { state, content: buildContent(state, result), result, assets };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  // Everything downstream draws in design units; the scale lives here alone.
  ctx.setTransform(pixelWidth / CARD.width, 0, 0, pixelHeight / CARD.height, 0, 0);
  ctx.imageSmoothingQuality = 'high';

  drawCardBackground(ctx, input);

  const layer = foregroundLayerFor(canvas, input, pixelWidth, pixelHeight);
  if (layer) {
    // 1:1, untransformed — a straight copy, no resampling, so the layer's
    // pixels land exactly where drawing them in place would have put them.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  } else {
    // No second context available (an exotic browser, or memory pressure):
    // paint straight onto the card instead of showing nothing.
    drawCardForeground(ctx, input);
  }
}

export function renderToOffscreenCanvas(
  state: CardState,
  assets: RenderAssets,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  renderToCanvas(canvas, state, assets, scale);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the image.'));
    }, type);
  });
}

/** Renders a fresh, detached card and returns it as a PNG blob. */
export async function renderCardBlob(state: CardState, scale: number): Promise<Blob> {
  const assets = await prepareAssets(state);
  const canvas = renderToOffscreenCanvas(state, assets, scale);
  return canvasToBlob(canvas);
}

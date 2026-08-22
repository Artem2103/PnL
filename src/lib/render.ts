import type { CardState, RenderAssets } from '../types';
import { buildContent } from './content';
import { drawCard } from './canvas/draw';
import { CARD } from './canvas/spec';
import { ensureFonts } from './fonts';
import { loadImageElement, peekImageElement } from './images';
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

/**
 * Resolves everything asynchronous the renderer needs. Callers await this once
 * and then paint synchronously, so every frame is complete — no half-drawn
 * card can reach the screen or a PNG.
 */
export async function prepareAssets(state: CardState): Promise<RenderAssets> {
  await ensureFonts();
  const [artwork, avatar, logo] = await Promise.all([
    resolve(state.artwork.imageId),
    resolve(state.avatarId),
    resolve(state.logoId),
  ]);
  return { artwork, avatar, logo };
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

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  // Everything downstream draws in design units; the scale lives here alone.
  ctx.setTransform(pixelWidth / CARD.width, 0, 0, pixelHeight / CARD.height, 0, 0);
  ctx.imageSmoothingQuality = 'high';

  const result = computeCard(state);
  drawCard(ctx, CARD.width, CARD.height, {
    state,
    content: buildContent(state, result),
    result,
    assets,
  });
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

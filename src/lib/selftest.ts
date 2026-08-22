import type { CardState } from '../types';
import { CARD, prepareAssets, renderToOffscreenCanvas } from './render';

export interface ExportCheck {
  ok: boolean;
  /** Largest per-channel difference found between preview and export pixels. */
  maxDelta: number;
  /** Share of pixels differing by more than 2/255 on any channel. */
  mismatchRatio: number;
  width: number;
  height: number;
  note?: string;
}

/**
 * Renders the export path at the preview's exact pixel size and diffs the two
 * bitmaps, proving the download is the same image on screen — and that no
 * editor chrome leaks into it. Exposed as `window.__pnlCheckExport()` in dev.
 */
export async function checkExportMatchesPreview(
  state: CardState,
  previewCanvas: HTMLCanvasElement,
): Promise<ExportCheck> {
  const width = previewCanvas.width;
  const height = previewCanvas.height;
  if (!width || !height) {
    return { ok: false, maxDelta: 255, mismatchRatio: 1, width, height, note: 'Preview is empty.' };
  }

  const assets = await prepareAssets(state);
  // Same scale the preview used, so the comparison is pixel-for-pixel.
  const scale = width / CARD.width;
  const exportCanvas = renderToOffscreenCanvas(state, assets, scale);

  if (exportCanvas.width !== width || exportCanvas.height !== height) {
    return {
      ok: false,
      maxDelta: 255,
      mismatchRatio: 1,
      width,
      height,
      note: `Size mismatch: preview ${width}×${height}, export ${exportCanvas.width}×${exportCanvas.height}.`,
    };
  }

  const a = previewCanvas.getContext('2d')?.getImageData(0, 0, width, height);
  const b = exportCanvas.getContext('2d')?.getImageData(0, 0, width, height);
  if (!a || !b) {
    return { ok: false, maxDelta: 255, mismatchRatio: 1, width, height, note: 'Could not read pixels.' };
  }

  let maxDelta = 0;
  let mismatched = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelDelta = 0;
    for (let c = 0; c < 4; c += 1) {
      const delta = Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
      if (delta > pixelDelta) pixelDelta = delta;
    }
    if (pixelDelta > maxDelta) maxDelta = pixelDelta;
    if (pixelDelta > 2) mismatched += 1;
  }

  const totalPixels = a.data.length / 4 || 1;
  const mismatchRatio = mismatched / totalPixels;
  return { ok: mismatchRatio === 0, maxDelta, mismatchRatio, width, height };
}

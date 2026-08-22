import type { CardState } from '../types';
import { CARD, prepareAssets, renderToOffscreenCanvas } from './render';

/**
 * A frame, or 120 ms — whichever comes first, reporting which it was.
 * `requestAnimationFrame` stops firing altogether when the window is hidden or
 * covered, and a check that never returns is worse than one that waits a
 * little longer than it needs to. Whether a real frame arrived matters: the
 * preview canvas cannot have been repainted without one.
 */
function nextFrame(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (painted: boolean) => {
      if (done) return;
      done = true;
      resolve(painted);
    };
    requestAnimationFrame(() => finish(true));
    setTimeout(() => finish(false), 120);
  });
}

/**
 * Holds a clip still so the two paints can be compared at all. A background
 * that is moving would differ between them for the honest reason that time
 * passed, which says nothing about the renderer.
 *
 * Waits out any pending seek too: mid-seek a `<video>` drops back to
 * HAVE_METADATA and paints nothing, so one path would get a frame and the
 * other the empty ground.
 */
async function freeze(video: HTMLVideoElement): Promise<string> {
  video.pause();
  const deadline = Date.now() + 3000;
  while ((video.seeking || video.readyState < 2) && Date.now() < deadline) {
    await nextFrame();
  }
  // Two frames: one for the preview loop to repaint the held frame, one for it
  // to reach the canvas.
  const first = await nextFrame();
  const second = await nextFrame();
  const held = `clip held at ${video.currentTime.toFixed(3)}s, readyState ${video.readyState}`;
  if (!first || !second) {
    return `${held} — but the page was not painting (tab hidden or covered), so the preview canvas is stale and this comparison means nothing. Re-run it with the window in front.`;
  }
  return held;
}

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

  const artwork = assets.artwork;
  const held =
    artwork && artwork.kind === 'video'
      ? await freeze(artwork.element as HTMLVideoElement)
      : undefined;

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
  return { ok: mismatchRatio === 0, maxDelta, mismatchRatio, width, height, note: held };
}

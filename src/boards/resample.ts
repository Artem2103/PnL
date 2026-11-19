/**
 * Canvas copies of a chart screenshot, made at exactly the widths the board
 * draws them, so at those zooms the browser shows them pixel for pixel and
 * never has to shrink them itself (its quick on-screen resize is what blurs
 * thin candle wicks and small price labels).
 *
 * Shrinking happens here instead, in halves: each step averages 2×2 pixels into
 * one, so no detail is skipped. Then one last step lands on the exact width.
 */

export interface SizedCopy {
  w: number;
  h: number;
  blob: Blob;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function draw(from: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(from, 0, 0, w, h);
  return canvas;
}

function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Quality 1: as close to lossless as the browser's WebP encoder goes, so
    // text edges keep no compression smudge. Browsers that can't write WebP
    // hand back a PNG, which is lossless anyway.
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the picture.'))), 'image/webp', 1);
  });
}

/** One copy per width, each narrower than the original; wider ones are skipped (the original serves). */
export async function sizedCopies(file: Blob, widths: readonly number[]): Promise<SizedCopy[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const out: SizedCopy[] = [];
    for (const w of widths) {
      if (w >= bitmap.width) continue;
      const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
      let current: CanvasImageSource = bitmap;
      let cw = bitmap.width;
      let ch = bitmap.height;
      while (cw / 2 >= w) {
        cw = Math.round(cw / 2);
        ch = Math.round(ch / 2);
        current = draw(current, cw, ch);
      }
      const final = cw === w ? (current as HTMLCanvasElement) : draw(current, w, h);
      out.push({ w, h: final.height, blob: await encode(final) });
    }
    return out;
  } finally {
    bitmap.close();
  }
}

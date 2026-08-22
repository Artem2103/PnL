/**
 * Where the background sits inside the card.
 *
 * Kept pure and separate from the drawing code because two callers need the
 * same answer: `draw.ts` to paint the frame, and the preview to translate a
 * drag in screen pixels into a pan value. If they disagreed, dragging the
 * photo would not move it by the distance the pointer travelled.
 */

export interface CoverPlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Half the horizontal spill past the card edge, in design px. */
  overflowX: number;
  /** Half the vertical spill past the card edge, in design px. */
  overflowY: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Cover fit plus pan. Pan is expressed as a share of the available overflow
 * (-1 = flush left/top, +1 = flush right/bottom), so a slider behaves the same
 * for any source aspect ratio and the subject can never be dragged out of the
 * frame leaving a gap.
 */
export function placeCover(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
): CoverPlacement {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight) * safeZoom;
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  const overflowX = Math.max(0, w - boxWidth) / 2;
  const overflowY = Math.max(0, h - boxHeight) / 2;
  return {
    x: (boxWidth - w) / 2 + overflowX * clamp(offsetX, -1, 1),
    y: (boxHeight - h) / 2 + overflowY * clamp(offsetY, -1, 1),
    w,
    h,
    overflowX,
    overflowY,
  };
}

/**
 * New pan value after dragging `deltaPx` design pixels along an axis with
 * `overflow` px of slack. With no slack the photo cannot move, so the offset
 * stays put rather than drifting into a value that does nothing.
 */
export function panBy(offset: number, deltaPx: number, overflow: number): number {
  if (overflow <= 0) return clamp(offset, -1, 1);
  return clamp(offset + deltaPx / overflow, -1, 1);
}

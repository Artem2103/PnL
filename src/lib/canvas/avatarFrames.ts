import { badgePalette } from '../frames';
import { withAlpha } from '../color';
import { AVATAR_TAG, SPEC } from './spec';
import {
  cachedGradient,
  conicGradient,
  linearGradient,
  roundRectPath,
  type Ctx2D,
  type GradientStop,
} from './primitives';

/**
 * Where the picture goes once a frame has been painted around it. Every frame
 * paints everything but the picture and hands this back, so the caller can
 * clip the avatar into it without the two sets of insets having to agree by
 * hand.
 */
export interface PictureSlot {
  x: number;
  y: number;
  size: number;
  radius: number;
}

export interface FrameStyle {
  /** An id from `FRAMES`. Unknown ids paint the pin. */
  frameId: string;
  /** The pin's base colour. Ignored by every other frame. */
  frameColor: string;
  /** The card's accent, already made legible on the ground. The halo uses it. */
  accent: string;
  /** The card's ink. The stamp and the corners use it. */
  ink: string;
}

/**
 * Paints the chosen frame into the avatar's slot — `x`, `y`, `size` are the
 * slot's outer square — and returns the hole left for the picture.
 *
 * Every frame stays inside the slot's footprint sideways and below; the pin
 * and the tag rise above it, which the reference cards do too. The slot's
 * footprint is load-bearing (it sets the left edge and the gap to the handle),
 * so no frame grows outside it: a frame is what a frame does to a picture.
 */
export function drawAvatarFrame(
  ctx: Ctx2D,
  x: number,
  y: number,
  size: number,
  style: FrameStyle,
): PictureSlot {
  switch (style.frameId) {
    case 'none':
      return { x, y, size, radius: 0 };
    case 'tag':
      return drawTag(ctx, x, y, size);
    case 'gilt':
      return drawGilt(ctx, x, y, size);
    case 'halo':
      return drawHalo(ctx, x, y, size, style.accent);
    case 'stamp':
      return drawStamp(ctx, x, y, size, style.ink);
    case 'corners':
      return drawCorners(ctx, x, y, size, style.ink);
    case 'pin':
    default:
      return drawPin(ctx, x, y, size, style.frameColor);
  }
}

/* ------------------------------------------------------------------ */
/* Pin: the red badge from reference/frame.png, in any colour          */
/* ------------------------------------------------------------------ */

/**
 * A pip above a gradient ring. The geometry is `SPEC.avatarFrame`, traced off
 * the reference; the colours come from `badgePalette`, which gives any base
 * colour the ramp the reference red has.
 *
 * Order matters once. The pip's base overlaps nothing, but it sits close
 * enough to the ring (2.4 reference pixels) that painting it first and the
 * ring second keeps the ring's own antialiased edge on top, which is what the
 * reference shows.
 */
function drawPin(ctx: Ctx2D, x: number, y: number, size: number, color: string): PictureSlot {
  const f = SPEC.avatarFrame;
  const palette = badgePalette(color);
  const stroke = size * f.stroke;
  const inset = stroke + size * f.gap;
  const cx = x + size / 2;

  drawPip(ctx, cx, y, size, palette.pipLight, palette.pipFillStops);

  // Stroked on the midline, so the ring's outer edge lands on the slot's edge
  // and the gradient is sampled where the reference's was measured.
  ctx.save();
  roundRectPath(
    ctx,
    x + stroke / 2,
    y + stroke / 2,
    size - stroke,
    size - stroke,
    size * f.radius - stroke / 2,
  );
  ctx.strokeStyle = cachedGradient(ctx, `avatar-ring:${x}:${y}:${size}:${color}`, (target) =>
    conicGradient(target, 0, cx, y + size / 2, palette.ringStops, size),
  );
  ctx.lineWidth = stroke;
  ctx.stroke();
  ctx.restore();

  return {
    x: x + inset,
    y: y + inset,
    size: size - inset * 2,
    radius: size * f.pictureRadius,
  };
}

/**
 * The two-piece pip above the ring. Both pieces are slices of one wedge — the
 * flanks are parallel on the reference to within a fortieth of a pixel per row
 * — but they are drawn as two shapes rather than one clipped wedge because
 * they are not painted the same: the tip is solid light, the base is the vivid
 * fill inside a light outline.
 *
 * The base is two fills, not a fill and a stroke. Every number in the spec is
 * an outer edge, and a stroke is centred on its path, so stroking the measured
 * trapezoid puts half the outline outside the shape and paints it 14% too big.
 * Filling the measured shape in the outline colour and the inset shape in the
 * fill colour puts the outer edge exactly where it was measured.
 *
 * `y` is the ring's outer top edge; both pieces are measured up from it.
 */
function drawPip(
  ctx: Ctx2D,
  cx: number,
  y: number,
  size: number,
  light: string,
  fillStops: readonly GradientStop[],
): void {
  const p = SPEC.avatarFrame.pip;

  const bottom = y - size * p.baseRise;
  const top = bottom - size * p.baseHeight;
  const bottomHalf = size * p.baseBottomHalfWidth;
  const topHalf = size * p.baseTopHalfWidth;

  // Insetting a trapezoid is not the same as subtracting the outline width
  // from each edge: the flanks lean, so the same perpendicular step moves them
  // further sideways than it moves the flat top and bottom. `lean` is that
  // horizontal cost per unit of inset, off the flanks' own slope.
  const t = size * p.baseStroke;
  const slope = (bottomHalf - topHalf) / (bottom - top);
  const lean = Math.hypot(1, slope);

  const trapezoid = (yTop: number, yBottom: number, halfTop: number, halfBottom: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx - halfTop, yTop);
    ctx.lineTo(cx + halfTop, yTop);
    ctx.lineTo(cx + halfBottom, yBottom);
    ctx.lineTo(cx - halfBottom, yBottom);
    ctx.closePath();
    ctx.fill();
  };

  ctx.save();
  ctx.fillStyle = light;
  trapezoid(top, bottom, topHalf, bottomHalf);
  ctx.fillStyle = cachedGradient(ctx, `avatar-pip:${cx}:${bottom}:${size}:${light}`, (target) =>
    linearGradient(target, cx - bottomHalf, bottom, cx + bottomHalf, bottom, fillStops),
  );
  trapezoid(top + t, bottom - t, topHalf - t * (lean - slope), bottomHalf - t * (lean + slope));

  const tipBottom = y - size * p.tipRise;
  const tipHalf = size * p.tipHalfWidth;
  ctx.beginPath();
  ctx.moveTo(cx, tipBottom - size * p.tipHeight);
  ctx.lineTo(cx + tipHalf, tipBottom);
  ctx.lineTo(cx - tipHalf, tipBottom);
  ctx.closePath();
  ctx.fillStyle = light;
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Tag: the frame the reference cards wear                             */
/* ------------------------------------------------------------------ */

/**
 * A tan ring with a loop on top. Geometry in `SPEC.avatarTag`, colours in
 * `AVATAR_TAG`, both traced off the reference cards. The loop goes down first
 * so the ring's edge lies over its foot, as on the reference.
 */
function drawTag(ctx: Ctx2D, x: number, y: number, size: number): PictureSlot {
  const f = SPEC.avatarTag;
  const stroke = size * f.stroke;
  const inset = stroke + size * f.gap;
  const cx = x + size / 2;

  // The loop: four nested rounded rectangles, each inset from the last by one
  // band. The bottom is tucked under the ring rather than ending at it.
  const l = f.loop;
  const w = size * l.width;
  const top = y - size * l.rise;
  const bottom = y + stroke;
  const bands: Array<[number, string]> = [
    [0, AVATAR_TAG.loopLight],
    [size * l.outerBand, AVATAR_TAG.loopDark],
    [size * (l.outerBand + l.darkBand), AVATAR_TAG.loopMid],
    [size * (l.outerBand + l.darkBand + l.innerBand), AVATAR_TAG.loopDark],
  ];
  const innerBottom = y - size * l.innerFoot;
  ctx.save();
  bands.forEach(([band, color], i) => {
    const foot = i === 0 ? bottom : innerBottom;
    roundRectPath(ctx, cx - w / 2 + band, top + band, w - band * 2, foot - top - band, size * l.radius - band);
    ctx.fillStyle = color;
    ctx.fill();
  });

  roundRectPath(
    ctx,
    x + stroke / 2,
    y + stroke / 2,
    size - stroke,
    size - stroke,
    size * f.radius - stroke / 2,
  );
  ctx.strokeStyle = cachedGradient(ctx, `avatar-tag:${x}:${y}:${size}`, (target) =>
    conicGradient(target, 0, cx, y + size / 2, AVATAR_TAG.ringStops, size),
  );
  ctx.lineWidth = stroke;
  ctx.stroke();
  ctx.restore();

  return {
    x: x + inset,
    y: y + inset,
    size: size - inset * 2,
    radius: size * f.pictureRadius,
  };
}

/* ------------------------------------------------------------------ */
/* Gilt: a bevelled gold frame                                         */
/* ------------------------------------------------------------------ */

const GILT_STOPS: readonly GradientStop[] = [
  { offset: 0, color: '#FBEBA8' },
  { offset: 0.2, color: '#C9A227' },
  { offset: 0.42, color: '#FFF3BE' },
  { offset: 0.6, color: '#B8860B' },
  { offset: 0.8, color: '#F1D46A' },
  { offset: 1, color: '#7D5E00' },
];

/**
 * A metallic ramp run corner to corner, with a thin dark line along the inner
 * edge. The line is what makes it read as a bevel rather than a yellow band:
 * metal catches light on one face and shadows the other, and the shadowed
 * face is the one against the picture.
 */
function drawGilt(ctx: Ctx2D, x: number, y: number, size: number): PictureSlot {
  const stroke = size * (2.6 / 54.5);
  const gap = size * (1.2 / 54.5);
  const radius = size * 0.14;
  const inset = stroke + gap;

  ctx.save();
  roundRectPath(ctx, x + stroke / 2, y + stroke / 2, size - stroke, size - stroke, radius - stroke / 2);
  ctx.strokeStyle = cachedGradient(ctx, `avatar-gilt:${x}:${y}:${size}`, (target) =>
    linearGradient(target, x, y, x + size, y + size, GILT_STOPS),
  );
  ctx.lineWidth = stroke;
  ctx.stroke();

  const line = size * (0.7 / 54.5);
  roundRectPath(
    ctx,
    x + stroke - line / 2,
    y + stroke - line / 2,
    size - stroke * 2 + line,
    size - stroke * 2 + line,
    radius - stroke + line / 2,
  );
  ctx.strokeStyle = 'rgba(58, 38, 0, 0.6)';
  ctx.lineWidth = line;
  ctx.stroke();
  ctx.restore();

  return { x: x + inset, y: y + inset, size: size - inset * 2, radius: size * 0.09 };
}

/* ------------------------------------------------------------------ */
/* Halo: a glowing ring in the card's accent                           */
/* ------------------------------------------------------------------ */

/**
 * A crisp ring with a soft glow around it, both in the accent. The glow is
 * the same path stroked wider and fainter a few times over rather than a
 * canvas shadow, because a shadow's blur is in device pixels and would come
 * out three times tighter on a 3x export than in the preview.
 */
function drawHalo(ctx: Ctx2D, x: number, y: number, size: number, accent: string): PictureSlot {
  const stroke = size * (1.6 / 54.5);
  const gap = size * (2.2 / 54.5);
  const radius = size * 0.16;
  const inset = stroke + gap;
  const unit = size / 54.5;

  ctx.save();
  const passes = 6;
  for (let i = passes; i >= 1; i--) {
    const spread = i * 1.3 * unit;
    roundRectPath(
      ctx,
      x + stroke / 2 - spread / 2,
      y + stroke / 2 - spread / 2,
      size - stroke + spread,
      size - stroke + spread,
      radius - stroke / 2 + spread / 2,
    );
    ctx.strokeStyle = withAlpha(accent, 0.16 * ((passes - i + 1) / passes) ** 2);
    ctx.lineWidth = stroke + spread;
    ctx.stroke();
  }
  roundRectPath(ctx, x + stroke / 2, y + stroke / 2, size - stroke, size - stroke, radius - stroke / 2);
  ctx.strokeStyle = accent;
  ctx.lineWidth = stroke;
  ctx.stroke();
  ctx.restore();

  return { x: x + inset, y: y + inset, size: size - inset * 2, radius: size * 0.12 };
}

/* ------------------------------------------------------------------ */
/* Stamp: a perforated border in the ink                               */
/* ------------------------------------------------------------------ */

/**
 * A solid border with half-round notches along every edge, like a postage
 * stamp. One even-odd fill: the square plus a row of circles centred on its
 * outline, so the half of each circle that falls inside the square is cut
 * out of it and the half outside paints nothing.
 */
function drawStamp(ctx: Ctx2D, x: number, y: number, size: number, ink: string): PictureSlot {
  const unit = size / 54.5;
  const band = 4.2 * unit;
  const hole = 1.35 * unit;
  const perSide = 12;
  const pitch = size / perSide;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  for (let i = 0; i < perSide; i++) {
    const t = (i + 0.5) * pitch;
    const along: Array<[number, number]> = [
      [x + t, y],
      [x + t, y + size],
      [x, y + t],
      [x + size, y + t],
    ];
    for (const [px, py] of along) {
      ctx.moveTo(px + hole, py);
      ctx.arc(px, py, hole, 0, Math.PI * 2);
    }
  }
  // Corner notches, so the corners are cut like every other edge point.
  const corners: Array<[number, number]> = [
    [x, y],
    [x + size, y],
    [x, y + size],
    [x + size, y + size],
  ];
  for (const [px, py] of corners) {
    ctx.moveTo(px + hole, py);
    ctx.arc(px, py, hole, 0, Math.PI * 2);
  }
  ctx.fillStyle = ink;
  ctx.fill('evenodd');
  ctx.restore();

  return { x: x + band, y: y + band, size: size - band * 2, radius: 0 };
}

/* ------------------------------------------------------------------ */
/* Corners: four brackets in the ink                                   */
/* ------------------------------------------------------------------ */

/** Viewfinder brackets on the slot's corners, the picture inset inside them. */
function drawCorners(ctx: Ctx2D, x: number, y: number, size: number, ink: string): PictureSlot {
  const unit = size / 54.5;
  const thick = 2 * unit;
  const arm = size * 0.3;
  const inset = 4.2 * unit;

  ctx.save();
  ctx.fillStyle = ink;
  const signs: Array<[number, number]> = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const [sx, sy] of signs) {
    const ox = sx > 0 ? x : x + size;
    const oy = sy > 0 ? y : y + size;
    // Horizontal arm, then vertical, each anchored on the corner.
    ctx.fillRect(Math.min(ox, ox + sx * arm), Math.min(oy, oy + sy * thick), arm, thick);
    ctx.fillRect(Math.min(ox, ox + sx * thick), Math.min(oy, oy + sy * arm), thick, arm);
  }
  ctx.restore();

  return { x: x + inset, y: y + inset, size: size - inset * 2, radius: 0 };
}

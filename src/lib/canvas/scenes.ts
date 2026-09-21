import { radialBloom, withAlpha, type Ctx2D } from './primitives';

/**
 * The built-in background.
 *
 * There is one, it is called **Astra**, and it is a sky: the app's name is the
 * Latin for stars and its mark is a four-pointed spark, so the house background
 * is the thing the name already says. It is drawn by the renderer rather than
 * shipped as a file, which is what lets it cost no bytes, stay sharp at 3× and
 * paint identically in the preview, the PNG and every frame of a video.
 *
 * It replaced five faceted-solid scenes (blade, shards, prism, bullion, tide)
 * on 2026-09-22: they were the right genre for the reference cards and the
 * wrong one for this product, and all five were too dark to be the background
 * anyone reaches for first. This one is deliberately bright.
 *
 * Three rules for anything added here:
 *
 * 1. **No `shadowBlur`.** Canvas shadows are not scaled by the current
 *    transform, so a glow that looks right in the preview would be a third of
 *    the size in a 3× export — and the one invariant this renderer has is that
 *    the export matches the preview exactly. Glow is gradients, always.
 * 2. **Keep the left third quiet.** The title, the block and the rows live
 *    between x=30 and x=420. The sky is brightest on the right and fades across
 *    the text column, which is why this background needs no scrim to be read.
 * 3. **Nothing random.** Every star comes out of a seeded generator, because
 *    the preview, the PNG and every frame of a video export have to be the same
 *    sky. `Math.random` here would strobe through a video.
 */

export interface Scene {
  id: string;
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  /** The ground this scene sits on: the flat dark, and the pool of colour over it. */
  ground: readonly [string, string];
  /** The key light — the colour of the nebula and the bloom behind the star. */
  light: string;
  /** The colour of a star's core. */
  rim: string;
  draw: (ctx: Ctx2D, width: number, height: number) => void;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/** A tiny LCG, so a sky is the same sky every time it is painted. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** The flat dark, then a wide pool of colour over the right of it. */
function ground(ctx: Ctx2D, width: number, height: number, ramp: readonly [string, string]): void {
  ctx.save();
  ctx.fillStyle = ramp[0];
  ctx.fillRect(0, 0, width, height);
  const pool = ctx.createRadialGradient(
    width * 0.74,
    height * 0.46,
    0,
    width * 0.74,
    height * 0.46,
    width * 0.78,
  );
  pool.addColorStop(0, ramp[1]);
  pool.addColorStop(0.5, withAlpha(ramp[1], 0.5));
  pool.addColorStop(1, withAlpha(ramp[1], 0));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * A band of far stars — the galaxy seen edge on.
 *
 * An ellipse, not a rectangle: the first version faded the band's ends with a
 * `destination-out` pass over its own rect, and `destination-out` does not
 * erase only the band — it erases everything already painted inside that shape.
 * It was punching a rectangular hole through the nebula and the ground, and
 * the two hard diagonal edges that put across the sky were the giveaway.
 * Scaling the context turns one radial gradient into a soft-edged ellipse,
 * which needs no second pass at all.
 */
function band(
  ctx: Ctx2D,
  x: number,
  y: number,
  length: number,
  thickness: number,
  angle: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(1, thickness / length);
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, length / 2);
  wash.addColorStop(0, color);
  wash.addColorStop(0.45, withAlpha(color, 0.55));
  wash.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(-length / 2, -length / 2, length, length);
  ctx.restore();
}

/**
 * The four-pointed spark the app's mark is: two tapered rays crossed over a
 * round core, with a halo under it.
 *
 * Drawn from four triangles rather than a stroked cross, because a ray has to
 * be needle-thin at its tip and as wide as the core at its base — a stroke is
 * the same width along its whole length and reads as a plus sign.
 */
function spark(
  ctx: Ctx2D,
  x: number,
  y: number,
  reach: number,
  core: string,
  glow: string,
  alpha: number,
  spin = 0,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 0.8);
  halo.addColorStop(0, withAlpha(glow, 0.85));
  halo.addColorStop(0.35, withAlpha(glow, 0.28));
  halo.addColorStop(1, withAlpha(glow, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(-reach, -reach, reach * 2, reach * 2);

  ctx.rotate(spin);
  // The waist is what makes the rays concave rather than straight-sided: each
  // arm is two triangles meeting at a point a little off the centre.
  const waist = reach * 0.09;
  const rays = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  rays.addColorStop(0, core);
  rays.addColorStop(0.3, withAlpha(core, 0.75));
  rays.addColorStop(1, withAlpha(core, 0));
  ctx.fillStyle = rays;
  for (const angle of [0, Math.PI / 2]) {
    ctx.save();
    ctx.rotate(angle);
    for (const direction of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(waist * direction, -waist);
      ctx.lineTo(reach * direction, 0);
      ctx.lineTo(waist * direction, waist);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  const centre = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 0.16);
  centre.addColorStop(0, core);
  centre.addColorStop(1, withAlpha(core, 0));
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(0, 0, reach * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The field: plain round stars, dimmer towards the left so the text column
 * stays quiet, and a few of them warm rather than white — a sky of one colour
 * looks printed rather than seen.
 */
function stars(
  ctx: Ctx2D,
  width: number,
  height: number,
  count: number,
  seed: number,
  palette: readonly string[],
): void {
  const random = seeded(seed);
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const x = random() * width;
    const y = random() * height;
    // Squared, so most stars are small and a few are not.
    const size = 0.45 + random() * random() * 2.1;
    const colour = palette[Math.floor(random() * palette.length)] ?? '#FFFFFF';
    // Full strength on the right, a third of it under the title.
    const fade = 0.32 + 0.68 * Math.min(1, Math.max(0, (x / width - 0.12) / 0.55));
    ctx.globalAlpha = (0.25 + random() * 0.75) * fade;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    // The brightest few get a halo, which is what keeps a field of dots from
    // reading as noise.
    if (size > 1.7) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 5);
      halo.addColorStop(0, withAlpha(colour, 0.5));
      halo.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - size * 5, y - size * 5, size * 10, size * 10);
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* The scene                                                           */
/* ------------------------------------------------------------------ */

export const SCENES: readonly Scene[] = [
  {
    id: 'astra',
    name: 'Astra',
    blurb: 'The house sky: a bright star over a violet field.',
    ground: ['#0A0E33', '#3B2A8C'],
    light: '#7C5CFF',
    rim: '#FFFFFF',
    draw(ctx, width, height) {
      ground(ctx, width, height, this.ground);

      // The nebula: several wide, weak blooms rather than one strong one. A
      // single colour reads as a spotlight; four read as depth.
      radialBloom(ctx, width * 0.74, height * 0.42, width * 0.56, withAlpha(this.light, 0.62));
      radialBloom(ctx, width * 0.92, height * 0.78, width * 0.4, withAlpha('#2FC9FF', 0.44));
      radialBloom(ctx, width * 0.56, height * 0.14, width * 0.34, withAlpha('#FF74C8', 0.3));
      radialBloom(ctx, width * 0.3, height * 0.92, width * 0.36, withAlpha('#3E5BD8', 0.26));

      band(ctx, width * 0.66, height * 0.58, 1180, 210, -0.46, withAlpha('#B9C9FF', 0.34), 0.75);

      stars(ctx, width, height, 190, 20260922, [
        '#FFFFFF',
        '#DCE6FF',
        '#BFD6FF',
        '#FFE6C2',
        '#FFC9E8',
      ]);

      // The one big spark, and three lesser ones for company. It sits clear of
      // the wordmark's row and clear of the text column, in the gap the layout
      // leaves between the accent block and the right edge.
      spark(ctx, width * 0.75, height * 0.4, 168, this.rim, '#A78CFF', 0.95);
      spark(ctx, width * 0.55, height * 0.76, 56, this.rim, '#7FE3FF', 0.7, 0.3);
      spark(ctx, width * 0.93, height * 0.24, 44, this.rim, '#FFB3E4', 0.6, -0.2);
      spark(ctx, width * 0.86, height * 0.93, 30, this.rim, '#B9C9FF', 0.5, 0.5);
    },
  },
];

/** What `artwork.sceneId` holds when the card has no built-in background. */
export const NO_SCENE = 'none';

/** The background a new card starts on. */
export const DEFAULT_SCENE_ID = 'astra';

export function sceneById(id: string | null | undefined): Scene | null {
  if (!id || id === NO_SCENE) return null;
  return SCENES.find((scene) => scene.id === id) ?? null;
}

/** Paints a scene across the whole card. */
export function drawScene(ctx: Ctx2D, width: number, height: number, scene: Scene): void {
  ctx.save();
  scene.draw(ctx, width, height);
  ctx.restore();
}

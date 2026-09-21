import { hexToRgb, rgbToHex } from '../color';
import { radialBloom, withAlpha, type Ctx2D } from './primitives';

/**
 * The built-in backgrounds.
 *
 * These are Astra's own artwork, drawn by the renderer rather than shipped as
 * files. Three reasons it is done this way, and all three are the reason not to
 * change it to a folder of PNGs later:
 *
 * - **Nothing is redistributed.** The reference cards' backgrounds are someone
 *   else's commissioned art. What was taken from them is the *genre* — faceted
 *   solids under one hard light on a near-black ground — and the lighting, which
 *   was measured the way the layout was. The objects here are built from scratch.
 * - **It exports at any size.** A polygon at 3× is a polygon; a 840px JPEG at 3×
 *   is a blurry 840px JPEG. The same draw call serves the preview, the PNG and
 *   every frame of a video export.
 * - **It costs no bytes.** The whole set is smaller than one of the images it
 *   replaces.
 *
 * Two rules for anything added here:
 *
 * 1. **No `shadowBlur`.** Canvas shadows are not scaled by the current
 *    transform, so a glow that looks right in the preview would be a third of
 *    the size in a 3× export — and the one invariant this renderer has is that
 *    the export matches the preview exactly. Glow is gradients, always.
 * 2. **Keep the left third quiet.** The title, the block and the rows live
 *    between x=30 and x=420. Every scene puts its subject to the right of that
 *    and lets the ground carry the text column, which is why these backgrounds
 *    need no scrim to stay readable.
 */

export interface Scene {
  id: string;
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  /** The ground this scene sits on: a two-stop ramp, top-left to bottom-right. */
  ground: readonly [string, string];
  /** The key light — the colour of a lit face and of the bloom behind it. */
  light: string;
  /** The rim colour: edges that catch the light head-on. */
  rim: string;
  draw: (ctx: Ctx2D, width: number, height: number) => void;
}

/* ------------------------------------------------------------------ */
/* A very small faceted-solid renderer                                 */
/* ------------------------------------------------------------------ */

type Vec3 = readonly [number, number, number];

/**
 * One point of view for every scene, so the five read as one set rather than
 * five unrelated pictures: a little to the left of the object, a little above
 * it, and weak perspective. `CAMERA` is the distance the divide uses — larger
 * is flatter.
 */
const YAW = 0.62;
const PITCH = 0.42;
const CAMERA = 7.2;

/** The key light, in the same space the vertices are rotated into. */
const LIGHT_DIR = normalise([-0.45, -0.75, 0.48]);

function normalise([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function rotate([x, y, z]: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

interface Projected {
  x: number;
  y: number;
  /** Depth after rotation. Bigger is nearer the camera. */
  z: number;
}

/** A solid: vertices in object space, and faces as indices into them. */
interface Solid {
  points: readonly Vec3[];
  faces: readonly (readonly number[])[];
}

export interface SolidPlacement {
  /** Where the centre lands on the card, in design units. */
  cx: number;
  cy: number;
  /** Object-space units to design units. */
  scale: number;
  /** Per-axis stretch applied before the camera — this is what makes a blade. */
  stretch?: Vec3;
  /** Extra spin about the vertical axis, on top of the shared point of view. */
  spin?: number;
  /** Extra tilt, likewise. */
  tilt?: number;
}

/** Eight corners, six faces, wound so each face's normal points outward. */
function cube(): Solid {
  return {
    points: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    faces: [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [0, 4, 7, 3],
    ],
  };
}

/** Six points, eight triangles. Stretched on one axis it is the blade. */
function octahedron(): Solid {
  return {
    points: [
      [0, -1, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, -1],
      [0, 0, 1],
    ],
    faces: [
      [0, 4, 2],
      [0, 3, 4],
      [0, 5, 3],
      [0, 2, 5],
      [1, 2, 4],
      [1, 4, 3],
      [1, 3, 5],
      [1, 5, 2],
    ],
  };
}

/** Mixes two hex colours. `t` 0 gives `a`, 1 gives `b`. */
function mix(a: string, b: string, t: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  if (!from || !to) return a;
  const k = Math.min(1, Math.max(0, t));
  return rgbToHex({
    r: Math.round(from.r + (to.r - from.r) * k),
    g: Math.round(from.g + (to.g - from.g) * k),
    b: Math.round(from.b + (to.b - from.b) * k),
  });
}

interface SolidPaint {
  /** A face turned away from the light. */
  dark: string;
  /** A face facing it square on. */
  lit: string;
  /** Edges. Left out, the solid keeps its faces' own boundaries only. */
  rim?: string;
  /** 0..1 — how strongly the rim is drawn. */
  rimStrength?: number;
}

/**
 * Paints one solid, painter's-algorithm: back faces first, front faces over
 * them. With convex solids that is exact, and every solid here is convex.
 *
 * Each face is flat-shaded from its own normal, then given a shallow gradient
 * across it so a large face does not read as a sticker. The gradient runs along
 * the face's own screen-space diagonal, which is what keeps a cube's three
 * visible faces looking like one object lit once.
 */
function drawSolid(
  ctx: Ctx2D,
  solid: Solid,
  place: SolidPlacement,
  paint: SolidPaint,
  alpha = 1,
): void {
  const stretch = place.stretch ?? [1, 1, 1];
  const yaw = YAW + (place.spin ?? 0);
  const pitch = PITCH + (place.tilt ?? 0);

  const rotated = solid.points.map((point) =>
    rotate([point[0] * stretch[0], point[1] * stretch[1], point[2] * stretch[2]], yaw, pitch),
  );
  const screen: Projected[] = rotated.map(([x, y, z]) => {
    const depth = CAMERA / (CAMERA - z);
    return { x: place.cx + x * place.scale * depth, y: place.cy + y * place.scale * depth, z };
  });

  const faces = solid.faces
    .map((indices) => {
      const points = indices.map((i) => rotated[i] as Vec3);
      const [a, b, c] = points as [Vec3, Vec3, Vec3];
      // Newell would be safer for n-gons; every face here is planar, so the
      // cross product of two edges is the normal and costs a third as much.
      const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal = normalise([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ]);
      const depth = points.reduce((sum, p) => sum + p[2], 0) / points.length;
      return { indices, normal, depth };
    })
    .sort((a, b) => a.depth - b.depth);

  ctx.save();
  ctx.globalAlpha = alpha;
  for (const face of faces) {
    const facing = face.normal[0] * LIGHT_DIR[0] + face.normal[1] * LIGHT_DIR[1] + face.normal[2] * LIGHT_DIR[2];
    // Half-Lambert: a face turned away still reads as part of the solid rather
    // than as a hole cut in it, which is how the reference art is lit too.
    const level = Math.pow(Math.max(0, facing * 0.5 + 0.5), 2.6);
    const points = face.indices.map((i) => screen[i] as Projected);
    const first = points[0] as Projected;

    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const ramp = ctx.createLinearGradient(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    );
    // The cap matters: a face that reaches the light colour outright looks
    // like a flat swatch, and the solid stops reading as one object lit once.
    ramp.addColorStop(0, mix(paint.dark, paint.lit, Math.min(0.9, level * 1.05 + 0.05)));
    ramp.addColorStop(1, mix(paint.dark, paint.lit, level * 0.52));
    ctx.fillStyle = ramp;
    ctx.fill();

    if (paint.rim) {
      // Only the edges of faces that actually catch the light are drawn, so the
      // solid gets a lit contour rather than a wireframe.
      const strength = Math.max(0, level - 0.28) * (paint.rimStrength ?? 1);
      if (strength > 0.01) {
        ctx.strokeStyle = withAlpha(paint.rim, Math.min(0.9, strength));
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Pieces the scenes are composed from                                 */
/* ------------------------------------------------------------------ */

/**
 * The ground every scene starts with: the dark, flat, everywhere — then the
 * scene's colour brought in as a wide pool on the right.
 *
 * It was a corner-to-corner linear ramp first, and that was wrong: a linear
 * ramp puts a third of its colour under the text column, which on the gold
 * scene turned the whole card olive and left the title sitting in it. A pool
 * centred in the artwork field keeps the left near-black on all five.
 */
function ground(ctx: Ctx2D, width: number, height: number, ramp: readonly [string, string]): void {
  ctx.save();
  ctx.fillStyle = ramp[0];
  ctx.fillRect(0, 0, width, height);
  const pool = ctx.createRadialGradient(
    width * 0.76,
    height * 0.52,
    0,
    width * 0.76,
    height * 0.52,
    width * 0.66,
  );
  pool.addColorStop(0, ramp[1]);
  pool.addColorStop(0.55, withAlpha(ramp[1], 0.45));
  pool.addColorStop(1, withAlpha(ramp[1], 0));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/**
 * A splinter: a flat triangle with a lit leading edge, the small stuff that
 * makes the field around a solid feel like it is breaking apart rather than
 * floating in an empty room.
 */
function shard(
  ctx: Ctx2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  fill: string,
  rim: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.42, size * 0.34);
  ctx.lineTo(-size * 0.28, size * 0.88);
  ctx.closePath();
  const ramp = ctx.createLinearGradient(-size * 0.3, -size, size * 0.4, size);
  ramp.addColorStop(0, rim);
  ramp.addColorStop(0.45, fill);
  ramp.addColorStop(1, withAlpha(fill, 0.25));
  ctx.fillStyle = ramp;
  ctx.fill();
  ctx.strokeStyle = withAlpha(rim, 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/**
 * A stroke of light: a long soft band, drawn as a gradient rather than a
 * blurred line for the reason at the top of this file.
 */
function streak(
  ctx: Ctx2D,
  x: number,
  y: number,
  length: number,
  thickness: number,
  angle: number,
  color: string,
  alpha = 0.5,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  const across = ctx.createLinearGradient(0, -thickness / 2, 0, thickness / 2);
  across.addColorStop(0, withAlpha(color, 0));
  across.addColorStop(0.5, color);
  across.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = across;
  ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
  // Fade both ends, so the band does not stop dead in mid-air.
  const along = ctx.createLinearGradient(-length / 2, 0, length / 2, 0);
  along.addColorStop(0, 'rgba(0, 0, 0, 1)');
  along.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
  along.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = along;
  ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
  ctx.restore();
}

/** Specks of light, seeded so a scene is the same picture every time it paints. */
function motes(
  ctx: Ctx2D,
  count: number,
  bounds: { x: number; y: number; w: number; h: number },
  color: string,
  seed: number,
): void {
  let state = seed;
  const random = () => {
    // A tiny LCG. The scenes must be deterministic: the preview, the PNG and
    // every frame of a video export have to be the same picture.
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const x = bounds.x + random() * bounds.w;
    const y = bounds.y + random() * bounds.h;
    const r = 0.7 + random() * 1.9;
    ctx.globalAlpha = 0.12 + random() * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* The scenes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Palettes are the reference cards' own lighting, measured off the artwork
 * field (x>430, below the wordmark row) rather than picked by eye: the ground
 * is the field's dark, `light` is its lit edges, `rim` its peak.
 */
export const SCENES: readonly Scene[] = [
  {
    id: 'blade',
    name: 'Blade',
    blurb: 'A shard of light through the dark.',
    ground: ['#05060B', '#0C1024'],
    light: '#42509D',
    rim: '#CAD3FF',
    draw(ctx, width, height) {
      ground(ctx, width, height, this.ground);
      radialBloom(ctx, width * 0.75, height * 0.52, width * 0.46, withAlpha(this.light, 0.52));
      streak(ctx, width * 0.74, height * 0.52, 560, 190, -1.16, withAlpha(this.light, 0.5), 0.45);
      shard(ctx, width * 0.58, height * 0.26, 30, -0.5, withAlpha(this.light, 0.8), this.rim, 0.45);
      shard(ctx, width * 0.94, height * 0.34, 24, 2.3, withAlpha(this.light, 0.7), this.rim, 0.4);
      drawSolid(
        ctx,
        octahedron(),
        { cx: width * 0.75, cy: height * 0.52, scale: 96, stretch: [0.32, 2.3, 0.32], tilt: -0.24 },
        { dark: '#111A3C', lit: mix(this.light, this.rim, 0.62), rim: this.rim, rimStrength: 1.2 },
      );
      // The core: the blade is lit from within as well as on its edge, which is
      // what stops a long dark solid reading as a hole cut in the card.
      streak(ctx, width * 0.75, height * 0.52, 330, 7, -Math.PI / 2, this.rim, 0.5);
      shard(ctx, width * 0.86, height * 0.74, 36, 0.9, withAlpha(this.light, 0.85), this.rim, 0.5);
      shard(ctx, width * 0.62, height * 0.87, 26, -1.9, withAlpha(this.light, 0.7), this.rim, 0.4);
      motes(ctx, 26, { x: width * 0.48, y: 0, w: width * 0.52, h: height }, this.rim, 8);
    },
  },
  {
    id: 'shards',
    name: 'Shards',
    blurb: 'Pale splinters, caught mid-break.',
    ground: ['#020405', '#0A0E1A'],
    light: '#8694D9',
    rim: '#EAEDFF',
    draw(ctx, width, height) {
      ground(ctx, width, height, this.ground);
      radialBloom(ctx, width * 0.78, height * 0.44, width * 0.46, withAlpha(this.light, 0.42));
      const pieces: [number, number, number, number, number][] = [
        [0.55, 0.16, 30, 0.7, 0.45],
        [0.68, 0.3, 54, -0.4, 0.75],
        [0.86, 0.22, 34, 1.8, 0.5],
        [0.95, 0.46, 40, -1.1, 0.55],
        [0.6, 0.55, 26, 2.6, 0.4],
        [0.79, 0.62, 62, 0.25, 0.85],
        [0.57, 0.83, 36, -2.2, 0.5],
        [0.9, 0.85, 30, 1.2, 0.45],
        [0.71, 0.95, 24, -0.6, 0.35],
      ];
      for (const [fx, fy, size, angle, alpha] of pieces) {
        shard(ctx, width * fx, height * fy, size, angle, withAlpha(this.light, 0.9), this.rim, alpha);
      }
      drawSolid(
        ctx,
        octahedron(),
        { cx: width * 0.77, cy: height * 0.52, scale: 92, stretch: [1, 1.3, 1], spin: 0.3 },
        { dark: '#161C33', lit: mix(this.light, this.rim, 0.3), rim: this.rim, rimStrength: 1.3 },
      );
      motes(ctx, 34, { x: width * 0.45, y: 0, w: width * 0.55, h: height }, this.rim, 21);
    },
  },
  {
    id: 'prism',
    name: 'Prism',
    blurb: 'A dark solid with two lights on it.',
    ground: ['#08080B', '#14161F'],
    light: '#536380',
    rim: '#F3F6F5',
    draw(ctx, width, height) {
      ground(ctx, width, height, this.ground);
      radialBloom(ctx, width * 0.8, height * 0.36, width * 0.44, withAlpha('#4FD8E8', 0.24));
      radialBloom(ctx, width * 0.66, height * 0.84, width * 0.36, withAlpha('#E79CD8', 0.2));
      // Near-black, and read by its edges: the light on this one is the two
      // rims, not the faces.
      drawSolid(
        ctx,
        cube(),
        { cx: width * 0.79, cy: height * 0.44, scale: 96, spin: -0.2, tilt: 0.1 },
        { dark: '#0B0D13', lit: '#38445A', rim: '#9FE8F2', rimStrength: 1.6 },
      );
      drawSolid(
        ctx,
        octahedron(),
        { cx: width * 0.63, cy: height * 0.8, scale: 66, spin: 0.5, tilt: -0.15 },
        { dark: '#0A0C12', lit: '#4A3B4E', rim: '#F2BEE6', rimStrength: 1.5 },
      );
      shard(ctx, width * 0.55, height * 0.52, 44, 0.4, withAlpha('#4FD8E8', 0.75), '#BFF4FA', 0.6);
      shard(ctx, width * 0.93, height * 0.66, 34, -1.4, withAlpha('#E79CD8', 0.7), '#F6D2EE', 0.5);
      shard(ctx, width * 0.86, height * 0.14, 28, 2.1, withAlpha('#4FD8E8', 0.6), '#BFF4FA', 0.45);
      motes(ctx, 22, { x: width * 0.46, y: 0, w: width * 0.54, h: height }, '#BFF4FA', 5);
    },
  },
  {
    id: 'bullion',
    name: 'Bullion',
    blurb: 'Gold, under one hard light.',
    ground: ['#191707', '#241F08'],
    light: '#B9AC69',
    rim: '#FCFBD8',
    draw(ctx, width, height) {
      ground(ctx, width, height, ['#0A0903', '#3B300A']);
      radialBloom(ctx, width * 0.77, height * 0.5, width * 0.44, withAlpha('#D8C067', 0.46));
      streak(ctx, width * 0.74, height * 0.34, 440, 110, -0.55, withAlpha('#FBE9A8', 0.38), 0.4);
      drawSolid(
        ctx,
        cube(),
        { cx: width * 0.8, cy: height * 0.54, scale: 104, spin: 0.16, tilt: -0.06 },
        { dark: '#221B06', lit: '#E7D07A', rim: this.rim, rimStrength: 1.15 },
      );
      shard(ctx, width * 0.55, height * 0.2, 34, 0.8, withAlpha('#E8CE74', 0.9), this.rim, 0.55);
      shard(ctx, width * 0.96, height * 0.3, 26, -1.7, withAlpha('#E8CE74', 0.8), this.rim, 0.45);
      shard(ctx, width * 0.58, height * 0.88, 40, 2.4, withAlpha('#E8CE74', 0.85), this.rim, 0.5);
      shard(ctx, width * 0.91, height * 0.92, 28, -0.5, withAlpha('#E8CE74', 0.75), this.rim, 0.4);
      motes(ctx, 30, { x: width * 0.45, y: 0, w: width * 0.55, h: height }, '#FBE9A8', 13);
    },
  },
  {
    id: 'tide',
    name: 'Tide',
    blurb: 'Cold water light over a monolith.',
    ground: ['#001D30', '#00435C'],
    light: '#52F0FF',
    rim: '#DCFEFF',
    draw(ctx, width, height) {
      ground(ctx, width, height, this.ground);
      radialBloom(ctx, width * 0.72, height * 0.62, width * 0.5, withAlpha(this.light, 0.38));
      streak(ctx, width * 0.7, height * 0.68, 640, 96, -0.22, withAlpha(this.light, 0.7), 0.55);
      streak(ctx, width * 0.78, height * 0.3, 420, 54, 0.38, withAlpha(this.rim, 0.5), 0.4);
      // One tall block, not two stacked ones: two cubes at different sizes read
      // as two objects floating past each other, never as a monolith.
      drawSolid(
        ctx,
        cube(),
        { cx: width * 0.77, cy: height * 0.56, scale: 92, stretch: [0.92, 1.5, 0.92], spin: 0.1 },
        { dark: '#04202E', lit: '#2A8094', rim: this.light, rimStrength: 1.4 },
      );
      shard(ctx, width * 0.57, height * 0.5, 30, 1.1, withAlpha(this.light, 0.8), this.rim, 0.5);
      shard(ctx, width * 0.94, height * 0.52, 26, -1.5, withAlpha(this.light, 0.7), this.rim, 0.42);
      motes(ctx, 40, { x: width * 0.42, y: 0, w: width * 0.58, h: height }, this.rim, 33);
    },
  },
];

/** What `artwork.sceneId` holds when the card has no built-in background. */
export const NO_SCENE = 'none';

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

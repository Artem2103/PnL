export interface GradientStop {
  offset: number;
  color: string;
}

export const FONT_DISPLAY = "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif";
export const FONT_MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface FontSpec {
  size: number;
  weight?: number;
  family?: string;
  /** Extra spacing between glyphs, in design px. */
  tracking?: number;
}

let nativeSpacing: boolean | null = null;

/**
 * `ctx.letterSpacing` is preferred over drawing glyph by glyph, because the
 * per-character fallback loses kerning pairs — which measurably widens strings
 * like "+$10.1K".
 */
function supportsLetterSpacing(): boolean {
  if (nativeSpacing !== null) return nativeSpacing;
  if (typeof document === 'undefined') return (nativeSpacing = false);
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return (nativeSpacing = false);
  nativeSpacing = 'letterSpacing' in probe;
  return nativeSpacing;
}

export function setFont(ctx: Ctx2D, font: FontSpec): void {
  const weight = font.weight ?? 400;
  const family = font.family ?? FONT_DISPLAY;
  ctx.font = `${weight} ${font.size}px ${family}`;
  if (supportsLetterSpacing()) {
    (ctx as CanvasRenderingContext2D).letterSpacing = `${font.tracking ?? 0}px`;
  }
}

/** True when tracking has to be applied by hand, one glyph at a time. */
function needsManualTracking(font: FontSpec): boolean {
  return !!font.tracking && !supportsLetterSpacing();
}

/* ------------------------------------------------------------------ */
/* Measurement cache                                                   */
/* ------------------------------------------------------------------ */

/**
 * `ctx.measureText` is the most expensive thing the renderer does: it re-parses
 * the font shorthand, shapes the string and — for `inkAlign` — asks for glyph
 * bounds. The card asks for the same handful of strings 30–60 times a second
 * while a clip plays, and every one of those answers is identical.
 *
 * Metrics depend only on the font and the string, never on the canvas or its
 * transform (the card is drawn in design units; the scale lives in the
 * transform), so one process-wide cache serves the preview, the PNG and every
 * video frame alike. It is dropped when a webfont finishes loading, which is
 * the only thing that can change an answer.
 */
interface TextMetricsEntry {
  /** Advance width including tracking. */
  width: number;
  /** Where the first painted pixel falls, relative to the drawing origin. */
  inkLeft: number;
  /** Where the last painted pixel falls, relative to the drawing origin. */
  inkRight: number;
  /** Per-glyph advances. Only filled on the manual-tracking path. */
  advances: number[] | null;
}

/** Bounded, so a long editing session cannot grow the cache without limit. */
const MAX_METRICS_ENTRIES = 3000;
const metricsCache = new Map<string, TextMetricsEntry>();
const fitCache = new Map<string, number>();

/** NUL never appears in a card string, so composite keys cannot collide. */
const SEP = '\u0000';

function fontKey(font: FontSpec): string {
  return [font.weight ?? 400, font.size, font.family ?? FONT_DISPLAY, font.tracking ?? 0].join(SEP);
}

/** Every cached answer was measured against whichever face was resolved at the time. */
export function clearTextMetricsCache(): void {
  metricsCache.clear();
  fitCache.clear();
}

function measureEntry(ctx: Ctx2D, text: string, font: FontSpec): TextMetricsEntry {
  const key = fontKey(font) + SEP + text;
  const hit = metricsCache.get(key);
  if (hit) return hit;

  setFont(ctx, font);
  let entry: TextMetricsEntry;

  if (!needsManualTracking(font)) {
    const metrics = ctx.measureText(text);
    const hasBounds = typeof metrics.actualBoundingBoxLeft === 'number';
    entry = {
      width: metrics.width,
      inkLeft: hasBounds ? -metrics.actualBoundingBoxLeft : 0,
      inkRight: hasBounds ? metrics.actualBoundingBoxRight : metrics.width,
      advances: null,
    };
  } else {
    const tracking = font.tracking ?? 0;
    const advances: number[] = [];
    let cursor = 0;
    let inkLeft: number | null = null;
    let inkRight = 0;
    for (const char of text) {
      const metrics = ctx.measureText(char);
      const hasBounds = typeof metrics.actualBoundingBoxLeft === 'number';
      if (inkLeft === null) inkLeft = hasBounds ? cursor - metrics.actualBoundingBoxLeft : cursor;
      inkRight = hasBounds ? cursor + metrics.actualBoundingBoxRight : cursor + metrics.width;
      advances.push(metrics.width);
      cursor += metrics.width + tracking;
    }
    entry = {
      width: Math.max(0, cursor - tracking),
      inkLeft: inkLeft ?? 0,
      inkRight,
      advances,
    };
  }

  if (metricsCache.size >= MAX_METRICS_ENTRIES) metricsCache.clear();
  metricsCache.set(key, entry);
  return entry;
}

/** Width of `text` including tracking. */
export function measureText(ctx: Ctx2D, text: string, font: FontSpec): number {
  if (!text) return 0;
  return measureEntry(ctx, text, font).width;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface DrawTextOptions extends FontSpec {
  align?: TextAlign;
  baseline?: CanvasTextBaseline;
  color?: string;
  glow?: { color: string; blur: number; offsetY?: number } | null;
  /** Shrink the font until the text fits this width (never below `minSize`). */
  maxWidth?: number;
  minSize?: number;
  /**
   * Align by the painted ink instead of the glyph origin, so the visible edge
   * lands exactly on `x`. The layout was measured off reference images — that
   * is ink, not advance widths — so this is what makes the two line up.
   */
  inkAlign?: boolean;
}

/**
 * Ink extents relative to the drawing origin: `left` is where the first
 * painted pixel falls, `right` where the last one does. Falls back to advance
 * widths where the engine does not report glyph bounds.
 */
export function inkOffsets(ctx: Ctx2D, text: string, font: FontSpec): { left: number; right: number } {
  const entry = measureEntry(ctx, text, font);
  return { left: entry.inkLeft, right: entry.inkRight };
}

/**
 * Largest font size <= `font.size` at which `text` fits `maxWidth`.
 * Tracking is scaled with the size so the look is preserved.
 */
export function fitFontSize(
  ctx: Ctx2D,
  text: string,
  font: FontSpec,
  maxWidth: number,
  minSize?: number,
): number {
  if (!text || maxWidth <= 0) return font.size;

  const key = [fontKey(font), maxWidth, minSize ?? -1, text].join(SEP);
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;

  const width = measureText(ctx, text, font);
  let result = font.size;

  if (width > maxWidth) {
    const floor = minSize ?? font.size * 0.4;
    // Font metrics are near-linear in size, so one proportional step plus a
    // short refinement loop converges without a binary search.
    let size = Math.max(floor, (font.size * maxWidth) / width);
    for (let i = 0; i < 8; i += 1) {
      const scaled: FontSpec = {
        ...font,
        size,
        tracking: (font.tracking ?? 0) * (size / font.size),
      };
      if (measureText(ctx, text, scaled) <= maxWidth || size <= floor) break;
      size = Math.max(floor, size * 0.97);
    }
    result = size;
  }

  if (fitCache.size >= MAX_METRICS_ENTRIES) fitCache.clear();
  fitCache.set(key, result);
  return result;
}

/**
 * Single-line text with optional tracking, auto-shrink and glow.
 * Returns the width actually painted.
 */
export function drawText(ctx: Ctx2D, text: string, x: number, y: number, opts: DrawTextOptions): number {
  if (!text) return 0;

  const requested: FontSpec = {
    size: opts.size,
    weight: opts.weight,
    family: opts.family,
    tracking: opts.tracking,
  };
  let font = requested;
  if (opts.maxWidth) {
    const size = fitFontSize(ctx, text, requested, opts.maxWidth, opts.minSize);
    if (size !== requested.size) {
      font = { ...requested, size, tracking: (opts.tracking ?? 0) * (size / opts.size) };
    }
  }
  // One lookup covers the advance width, the ink bounds and the per-glyph
  // advances, so a line of text costs at most one measurement pass ever.
  const entry = measureEntry(ctx, text, font);
  const width = entry.width;

  const align = opts.align ?? 'left';
  let startX = x;
  let paintedWidth = width;
  if (opts.inkAlign) {
    paintedWidth = entry.inkRight - entry.inkLeft;
    if (align === 'center') startX = x - (entry.inkLeft + entry.inkRight) / 2;
    else if (align === 'right') startX = x - entry.inkRight;
    else startX = x - entry.inkLeft;
  } else if (align === 'center') {
    startX = x - width / 2;
  } else if (align === 'right') {
    startX = x - width;
  }

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = opts.baseline ?? 'alphabetic';
  ctx.fillStyle = opts.color ?? '#ffffff';
  setFont(ctx, font);

  if (opts.glow) {
    ctx.shadowColor = opts.glow.color;
    ctx.shadowBlur = opts.glow.blur;
    ctx.shadowOffsetY = opts.glow.offsetY ?? 0;
  }

  const advances = entry.advances;
  if (!advances) {
    ctx.fillText(text, startX, y);
  } else {
    // Manual tracking: the advances came from the cache with the string, so
    // this path no longer re-measures a glyph per frame either.
    const tracking = font.tracking ?? 0;
    let cursor = startX;
    let index = 0;
    for (const char of text) {
      ctx.fillText(char, cursor, y);
      cursor += (advances[index] ?? ctx.measureText(char).width) + tracking;
      index += 1;
    }
  }
  ctx.restore();
  // With ink alignment the caller is laying out visible edges, so report the
  // ink width rather than the advance width.
  return paintedWidth;
}

/* ------------------------------------------------------------------ */
/* Shapes and fills                                                    */
/* ------------------------------------------------------------------ */

export function roundRectPath(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) {
    // Square corners: a plain rect beats four degenerate arcs, and keeps the
    // edges exactly on the pixel grid the fill would land on anyway.
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export function fillRoundRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string | CanvasGradient,
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

export function strokeRoundRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  stroke: string,
  lineWidth: number,
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

export function linearGradient(
  ctx: Ctx2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: GradientStop[],
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}

/**
 * A gradient belongs to the context that made it, and building one costs more
 * than the fill that uses it. A video background re-fills the same ramp thirty
 * times a second, so ramps are kept per context and rebuilt only when their
 * definition actually changes.
 */
const gradientCache = new WeakMap<Ctx2D, Map<string, CanvasGradient>>();

export function cachedGradient(
  ctx: Ctx2D,
  key: string,
  build: (target: Ctx2D) => CanvasGradient,
): CanvasGradient {
  let perContext = gradientCache.get(ctx);
  if (!perContext) {
    perContext = new Map();
    gradientCache.set(ctx, perContext);
  }
  const hit = perContext.get(key);
  if (hit) return hit;
  const gradient = build(ctx);
  // A handful of ramps at most; a runaway key stays bounded here.
  if (perContext.size >= 32) perContext.clear();
  perContext.set(key, gradient);
  return gradient;
}

/** Soft radial light source. `color` should already carry its alpha. */
export function radialBloom(
  ctx: Ctx2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  const gradient = cachedGradient(ctx, `bloom:${x}:${y}:${radius}:${color}`, (target) => {
    const built = target.createRadialGradient(x, y, 0, x, y, radius);
    built.addColorStop(0, color);
    built.addColorStop(0.55, withAlpha(color, 0.35));
    built.addColorStop(1, withAlpha(color, 0));
    return built;
  });
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/** Multiplies the alpha of an `rgba(...)` / `rgb(...)` / `#rrggbb` colour. */
export function withAlpha(color: string, factor: number): string {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba?.[1]) {
    const parts = rgba[1].split(',').map((p) => p.trim());
    const [r = '0', g = '0', b = '0', a = '1'] = parts;
    return `rgba(${r}, ${g}, ${b}, ${Number(a) * factor})`;
  }
  const hex = color.trim().replace('#', '');
  if (hex.length === 6 || hex.length === 3) {
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${factor})`;
  }
  return color;
}

/** Deterministic PRNG so the grain tile is byte-identical on every render. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAIN_TILE_SIZE = 160;
let grainTile: HTMLCanvasElement | null = null;

function getGrainTile(): HTMLCanvasElement | null {
  if (grainTile) return grainTile;
  if (typeof document === 'undefined') return null;
  const tile = document.createElement('canvas');
  tile.width = GRAIN_TILE_SIZE;
  tile.height = GRAIN_TILE_SIZE;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;
  const image = tctx.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  const random = mulberry32(0x5eed1234);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 128 + (random() - 0.5) * 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  tctx.putImageData(image, 0, 0);
  grainTile = tile;
  return tile;
}

/** Film grain, drawn from a cached deterministic tile. */
export function drawGrain(ctx: Ctx2D, w: number, h: number, opacity: number): void {
  const tile = getGrainTile();
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Cover-fit source rectangle for drawing an image into a box. */
export function coverRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  zoom = 1,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight) * zoom;
  const w = sourceWidth * scale;
  const h = sourceHeight * scale;
  return { x: (boxWidth - w) / 2, y: (boxHeight - h) / 2, w, h };
}

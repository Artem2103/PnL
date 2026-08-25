/**
 * Colour arithmetic for the accent picker and the automatic ink choice.
 *
 * Kept apart from `themes.ts` so it can be unit-tested without pulling the
 * theme list in, and so the renderer, the picker and the tests all agree on
 * exactly one definition of "is this colour light or dark".
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Accepts `#abc`, `#aabbcc` and the same without the hash; returns the
 * canonical six-digit uppercase form, or null for anything else.
 *
 * Null rather than a fallback colour on purpose: the caller knows what the
 * right default is, and a silent substitution inside a half-typed hex field
 * would fight the person typing it.
 */
export function normaliseHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const body = match[1]!;
  const full =
    body.length === 3
      ? body
          .split('')
          .map((c) => c + c)
          .join('')
      : body;
  return `#${full.toUpperCase()}`;
}

export function hexToRgb(value: string): Rgb | null {
  const hex = normaliseHex(value);
  if (!hex) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

const clampChannel = (n: number): number => Math.min(255, Math.max(0, Math.round(n || 0)));

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clampChannel(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** `#2FE3AC` + 0.1 -> `rgba(47, 227, 172, 0.1)`. Used for the ambient glow. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255, 255, 255, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Which of two inks to print on `background`.
 *
 * The hero block used to be painted with a fixed near-black, which was right
 * for every accent that existed then — mint, cyan, violet, gold and bone are
 * all light. Cherry red is not, and a custom colour can be anything at all, so
 * the choice has to be made from the colour rather than assumed.
 */
export function readableOn(background: string, dark: string, light: string): string {
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/** Straight-line mix in sRGB. `t` of 0 is `a`, 1 is `b`. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/**
 * `color`, lightened or darkened just enough to be legible on `background`.
 *
 * The accent is a fill on the hero block, where any colour works because the
 * ink on top of it adapts — but it is *also* ink itself, on the percentage
 * row, and there it has to survive the ground behind it. A dark navy on the
 * dark card and mint on the light one both come out at around 1.5:1, which is
 * a row you cannot read.
 *
 * It walks away from the background rather than jumping to black or white, so
 * a colour that only just fails is nudged and still looks like the colour that
 * was picked. Returns `color` untouched whenever it already passes, which is
 * every preset accent on the dark card — the case that must not change.
 */
export function ensureContrast(color: string, background: string, minRatio = 3): string {
  const rgb = hexToRgb(color);
  if (!rgb || contrastRatio(color, background) >= minRatio) return color;

  // Away from the background: a light ground pushes the accent down, a dark
  // one pushes it up. Picking by the *background* rather than by the colour
  // stops a mid-grey accent from being dragged toward the very thing it has to
  // stand out against.
  const target = relativeLuminance(background) > 0.5 ? BLACK : WHITE;
  let best = color;
  for (let step = 1; step <= 20; step++) {
    best = rgbToHex(mix(rgb, target, step / 20));
    if (contrastRatio(best, background) >= minRatio) return best;
  }
  return best;
}

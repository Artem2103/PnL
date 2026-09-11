import { hexToRgb, normaliseHex, rgbToHex, type Rgb } from './color';
import { AVATAR_FRAME } from './canvas/spec';
import type { GradientStop } from './canvas/primitives';

/**
 * The frames the avatar can sit in.
 *
 * `colourable` is what the editor reads to decide whether to show a colour
 * picker. Only the pin badge has one: its ramp is derived from a base colour
 * (see `badgePalette`), so the picker changes the whole badge at once rather
 * than one stop of it. Every other frame is painted from fixed colours, or
 * from the card's own accent and ink, and has no colour of its own to set.
 */
export interface AvatarFrame {
  id: string;
  name: string;
  /** One line under the name in the picker. */
  blurb: string;
  colourable: boolean;
}

export const FRAMES: readonly AvatarFrame[] = [
  { id: 'none', name: 'None', blurb: 'The picture fills the slot.', colourable: false },
  {
    id: 'pin',
    name: 'Pin',
    blurb: 'A pip over a gradient ring, in any colour.',
    colourable: true,
  },
  { id: 'tag', name: 'Tag', blurb: 'The loop-topped frame from the reference cards.', colourable: false },
  { id: 'gilt', name: 'Gilt', blurb: 'A bevelled gold frame.', colourable: false },
  { id: 'halo', name: 'Halo', blurb: 'A glowing ring in the card’s accent.', colourable: false },
  { id: 'stamp', name: 'Stamp', blurb: 'A perforated stamp in the text colour.', colourable: false },
  { id: 'corners', name: 'Corners', blurb: 'Four brackets in the text colour.', colourable: false },
];

export const DEFAULT_FRAME_ID = 'pin';

/**
 * The reference badge's own red, as measured: the flat half of the pip's base
 * and the vivid stop the ring's ramp turns around. With this as the base
 * colour `badgePalette` gives the measured badge back.
 */
export const DEFAULT_FRAME_COLOR = '#D20008';

export function frameById(id: string): AvatarFrame {
  return FRAMES.find((frame) => frame.id === id) ?? FRAMES.find((f) => f.id === DEFAULT_FRAME_ID)!;
}

/* ------------------------------------------------------------------ */
/* The pin badge's palette, from one colour                            */
/* ------------------------------------------------------------------ */

/**
 * One measured colour, described relative to the base as `base × keep + white
 * × lift`. Two numbers rather than one, because the reference's light tones
 * are not a plain mix toward white — the pip's tip has less red in it than a
 * white mix of the base would, so a one-parameter mix misses it by 26 levels.
 * `keep` below 1 with `lift` at 0 is a shade; `keep` and `lift` together are
 * a tint that can also lose saturation on the way. Re-applying the pair to
 * another base gives that colour the same relationship to its ramp.
 */
interface Shade {
  keep: number;
  lift: number;
}

const channels = (c: Rgb): number[] => [c.r, c.g, c.b];

/**
 * Solved by scanning `keep` and taking the least-squares `lift` for each: the
 * problem is two unknowns against three channels and a 241-step scan of one
 * of them is exact to under half a level, which is closer than the reference
 * was measured.
 */
function shadeOf(base: Rgb, target: Rgb): Shade {
  const b = channels(base);
  const t = channels(target);
  let best: Shade = { keep: 1, lift: 0 };
  let bestError = Infinity;
  for (let step = 0; step <= 240; step++) {
    const keep = step / 200;
    const lift = Math.min(1, Math.max(0, t.reduce((sum, v, i) => sum + (v - b[i]! * keep), 0) / (3 * 255)));
    const error = t.reduce((sum, v, i) => sum + (b[i]! * keep + 255 * lift - v) ** 2, 0);
    if (error < bestError) {
      bestError = error;
      best = { keep, lift };
    }
  }
  return best;
}

function shade(base: Rgb, s: Shade): string {
  return rgbToHex({
    r: base.r * s.keep + 255 * s.lift,
    g: base.g * s.keep + 255 * s.lift,
    b: base.b * s.keep + 255 * s.lift,
  });
}

const REFERENCE_BASE = hexToRgb(DEFAULT_FRAME_COLOR)!;

/** The measured badge, reduced to shades of its base. Computed once. */
const RING_SHADES = AVATAR_FRAME.ringStops.map((stop) => ({
  offset: stop.offset,
  shade: shadeOf(REFERENCE_BASE, hexToRgb(stop.color)!),
}));
const PIP_FILL_SHADES = AVATAR_FRAME.pipFillStops.map((stop) => ({
  offset: stop.offset,
  shade: shadeOf(REFERENCE_BASE, hexToRgb(stop.color)!),
}));
const PIP_LIGHT_SHADE = shadeOf(REFERENCE_BASE, hexToRgb(AVATAR_FRAME.pipLight)!);

export interface BadgePalette {
  ringStops: readonly GradientStop[];
  pipFillStops: readonly GradientStop[];
  pipLight: string;
}

/**
 * The pin badge's colours for a base colour: the ring's ramp around the
 * border, the pip base's highlight and the tip's light tone, each the same
 * distance from `base` that the reference's is from its red.
 *
 * With the reference red in, the reference badge comes out — within a few
 * levels per channel, which is the cost of describing each stop by two numbers.
 * Anything unparseable falls back to that red rather than to black.
 */
export function badgePalette(base: string): BadgePalette {
  const rgb = hexToRgb(normaliseHex(base) ?? DEFAULT_FRAME_COLOR) ?? REFERENCE_BASE;
  return {
    ringStops: RING_SHADES.map((s) => ({ offset: s.offset, color: shade(rgb, s.shade) })),
    pipFillStops: PIP_FILL_SHADES.map((s) => ({ offset: s.offset, color: shade(rgb, s.shade) })),
    pipLight: shade(rgb, PIP_LIGHT_SHADE),
  };
}

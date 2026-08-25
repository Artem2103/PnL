import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  ensureContrast,
  hexToRgb,
  normaliseHex,
  readableOn,
  relativeLuminance,
  rgbToHex,
  withAlpha,
} from './color';
import { GROUND, PALETTE } from './canvas/spec';
import { THEMES } from './themes';

describe('normaliseHex', () => {
  it('accepts the forms a person actually types', () => {
    expect(normaliseHex('#2fe3ac')).toBe('#2FE3AC');
    expect(normaliseHex('2fe3ac')).toBe('#2FE3AC');
    expect(normaliseHex('  #2FE3AC  ')).toBe('#2FE3AC');
    expect(normaliseHex('#abc')).toBe('#AABBCC');
  });

  it('rejects anything else rather than guessing', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', 'rebeccapurple', '#gggggg']) {
      expect(normaliseHex(bad)).toBeNull();
    }
  });
});

describe('hexToRgb / rgbToHex', () => {
  it('round-trips', () => {
    expect(rgbToHex(hexToRgb('#D2042D')!)).toBe('#D2042D');
    expect(hexToRgb('#FF7A45')).toEqual({ r: 255, g: 122, b: 69 });
  });

  it('clamps and rounds channels coming back from a slider', () => {
    expect(rgbToHex({ r: -12, g: 255.4, b: 300 })).toBe('#00FFFF');
  });
});

describe('withAlpha', () => {
  it('builds the glow string the renderer wants', () => {
    expect(withAlpha('#2FE3AC', 0.1)).toBe('rgba(47, 227, 172, 0.1)');
  });
});

describe('relativeLuminance', () => {
  it('pins the ends of the scale', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
  });

  it('puts cherry red below every other preset accent', () => {
    const cherry = relativeLuminance('#D2042D');
    for (const theme of THEMES.filter((t) => t.id !== 'cherry')) {
      expect(relativeLuminance(theme.accent)).toBeGreaterThan(cherry);
    }
  });
});

describe('contrastRatio', () => {
  it('is symmetric and spans 1..21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 4);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 4);
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 6);
  });
});

/**
 * The reason this function exists: the hero value used to be painted in a
 * fixed near-black, which is right for the five light accents and wrong for
 * cherry and for half the colours the custom picker can reach.
 */
describe('readableOn', () => {
  const ink = (accent: string) => readableOn(accent, PALETTE.onAccent, PALETTE.onAccentLight);

  it('keeps near-black on every light preset accent', () => {
    for (const theme of THEMES.filter((t) => t.id !== 'cherry')) {
      expect(ink(theme.accent)).toBe(PALETTE.onAccent);
    }
  });

  it('flips to the light ink on cherry, which near-black would swallow', () => {
    expect(ink('#D2042D')).toBe(PALETTE.onAccentLight);
    expect(contrastRatio('#D2042D', PALETTE.onAccentLight)).toBeGreaterThan(
      contrastRatio('#D2042D', PALETTE.onAccent),
    );
  });

  it('never leaves the hero value below 3:1 anywhere in the colour cube', () => {
    // Every 17th step of each channel: 4096 colours, enough to catch a whole
    // region being wrong rather than one unlucky hue.
    let worst = Infinity;
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const accent = rgbToHex({ r, g, b });
          worst = Math.min(worst, contrastRatio(accent, ink(accent)));
        }
      }
    }
    expect(worst).toBeGreaterThan(3);
  });
});

/**
 * The percentage row is the accent used as ink, so unlike the block fill it
 * has to survive the ground behind it.
 */
describe('ensureContrast', () => {
  const dark = GROUND.dark[1];
  const light = GROUND.light[1];

  it('leaves every preset accent alone on the dark card', () => {
    for (const theme of THEMES) {
      expect(ensureContrast(theme.accent, dark)).toBe(theme.accent);
    }
  });

  it('lifts a dark custom accent off the dark ground', () => {
    const navy = '#1B1F3B';
    expect(contrastRatio(navy, dark)).toBeLessThan(3);
    const lifted = ensureContrast(navy, dark);
    expect(lifted).not.toBe(navy);
    expect(contrastRatio(lifted, dark)).toBeGreaterThanOrEqual(3);
  });

  it('darkens mint on the light card, where it would otherwise vanish', () => {
    expect(contrastRatio('#2FE3AC', light)).toBeLessThan(3);
    expect(contrastRatio(ensureContrast('#2FE3AC', light), light)).toBeGreaterThanOrEqual(3);
  });

  it('clears the bar for any colour on either ground', () => {
    for (const ground of [dark, light]) {
      for (let r = 0; r < 256; r += 51) {
        for (let g = 0; g < 256; g += 51) {
          for (let b = 0; b < 256; b += 51) {
            const fixed = ensureContrast(rgbToHex({ r, g, b }), ground);
            expect(contrastRatio(fixed, ground)).toBeGreaterThanOrEqual(2.99);
          }
        }
      }
    }
  });

  it('nudges rather than jumping: a near miss stays recognisably itself', () => {
    // Chosen to sit just under 3:1 on the dark ground.
    const near = '#3A3A66';
    const fixed = hexToRgb(ensureContrast(near, dark))!;
    const before = hexToRgb(near)!;
    // Still bluer than it is red or green — the hue survived the correction.
    expect(fixed.b).toBeGreaterThan(fixed.r);
    expect(fixed.b - before.b).toBeGreaterThan(0);
  });
});

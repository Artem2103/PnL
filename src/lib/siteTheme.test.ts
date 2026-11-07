import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb, rgbToHex } from './color';
import { DEFAULT_SITE_THEME, GLASS_OPACITY, GLOW_OPACITY, SITE_THEMES, tokensFor } from './siteTheme';

/** `top` at `opacity` over `under`, as the screen shows it. */
function over(top: string, opacity: number, under: string): string {
  const a = hexToRgb(top)!;
  const b = hexToRgb(under)!;
  const mix = (x: number, y: number) => Math.round(x * opacity + y * (1 - opacity));
  return rgbToHex({ r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) });
}

describe.each(SITE_THEMES.map((theme) => [theme.label, theme] as const))('the %s theme', (_, theme) => {
  it('keeps body text readable on the page and on a card', () => {
    for (const ground of [theme.bg, theme.card, theme.soft]) {
      expect(contrastRatio(theme.text, ground)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.muted, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the quiet text legible', () => {
    expect(contrastRatio(theme.faint, theme.card)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a button label readable', () => {
    expect(contrastRatio(theme.accentInk, theme.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('makes the buttons stand out from a card', () => {
    expect(contrastRatio(theme.accent, theme.card)).toBeGreaterThanOrEqual(3);
  });

  it('stays readable on the glass, at the strongest part of the wash', () => {
    const strength = theme.dark ? GLOW_OPACITY.dark : GLOW_OPACITY.light;
    for (const glow of [theme.glowA, theme.glowB]) {
      const page = over(glow, strength, theme.bg);
      const glass = over(theme.card, GLASS_OPACITY, page);
      expect(contrastRatio(theme.text, page)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.muted, page)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.muted, glass)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.faint, glass)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps profit and loss readable', () => {
    const tokens = tokensFor(theme);
    expect(contrastRatio(tokens['--profit']!, theme.card)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(tokens['--loss']!, theme.card)).toBeGreaterThanOrEqual(3);
  });
});

describe('the theme list', () => {
  it('has unique ids and the default in it', () => {
    const ids = SITE_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_SITE_THEME);
  });

  it('sets the same variables in every theme', () => {
    const names = SITE_THEMES.map((theme) => Object.keys(tokensFor(theme)).join());
    expect(new Set(names).size).toBe(1);
  });
});

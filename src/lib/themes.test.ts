import { describe, expect, it } from 'vitest';
import {
  CUSTOM_THEME_ID,
  DEFAULT_CUSTOM_ACCENT,
  THEMES,
  customTheme,
  getTheme,
  resolveTheme,
} from './themes';
import { normaliseHex } from './color';

describe('THEMES', () => {
  it('has unique ids, none of which collides with the custom slot', () => {
    const ids = THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(CUSTOM_THEME_ID);
  });

  it('carries a cherry red option', () => {
    const cherry = THEMES.find((theme) => theme.id === 'cherry');
    expect(cherry?.accent).toBe('#D2042D');
    // Deliberate: a cherry card stays cherry when the number goes negative.
    expect(cherry?.loss).toBe(cherry?.accent);
  });

  it('stores every accent as a canonical hex, so the picker can parse them', () => {
    for (const theme of THEMES) {
      expect(normaliseHex(theme.accent)).toBe(theme.accent);
      expect(normaliseHex(theme.swatch)).toBe(theme.swatch);
      expect(normaliseHex(theme.loss)).toBe(theme.loss);
    }
  });
});

describe('customTheme', () => {
  it('paints profit and loss in the chosen colour', () => {
    const theme = customTheme('#123456');
    expect(theme.accent).toBe('#123456');
    expect(theme.loss).toBe('#123456');
    expect(theme.swatch).toBe('#123456');
    expect(theme.glow).toBe('rgba(18, 52, 86, 0.12)');
  });

  it('accepts the loose forms the hex field can hand it', () => {
    expect(customTheme('abc').accent).toBe('#AABBCC');
  });

  it('falls back rather than producing an unpaintable fill', () => {
    expect(customTheme('nonsense').accent).toBe(DEFAULT_CUSTOM_ACCENT);
  });
});

describe('resolveTheme', () => {
  it('returns the preset for a known id', () => {
    expect(resolveTheme({ themeId: 'gold' }).accent).toBe(getTheme('gold').accent);
  });

  it('builds the custom theme instead of falling back to mint', () => {
    const theme = resolveTheme({ themeId: CUSTOM_THEME_ID, customAccent: '#00FF88' });
    expect(theme.accent).toBe('#00FF88');
    // The bug this guards: `getTheme('custom')` finds nothing and returns
    // THEMES[0], so the card would silently paint mint.
    expect(getTheme(CUSTOM_THEME_ID).accent).not.toBe(theme.accent);
  });

  it('still resolves when the custom colour has not been set', () => {
    expect(resolveTheme({ themeId: CUSTOM_THEME_ID }).accent).toBe(DEFAULT_CUSTOM_ACCENT);
  });
});

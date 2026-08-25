import { normaliseHex, withAlpha } from './color';

export interface Theme {
  id: string;
  name: string;
  /** Fill of the hero block and colour of the percentage row, when in profit. */
  accent: string;
  /** Same, when the result is negative. */
  loss: string;
  /** Ambient glow tinting the background. */
  glow: string;
  /** Swatch shown in the picker. */
  swatch: string;
}

/**
 * The reference cards keep the same near-black ground and change only the
 * accent per artwork — mint on three of them, cyan on the blue one. Themes
 * here follow that: an accent, and a glow that matches it.
 */
export const THEMES: Theme[] = [
  {
    id: 'mint',
    name: 'Mint',
    accent: '#2FE3AC',
    loss: '#FF4D6D',
    glow: 'rgba(47, 227, 172, 0.10)',
    swatch: '#2FE3AC',
  },
  {
    id: 'cyan',
    name: 'Cyan',
    accent: '#64FAFF',
    loss: '#FF4D6D',
    glow: 'rgba(100, 250, 255, 0.10)',
    swatch: '#64FAFF',
  },
  {
    id: 'violet',
    name: 'Violet',
    accent: '#9B8CFF',
    loss: '#FF4D6D',
    glow: 'rgba(155, 140, 255, 0.10)',
    swatch: '#9B8CFF',
  },
  {
    id: 'gold',
    name: 'Gold',
    accent: '#FFC94D',
    loss: '#FF4D6D',
    glow: 'rgba(255, 201, 77, 0.10)',
    swatch: '#FFC94D',
  },
  {
    /**
     * The one dark accent in the set. It is deliberately not paired with the
     * shared `#FF4D6D` loss colour: a cherry card that flips to pink the moment
     * the number goes negative reads as a bug rather than as a signal, and the
     * red already carries the meaning. `readableOn` is what keeps the hero
     * value legible on it.
     */
    id: 'cherry',
    name: 'Cherry',
    accent: '#D2042D',
    loss: '#D2042D',
    glow: 'rgba(210, 4, 45, 0.12)',
    swatch: '#D2042D',
  },
  {
    id: 'white',
    name: 'Bone',
    accent: '#EAEDFF',
    loss: '#FF4D6D',
    glow: 'rgba(234, 237, 255, 0.07)',
    swatch: '#EAEDFF',
  },
];

export const DEFAULT_THEME_ID = 'mint';

/** Not in `THEMES`: it is built per card from the colour the user picked. */
export const CUSTOM_THEME_ID = 'custom';

/** Shown when the custom slot is selected before anything has been chosen. */
export const DEFAULT_CUSTOM_ACCENT = '#FF7A45';

export function getTheme(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!;
}

/**
 * A theme built from one arbitrary colour.
 *
 * Profit and loss are both that colour, for the same reason cherry's are: the
 * point of the custom slot is that the block is the colour the person picked,
 * and quietly repainting it on a losing card would undo the choice.
 */
export function customTheme(accent: string): Theme {
  const hex = normaliseHex(accent) ?? DEFAULT_CUSTOM_ACCENT;
  return {
    id: CUSTOM_THEME_ID,
    name: 'Custom',
    accent: hex,
    loss: hex,
    glow: withAlpha(hex, 0.12),
    swatch: hex,
  };
}

/**
 * The theme a card actually paints with. Everything that draws must go through
 * this rather than `getTheme`, which cannot see the custom colour and would
 * silently fall back to mint.
 */
export function resolveTheme(display: { themeId: string; customAccent?: string }): Theme {
  if (display.themeId === CUSTOM_THEME_ID) {
    return customTheme(display.customAccent ?? DEFAULT_CUSTOM_ACCENT);
  }
  return getTheme(display.themeId);
}

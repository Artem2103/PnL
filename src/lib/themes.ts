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
    id: 'white',
    name: 'Bone',
    accent: '#EAEDFF',
    loss: '#FF4D6D',
    glow: 'rgba(234, 237, 255, 0.07)',
    swatch: '#EAEDFF',
  },
];

export const DEFAULT_THEME_ID = 'mint';

export function getTheme(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!;
}

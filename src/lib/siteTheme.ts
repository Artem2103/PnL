/**
 * The site's colour themes: the picker beside the profile button. Not the card's
 * themes in `themes.ts`, which colour the PnL card; nothing here touches a card.
 *
 * The choice lives in this browser. `index.html` reads `BOOT_KEY` before any
 * script loads, so a dark theme does not flash light on the way in.
 */

import { useSyncExternalStore } from 'react';

export interface SiteTheme {
  id: string;
  label: string;
  dark: boolean;
  bg: string;
  card: string;
  soft: string;
  strong: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accentInk: string;
  /** The two soft washes behind the page, which give the glass something to show. */
  glowA: string;
  glowB: string;
}

export const SITE_THEMES: readonly SiteTheme[] = [
  { id: 'light', label: 'Light', dark: false, bg: '#f4f4f6', card: '#ffffff', soft: '#efeff1', strong: '#e5e5e8', border: '#e6e6ea', borderStrong: '#d2d2d8', text: '#0b0b0c', muted: '#55565c', faint: '#5f6067', accent: '#0b0b0c', accentInk: '#ffffff', glowA: '#a9b8f5', glowB: '#f3b7d6' },
  { id: 'sand', label: 'Sand', dark: false, bg: '#f3eee4', card: '#fffcf6', soft: '#efe8da', strong: '#e4dbc9', border: '#e8dfce', borderStrong: '#d6cbb6', text: '#241d12', muted: '#5c5243', faint: '#625847', accent: '#3b2f1e', accentInk: '#fffcf6', glowA: '#eec48a', glowB: '#d9b8a0' },
  { id: 'sky', label: 'Sky', dark: false, bg: '#eaf1fa', card: '#ffffff', soft: '#e3ecf8', strong: '#d3e0f2', border: '#dbe6f4', borderStrong: '#c3d4ea', text: '#0d1b2e', muted: '#3e4d62', faint: '#4b5b73', accent: '#1f5fd0', accentInk: '#ffffff', glowA: '#8fc0f7', glowB: '#a9a6f5' },
  { id: 'graphite', label: 'Graphite', dark: true, bg: '#1b1c20', card: '#26272c', soft: '#303137', strong: '#3b3c43', border: '#34353b', borderStrong: '#46474f', text: '#f2f2f4', muted: '#bcbdc5', faint: '#9b9ca5', accent: '#f2f2f4', accentInk: '#1b1c20', glowA: '#5b6275', glowB: '#6d5b75' },
  { id: 'black', label: 'Black', dark: true, bg: '#000000', card: '#0f0f11', soft: '#1a1a1d', strong: '#26262a', border: '#1f1f23', borderStrong: '#34343a', text: '#f6f6f7', muted: '#b4b5bc', faint: '#92939b', accent: '#ffffff', accentInk: '#000000', glowA: '#2c3350', glowB: '#3d2748' },
  { id: 'midnight', label: 'Midnight', dark: true, bg: '#0a0f1f', card: '#131a30', soft: '#1c2540', strong: '#27314f', border: '#212a45', borderStrong: '#323d5e', text: '#e9edf8', muted: '#aeb7cf', faint: '#8f99b4', accent: '#8aa6ff', accentInk: '#0a0f1f', glowA: '#3556c9', glowB: '#6a3fc0' },
  { id: 'forest', label: 'Forest', dark: true, bg: '#0b1511', card: '#13211b', soft: '#1b2d25', strong: '#263b31', border: '#20332a', borderStrong: '#31483d', text: '#e8f2ec', muted: '#a9bfb3', faint: '#8aa295', accent: '#5fd6a0', accentInk: '#0b1511', glowA: '#1f8a5f', glowB: '#2f7f8f' },
  { id: 'wine', label: 'Wine', dark: true, bg: '#180b12', card: '#25121c', soft: '#321a27', strong: '#422433', border: '#381e2c', borderStrong: '#50303f', text: '#f7e9ef', muted: '#cdb0bd', faint: '#ad909d', accent: '#f08fb4', accentInk: '#180b12', glowA: '#a12c63', glowB: '#6a2f9a' },
];

export const DEFAULT_SITE_THEME = 'light';

/**
 * How much of the page shows through. Kept low on purpose: the look should read
 * as a soft sheen, not as see-through panels. As hex alpha, for the tokens.
 */
export const GLASS_OPACITY = 0.56;
export const GLASS_STRONG_OPACITY = 0.82;
export const GLOW_OPACITY = { light: 0.62, dark: 0.5 };

function alpha(value: number): string {
  return Math.round(value * 255).toString(16).padStart(2, '0');
}

const KEY = 'astra:site-theme';
/** Read by the script in `index.html`: just what the first paint needs. */
const BOOT_KEY = 'astra:site-theme-boot';

/** Every CSS variable a theme sets. The rest of the site only ever reads these. */
export function tokensFor(theme: SiteTheme): Record<string, string> {
  return {
    '--bg': theme.bg,
    '--bg-elev': theme.card,
    '--bg-elev-strong': theme.strong,
    '--bg-soft': theme.soft,
    '--border': theme.border,
    '--border-strong': theme.borderStrong,
    '--text': theme.text,
    '--text-muted': theme.muted,
    '--text-faint': theme.faint,
    '--accent': theme.accent,
    '--accent-ink': theme.accentInk,
    '--topbar-bg': `${theme.bg}${alpha(0.74)}`,
    '--glass': `${theme.card}${alpha(GLASS_OPACITY)}`,
    '--glass-strong': `${theme.card}${alpha(GLASS_STRONG_OPACITY)}`,
    '--glass-edge': theme.dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.95)',
    '--glass-shadow': theme.dark
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 0 0 1px rgba(255, 255, 255, 0.07), 0 10px 30px rgba(0, 0, 0, 0.3)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 0 0 1px rgba(255, 255, 255, 0.55), 0 10px 30px rgba(30, 30, 60, 0.08)',
    '--glow-a': `${theme.glowA}${alpha(theme.dark ? GLOW_OPACITY.dark : GLOW_OPACITY.light)}`,
    '--glow-b': `${theme.glowB}${alpha(theme.dark ? GLOW_OPACITY.dark : GLOW_OPACITY.light)}`,
    '--profit': theme.dark ? '#4ade80' : '#0f8a44',
    '--loss': theme.dark ? '#fb7185' : '#d42a41',
    '--error-ink': theme.dark ? '#fda4af' : '#b3172d',
    '--ok-ink': theme.dark ? '#86efac' : '#0c7a3c',
    '--warn-ink': theme.dark ? '#fcd34d' : '#8a5a00',
    '--notice-bg': theme.dark ? '#3a2d0c' : '#fff4dc',
    '--notice-ink': theme.dark ? '#fde9b0' : '#6b4b00',
    '--shadow': theme.dark
      ? '0 0 0 1px rgba(255, 255, 255, 0.06)'
      : '0 0 0 1px rgba(11, 11, 12, 0.05), 0 1px 2px rgba(11, 11, 12, 0.04)',
  };
}

function find(id: string | null): SiteTheme {
  return SITE_THEMES.find((theme) => theme.id === id) ?? SITE_THEMES[0]!;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

let current = find(read(KEY));
const listeners = new Set<() => void>();

function paint(theme: SiteTheme): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokensFor(theme))) root.style.setProperty(name, value);
  root.style.background = theme.bg;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.dataset.siteTheme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
}

/** Called once before the first render. */
export function applySiteTheme(): void {
  paint(current);
}

export function setSiteTheme(id: string): void {
  current = find(id);
  paint(current);
  try {
    localStorage.setItem(KEY, current.id);
    localStorage.setItem(BOOT_KEY, JSON.stringify({ bg: current.bg, dark: current.dark }));
  } catch {
    /* Private mode: the theme lasts until the tab closes. */
  }
  for (const listener of listeners) listener();
}

export function useSiteTheme(): SiteTheme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

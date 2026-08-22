import type { CardState } from '../types';
import { MAX_CLIP_SECONDS } from './images';
import { DEFAULT_THEME_ID } from './themes';

/** Bumped from v1: the card model changed shape entirely. */
export const STORAGE_KEY = 'pnl-card-studio:v2';

/**
 * The defaults reproduce the reference card, so the layout can be compared
 * against it directly. The balances are chosen to print exactly the reference
 * strings: 10,680 -> "$10.7K", 20,800 -> "$20.8K", delta "+$10.1K", "+95%".
 */
export function createDefaultState(): CardState {
  return {
    mode: 'period',
    trade: {
      symbol: 'BTCUSDT',
      direction: 'long',
      leverage: 20,
      entryPrice: 61250,
      exitPrice: 68420,
      pnl: 5377,
      showDirectionInTitle: true,
    },
    period: {
      title: 'August 2026',
      startBalance: 10680,
      endBalance: 20800,
    },
    brand: {
      wordmark: 'STUDIO',
      handle: '@yourhandle',
      footerPrimary: 'yoursite.com',
      footerSecondary: 'Referral code: YOURS',
      currency: 'USD',
    },
    display: {
      themeId: DEFAULT_THEME_ID,
      showRows: true,
      showHandle: true,
      showFooter: true,
      showWordmark: true,
      showLogo: true,
      compactHero: true,
    },
    artwork: {
      imageId: null,
      scrim: 0.8,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      clipStart: 0,
      clipLength: MAX_CLIP_SECONDS,
      muteAudio: false,
    },
    avatarId: null,
    logoId: null,
  };
}

/**
 * Copies only the keys the current model knows about. Missing fields fall back
 * to the default, and fields that no longer exist (an older save's position
 * size, say) are dropped rather than carried along forever.
 */
function merge<T extends object>(base: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object') return base;
  const source = saved as Partial<T>;
  const out = { ...base };
  for (const key of Object.keys(base) as (keyof T)[]) {
    const value = source[key];
    if (value !== undefined) out[key] = value as T[keyof T];
  }
  return out;
}

/** Merges a persisted blob over the defaults so new fields never break old saves. */
export function hydrateState(raw: unknown): CardState {
  const base = createDefaultState();
  if (!raw || typeof raw !== 'object') return base;
  const saved = raw as Partial<CardState>;
  return {
    mode: saved.mode === 'trade' || saved.mode === 'period' ? saved.mode : base.mode,
    trade: merge(base.trade, saved.trade),
    period: merge(base.period, saved.period),
    brand: merge(base.brand, saved.brand),
    display: merge(base.display, saved.display),
    artwork: merge(base.artwork, saved.artwork),
    avatarId: saved.avatarId ?? base.avatarId,
    logoId: saved.logoId ?? base.logoId,
  };
}

export function loadState(): CardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    return hydrateState(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

export function saveState(state: CardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Private mode or a full quota — the card still works, it just won't persist. */
  }
}

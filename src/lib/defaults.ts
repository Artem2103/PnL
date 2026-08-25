import type { CardState } from '../types';
import { MAX_CLIP_SECONDS } from './images';
import { DEFAULT_CUSTOM_ACCENT, DEFAULT_THEME_ID } from './themes';

/**
 * Bumped from v1: the card model changed shape entirely.
 *
 * Since accounts landed this is a *prefix*: the real keys are
 * `pnl-card-studio:v2:<user id>`. The bare key is only read once more, by
 * `takeOrphanCard`, to rescue the card someone made before signing up.
 */
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
      customAccent: DEFAULT_CUSTOM_ACCENT,
      textTone: 'light',
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

/**
 * What one account's card looks like in this browser's cache.
 *
 * `cardId` is the row in `public.cards` this state belongs to, and `updatedAt`
 * is the server's timestamp for the last version that was successfully saved —
 * *not* the time of the last keystroke. That distinction is what lets a reload
 * tell "my edits are ahead of the server" from "the server is ahead of me".
 */
export interface CardSnapshot {
  cardId: string | null;
  state: CardState;
  updatedAt: number;
  /**
   * There are edits here that the account has not accepted yet — a save still
   * in flight, a closed tab, an aeroplane.
   *
   * Without this the merge on next load is wrong in the one case that matters:
   * `updatedAt` only moves when a save *succeeds*, so unsaved edits leave it
   * behind the server's and the reload would helpfully throw them away.
   */
  dirty: boolean;
}

/** Per-account, so two people sharing a browser never see each other's card. */
function keyFor(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

export function loadLocalCard(userId: string): CardSnapshot {
  const empty: CardSnapshot = {
    cardId: null,
    state: createDefaultState(),
    updatedAt: 0,
    dirty: false,
  };
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<CardSnapshot>;
    return {
      cardId: typeof parsed.cardId === 'string' ? parsed.cardId : null,
      state: hydrateState(parsed.state),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      dirty: parsed.dirty === true,
    };
  } catch {
    return empty;
  }
}

export function saveLocalCard(userId: string, snapshot: CardSnapshot): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(snapshot));
  } catch {
    /* Private mode or a full quota — the card still works and still syncs to
       the account; this browser just won't have it ready on the next paint. */
  }
}

export function clearLocalCard(userId: string): void {
  try {
    localStorage.removeItem(keyFor(userId));
  } catch {
    /* Nothing to do — a cache that will not clear is not worth an error. */
  }
}

/**
 * The card left behind by the version of this app that had no accounts, if it
 * is still there. Returned once and then removed, so the first account to sign
 * in adopts it and later ones start clean — the same rule `claimOrphans` uses
 * for media, for the same reason.
 */
export function takeOrphanCard(): CardState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = hydrateState(JSON.parse(raw));
    localStorage.removeItem(STORAGE_KEY);
    return state;
  } catch {
    return null;
  }
}

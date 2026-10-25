/**
 * The trades store. Every panel, chart, table and modal of the journal reads
 * from here, and every change goes through here to the repository — no
 * component keeps its own copy of a trade. When MT5 sync lands it writes
 * through the same repository and calls `reload`, and the UI follows.
 */

import { useEffect, useSyncExternalStore } from 'react';
import {
  isJournalNotInstalled,
  LocalTradeRepository,
  SupabaseTradeRepository,
  type TradeRepository,
} from './repository';
import { DEFAULT_SETTINGS, type JournalSettings, type Trade, type TradeInput } from './types';
import { isSupabaseConfigured } from '../lib/supabase';
import { LOCAL_USER_ID } from '../lib/auth';

export type JournalStorage =
  /** The account's tables. */
  | 'account'
  /** No accounts configured: this browser is the only copy. */
  | 'browser'
  /** Accounts are on but the journal tables are not installed yet. */
  | 'browser-fallback';

export interface JournalState {
  status: 'loading' | 'ready' | 'error';
  trades: Trade[];
  settings: JournalSettings;
  storage: JournalStorage;
  error: string | null;
}

const INITIAL: JournalState = {
  status: 'loading',
  trades: [],
  settings: DEFAULT_SETTINGS,
  storage: 'browser',
  error: null,
};

let state: JournalState = INITIAL;
let owner: string | null = null;
let repo: TradeRepository | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<JournalState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Loads (or reloads) everything for `userId`. */
export async function reload(userId: string): Promise<void> {
  if (owner !== userId) {
    owner = userId;
    state = { ...INITIAL };
    const remote = isSupabaseConfigured && userId !== LOCAL_USER_ID;
    repo = remote ? new SupabaseTradeRepository(userId) : new LocalTradeRepository(userId);
    set({ storage: remote ? 'account' : 'browser' });
  }
  const current = repo;
  if (!current) return;
  try {
    let [trades, settings] = await Promise.all([current.getTrades(), current.getSettings()]);
    if (repo !== current) return;
    if (current instanceof SupabaseTradeRepository && trades.length === 0) {
      trades = await adoptFallbackTrades(userId, current);
      if (trades.length) settings = await current.getSettings();
      if (repo !== current) return;
    }
    set({ status: 'ready', trades, settings, error: null });
  } catch (error) {
    if (repo !== current) return;
    if (current instanceof SupabaseTradeRepository && isJournalNotInstalled(error)) {
      console.warn('The journal tables are not installed yet; trades are kept in this browser.');
      repo = new LocalTradeRepository(userId);
      set({ storage: 'browser-fallback' });
      await reload(userId);
      return;
    }
    set({ status: 'error', error: message(error, 'Could not load your trades.') });
  }
}

/**
 * Trades kept in this browser while the journal tables were missing move into
 * the account the first time the account answers with an empty journal, so
 * running the SQL late does not strand them. The browser copy is cleared only
 * after the insert succeeds.
 */
async function adoptFallbackTrades(userId: string, remote: TradeRepository): Promise<Trade[]> {
  const local = new LocalTradeRepository(userId);
  const stranded = await local.getTrades();
  if (stranded.length === 0) return [];
  const added = await remote.addTrades(
    stranded.map(({ id: _id, createdAt: _c, updatedAt: _u, ...input }) => input),
  );
  await remote.saveSettings(await local.getSettings());
  await local.clearTrades();
  return added;
}

function requireRepo(): TradeRepository {
  if (!repo) throw new Error('The journal is not open.');
  return repo;
}

export async function addTrade(input: TradeInput): Promise<Trade> {
  const trade = await requireRepo().addTrade(input);
  set({ trades: [...state.trades, trade] });
  return trade;
}

export async function addTrades(inputs: TradeInput[]): Promise<void> {
  const added = await requireRepo().addTrades(inputs);
  set({ trades: [...state.trades, ...added] });
}

export async function updateTrade(id: string, input: TradeInput): Promise<Trade> {
  const trade = await requireRepo().updateTrade(id, input);
  set({ trades: state.trades.map((t) => (t.id === id ? trade : t)) });
  return trade;
}

export async function deleteTrade(id: string): Promise<void> {
  await requireRepo().deleteTrade(id);
  set({ trades: state.trades.filter((t) => t.id !== id) });
}

export async function clearTrades(): Promise<void> {
  await requireRepo().clearTrades();
  set({ trades: [] });
}

export async function saveSettings(settings: JournalSettings): Promise<void> {
  const saved = await requireRepo().saveSettings(settings);
  set({ settings: saved });
}

/** The journal for `userId`, loaded on first use. */
export function useJournal(userId: string): JournalState {
  useEffect(() => {
    if (owner !== userId || state.status === 'error') void reload(userId);
  }, [userId]);
  return useSyncExternalStore(subscribe, () => state);
}

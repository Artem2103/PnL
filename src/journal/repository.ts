/**
 * The one place trades are read from and written to.
 *
 * Two implementations behind one interface: the account's `trades` and
 * `journal_settings` tables when Supabase is configured, and `localStorage`
 * when it is not (local mode). The store above this never knows which, so
 * swapping in another backend — or MT5 sync writing into the same table — is
 * a change here and nowhere else.
 */

import { requireSupabase } from '../lib/supabase';
import { DEFAULT_SETTINGS, type JournalSettings, type Trade, type TradeInput } from './types';

export interface TradeRepository {
  getTrades(): Promise<Trade[]>;
  addTrade(input: TradeInput): Promise<Trade>;
  /** Several at once — the demo seed, and later an MT5 import. */
  addTrades(inputs: TradeInput[]): Promise<Trade[]>;
  updateTrade(id: string, input: TradeInput): Promise<Trade>;
  deleteTrade(id: string): Promise<void>;
  /** Every trade of the account. Settings are kept. */
  clearTrades(): Promise<void>;
  getSettings(): Promise<JournalSettings>;
  saveSettings(settings: JournalSettings): Promise<JournalSettings>;
}

/**
 * The database answers "relation does not exist" until the journal section of
 * `supabase/schema.sql` has been run. The store falls back to this browser in
 * that one case, rather than showing a journal that cannot save.
 */
export function isJournalNotInstalled(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST204';
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function hydrateSettings(raw: unknown): JournalSettings {
  const source = (raw ?? {}) as Partial<JournalSettings>;
  return {
    startingBalance:
      typeof source.startingBalance === 'number' && Number.isFinite(source.startingBalance)
        ? source.startingBalance
        : DEFAULT_SETTINGS.startingBalance,
    currency:
      typeof source.currency === 'string' && source.currency.trim()
        ? source.currency.trim().toUpperCase()
        : DEFAULT_SETTINGS.currency,
  };
}

/* ------------------------------------------------------------------ */
/* localStorage                                                        */
/* ------------------------------------------------------------------ */

const LOCAL_PREFIX = 'astra:journal:v1';

export class LocalTradeRepository implements TradeRepository {
  constructor(private readonly userId: string) {}

  private get tradesKey() {
    return `${LOCAL_PREFIX}:trades:${this.userId}`;
  }

  private get settingsKey() {
    return `${LOCAL_PREFIX}:settings:${this.userId}`;
  }

  private read(): Trade[] {
    try {
      const raw = localStorage.getItem(this.tradesKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as Trade[]) : [];
    } catch {
      return [];
    }
  }

  private write(trades: Trade[]): void {
    try {
      localStorage.setItem(this.tradesKey, JSON.stringify(trades));
    } catch {
      throw new Error('This browser would not save the trade — its storage is full or blocked.');
    }
  }

  async getTrades(): Promise<Trade[]> {
    return this.read();
  }

  async addTrade(input: TradeInput): Promise<Trade> {
    const [trade] = await this.addTrades([input]);
    if (!trade) throw new Error('The trade was not saved.');
    return trade;
  }

  async addTrades(inputs: TradeInput[]): Promise<Trade[]> {
    const now = new Date().toISOString();
    const added = inputs.map((input) => ({ ...input, id: newId(), createdAt: now, updatedAt: now }));
    this.write([...this.read(), ...added]);
    return added;
  }

  async updateTrade(id: string, input: TradeInput): Promise<Trade> {
    const trades = this.read();
    const index = trades.findIndex((trade) => trade.id === id);
    const current = trades[index];
    if (!current) throw new Error('That trade no longer exists.');
    const updated: Trade = { ...current, ...input, id, updatedAt: new Date().toISOString() };
    trades[index] = updated;
    this.write(trades);
    return updated;
  }

  async deleteTrade(id: string): Promise<void> {
    this.write(this.read().filter((trade) => trade.id !== id));
  }

  async clearTrades(): Promise<void> {
    this.write([]);
  }

  async getSettings(): Promise<JournalSettings> {
    try {
      const raw = localStorage.getItem(this.settingsKey);
      return hydrateSettings(raw ? JSON.parse(raw) : null);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(settings: JournalSettings): Promise<JournalSettings> {
    const clean = hydrateSettings(settings);
    try {
      localStorage.setItem(this.settingsKey, JSON.stringify(clean));
    } catch {
      throw new Error('This browser would not save the settings.');
    }
    return clean;
  }
}

/* ------------------------------------------------------------------ */
/* Supabase                                                            */
/* ------------------------------------------------------------------ */

interface TradeRow {
  id: string;
  source: Trade['source'];
  external_id: string | null;
  symbol: string;
  side: Trade['side'];
  entry_price: number;
  close_price: number | null;
  lots: number;
  pnl: number;
  opened_at: string;
  closed_at: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

const TRADE_COLUMNS =
  'id, source, external_id, symbol, side, entry_price, close_price, lots, pnl, opened_at, closed_at, note, created_at, updated_at';

function fromRow(row: TradeRow): Trade {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    symbol: row.symbol,
    side: row.side,
    entryPrice: Number(row.entry_price),
    closePrice: row.close_price === null ? null : Number(row.close_price),
    lots: Number(row.lots),
    pnl: Number(row.pnl),
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    note: row.note ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(input: TradeInput) {
  return {
    source: input.source,
    external_id: input.externalId,
    symbol: input.symbol,
    side: input.side,
    entry_price: input.entryPrice,
    close_price: input.closePrice,
    lots: input.lots,
    pnl: input.pnl,
    opened_at: input.openedAt,
    closed_at: input.closedAt,
    note: input.note,
  };
}

/** Keeps the Postgres code on the error so `isJournalNotInstalled` can read it. */
function fail(what: string, error: { message: string; code?: string }): never {
  throw Object.assign(new Error(`${what}: ${error.message}`), { code: error.code });
}

export class SupabaseTradeRepository implements TradeRepository {
  constructor(private readonly userId: string) {}

  async getTrades(): Promise<Trade[]> {
    const { data, error } = await requireSupabase()
      .from('trades')
      .select(TRADE_COLUMNS)
      .eq('user_id', this.userId)
      .order('closed_at', { ascending: false });
    if (error) fail('Could not load your trades', error);
    return (data as TradeRow[]).map(fromRow);
  }

  async addTrade(input: TradeInput): Promise<Trade> {
    const [trade] = await this.addTrades([input]);
    if (!trade) throw new Error('The trade was not saved.');
    return trade;
  }

  async addTrades(inputs: TradeInput[]): Promise<Trade[]> {
    if (inputs.length === 0) return [];
    const { data, error } = await requireSupabase()
      .from('trades')
      .insert(inputs.map((input) => ({ ...toRow(input), user_id: this.userId })))
      .select(TRADE_COLUMNS);
    if (error) fail('Could not save the trade', error);
    return (data as TradeRow[]).map(fromRow);
  }

  async updateTrade(id: string, input: TradeInput): Promise<Trade> {
    const { data, error } = await requireSupabase()
      .from('trades')
      .update(toRow(input))
      .eq('id', id)
      .select(TRADE_COLUMNS)
      .single();
    if (error) fail('Could not save the trade', error);
    return fromRow(data as TradeRow);
  }

  async deleteTrade(id: string): Promise<void> {
    const { error } = await requireSupabase().from('trades').delete().eq('id', id);
    if (error) fail('Could not delete the trade', error);
  }

  async clearTrades(): Promise<void> {
    const { error } = await requireSupabase().from('trades').delete().eq('user_id', this.userId);
    if (error) fail('Could not clear your trades', error);
  }

  async getSettings(): Promise<JournalSettings> {
    const { data, error } = await requireSupabase()
      .from('journal_settings')
      .select('starting_balance, currency')
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) fail('Could not load your journal settings', error);
    const row = data as { starting_balance: number; currency: string } | null;
    return hydrateSettings(
      row ? { startingBalance: Number(row.starting_balance), currency: row.currency } : null,
    );
  }

  async saveSettings(settings: JournalSettings): Promise<JournalSettings> {
    const clean = hydrateSettings(settings);
    const { error } = await requireSupabase().from('journal_settings').upsert({
      user_id: this.userId,
      starting_balance: clean.startingBalance,
      currency: clean.currency,
    });
    if (error) fail('Could not save your journal settings', error);
    return clean;
  }
}

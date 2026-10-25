/**
 * Where a trade came from. Every trade typed into the journal is `manual`;
 * MT5 sync will write `mt5` trades into the same store, and nothing in the UI
 * branches on it.
 */
export type TradeSource = 'manual' | 'mt5';

export type TradeSide = 'buy' | 'sell';

export interface Trade {
  id: string;
  source: TradeSource;
  /** The broker's deal ticket for synced trades, so a re-sync never duplicates. */
  externalId: string | null;
  /** Upper case, no separator: `EURUSD`, `NAS100`, `XAUUSD`. */
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  /** Null while the position is open. */
  closePrice: number | null;
  lots: number;
  /**
   * Profit or loss in the account currency — realized once closed, floating
   * while open. Typed in for manual trades; the broker reports it for MT5.
   */
  pnl: number;
  /** ISO timestamps. */
  openedAt: string;
  closedAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** What a caller supplies; the repository owns the id and the timestamps. */
export type TradeInput = Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>;

export interface JournalSettings {
  /** The balance before the first trade; the curve and every % hang off it. */
  startingBalance: number;
  currency: string;
}

export const DEFAULT_SETTINGS: JournalSettings = { startingBalance: 10000, currency: 'USD' };

export type Period = '1d' | '7d' | '30d' | 'max';

export const PERIODS: readonly { id: Period; label: string }[] = [
  { id: '1d', label: '1d' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'max', label: 'Max' },
];

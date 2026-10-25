/**
 * Everything the journal shows, derived from the trades and nothing else.
 * Pure functions, so the numbers are unit-tested rather than checked by eye.
 *
 * Times are bucketed in the viewer's local time zone — a trader thinks of
 * "Tuesday 14:00" and "the 13th" as their own clock shows them.
 */

import type { JournalSettings, Period, Trade } from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const PERIOD_MS: Record<Exclude<Period, 'max'>, number> = {
  '1d': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};

/** Start of the window, or null for all time. */
export function periodStart(period: Period, now: number): number | null {
  return period === 'max' ? null : now - PERIOD_MS[period];
}

export function closeTime(trade: Trade): number {
  return trade.closedAt ? Date.parse(trade.closedAt) : NaN;
}

/** Closed trades, oldest close first. */
export function closedTrades(trades: readonly Trade[]): Trade[] {
  return trades
    .filter((trade) => trade.closedAt && Number.isFinite(closeTime(trade)))
    .sort((a, b) => closeTime(a) - closeTime(b));
}

/** Closed trades whose close falls inside the window. */
export function tradesInPeriod(trades: readonly Trade[], start: number | null, now: number): Trade[] {
  return closedTrades(trades).filter((trade) => {
    const t = closeTime(trade);
    return (start === null || t >= start) && t <= now;
  });
}

export function sumPnl(trades: readonly Trade[]): number {
  return trades.reduce((total, trade) => total + trade.pnl, 0);
}

/** Starting balance plus everything realized up to `at` (inclusive), or ever. */
export function balanceAt(trades: readonly Trade[], settings: JournalSettings, at?: number): number {
  const closed = closedTrades(trades);
  const realized = at === undefined ? closed : closed.filter((trade) => closeTime(trade) <= at);
  return settings.startingBalance + sumPnl(realized);
}

/** Sum of open positions' PnL. Zero for a manual-only journal. */
export function floatingPnl(trades: readonly Trade[]): number {
  return sumPnl(trades.filter((trade) => !trade.closedAt));
}

/**
 * Each trade's PnL as a percentage of the balance when it was opened: the
 * starting balance plus every trade closed before that moment.
 */
export function pnlPercentages(
  trades: readonly Trade[],
  settings: JournalSettings,
): Map<string, number> {
  const closed = closedTrades(trades);
  const closes = closed.map(closeTime);
  const running: number[] = [];
  let total = 0;
  for (const trade of closed) {
    total += trade.pnl;
    running.push(total);
  }
  const out = new Map<string, number>();
  for (const trade of trades) {
    const opened = Date.parse(trade.openedAt);
    // Last close strictly before the open.
    let lo = 0;
    let hi = closes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((closes[mid] ?? 0) < opened) lo = mid + 1;
      else hi = mid;
    }
    const realized = lo > 0 ? (running[lo - 1] ?? 0) : 0;
    const balance = settings.startingBalance + realized;
    out.set(trade.id, balance > 0 ? (trade.pnl / balance) * 100 : 0);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Balance curve                                                       */
/* ------------------------------------------------------------------ */

export interface CurvePoint {
  time: number;
  balance: number;
}

/**
 * The balance over the window: one point at the window's start, then one per
 * closed trade. Max starts at the first trade, from the starting balance.
 */
export function balanceCurve(
  trades: readonly Trade[],
  settings: JournalSettings,
  start: number | null,
  now: number,
): CurvePoint[] {
  const inside = tradesInPeriod(trades, start, now);
  const first = inside[0];
  const origin = start ?? (first ? Math.min(Date.parse(first.openedAt), closeTime(first)) : now);
  let balance = start === null ? settings.startingBalance : balanceAt(trades, settings, start - 1);
  const points: CurvePoint[] = [{ time: origin, balance }];
  for (const trade of inside) {
    balance += trade.pnl;
    points.push({ time: closeTime(trade), balance });
  }
  points.push({ time: now, balance });
  return points;
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

export interface Bucket {
  id: string;
  label: string;
  tone: 'win-strong' | 'win' | 'win-soft' | 'loss-soft' | 'loss';
  count: number;
}

export interface Performance {
  totalPnl: number;
  total: number;
  wins: number;
  losses: number;
  /** 0..100, or null with no trades. */
  winRate: number | null;
  /** Gross profit / gross loss; Infinity with wins and no losses, null with neither. */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  buckets: Bucket[];
}

/** Which bucket a trade's % of balance falls in. Breakeven counts as 0% ~ +2%. */
export function bucketIndex(pct: number): number {
  if (pct > 5) return 0;
  if (pct > 2) return 1;
  if (pct >= 0) return 2;
  if (pct >= -2) return 3;
  return 4;
}

export function performance(trades: readonly Trade[], pct: Map<string, number>): Performance {
  const wins = trades.filter((trade) => trade.pnl > 0);
  const losses = trades.filter((trade) => trade.pnl < 0);
  const grossWin = sumPnl(wins);
  const grossLoss = -sumPnl(losses);
  const buckets: Bucket[] = [
    { id: 'gt5', label: '>5%', tone: 'win-strong', count: 0 },
    { id: '2to5', label: '2% ~ 5%', tone: 'win', count: 0 },
    { id: '0to2', label: '0% ~ 2%', tone: 'win-soft', count: 0 },
    { id: '0tom2', label: '0% ~ -2%', tone: 'loss-soft', count: 0 },
    { id: 'ltm2', label: '< -2%', tone: 'loss', count: 0 },
  ];
  for (const trade of trades) {
    const bucket = buckets[bucketIndex(pct.get(trade.id) ?? 0)];
    if (bucket) bucket.count += 1;
  }
  return {
    totalPnl: sumPnl(trades),
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    buckets,
  };
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

export interface HeatCell {
  net: number;
  count: number;
}

/** Monday = 0 … Sunday = 6. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** 7 rows (Mon–Sun) × 24 hours, by close time. */
export function heatmap(trades: readonly Trade[]): HeatCell[][] {
  const grid = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ net: 0, count: 0 })),
  );
  for (const trade of trades) {
    const date = new Date(closeTime(trade));
    const cell = grid[weekdayIndex(date)]?.[date.getHours()];
    if (!cell) continue;
    cell.net += trade.pnl;
    cell.count += 1;
  }
  return grid;
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DayTotal {
  net: number;
  count: number;
}

/** Net PnL and trade count per local calendar day of close. */
export function dailyTotals(trades: readonly Trade[]): Map<string, DayTotal> {
  const out = new Map<string, DayTotal>();
  for (const trade of closedTrades(trades)) {
    const key = dayKey(new Date(closeTime(trade)));
    const day = out.get(key) ?? { net: 0, count: 0 };
    day.net += trade.pnl;
    day.count += 1;
    out.set(key, day);
  }
  return out;
}

export interface CalendarDay {
  date: Date;
  key: string;
  day: number;
  total: DayTotal | null;
}

/** The month as weeks of Monday-first cells; null pads the edges. */
export function monthGrid(
  year: number,
  month: number,
  daily: Map<string, DayTotal>,
): (CalendarDay | null)[][] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (CalendarDay | null)[] = Array.from({ length: weekdayIndex(first) }, () => null);
  for (let day = 1; day <= days; day++) {
    const date = new Date(year, month, day);
    const key = dayKey(date);
    cells.push({ date, key, day, total: daily.get(key) ?? null });
  }
  while (cells.length % 7) cells.push(null);
  const weeks: (CalendarDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function monthPrefix(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-`;
}

function daysOfMonth(daily: Map<string, DayTotal>, year: number, month: number): [string, DayTotal][] {
  const prefix = monthPrefix(year, month);
  return [...daily.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
}

export interface MonthSummary {
  total: number;
  trades: number;
  winDays: number;
  winTotal: number;
  lossDays: number;
  lossTotal: number;
  activeDays: number;
}

export function monthSummary(daily: Map<string, DayTotal>, year: number, month: number): MonthSummary {
  const out: MonthSummary = {
    total: 0, trades: 0, winDays: 0, winTotal: 0, lossDays: 0, lossTotal: 0, activeDays: 0,
  };
  for (const [, day] of daysOfMonth(daily, year, month)) {
    out.total += day.net;
    out.trades += day.count;
    out.activeDays += 1;
    if (day.net > 0) {
      out.winDays += 1;
      out.winTotal += day.net;
    } else if (day.net < 0) {
      out.lossDays += 1;
      out.lossTotal += day.net;
    }
  }
  return out;
}

/** Longest run of consecutive profitable trading days in an ordered list. */
function longestRun(days: readonly DayTotal[]): number {
  let best = 0;
  let run = 0;
  for (const day of days) {
    run = day.net > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Streaks count trading days — days with at least one closed trade. A day
 * without trades neither extends nor breaks one; a losing or flat day breaks it.
 */
export interface Streaks {
  current: number;
  bestInMonth: number;
  bestAllTime: number;
  activeDaysInMonth: number;
  bestMonthActiveDays: number;
}

export function streaks(
  daily: Map<string, DayTotal>,
  year: number,
  month: number,
  today: Date,
): Streaks {
  const all = [...daily.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const todayKey = dayKey(today);
  let current = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const entry = all[i];
    if (!entry || entry[0] > todayKey) continue;
    if (entry[1].net > 0) current += 1;
    else break;
  }
  const perMonth = new Map<string, number>();
  for (const [key] of all) perMonth.set(key.slice(0, 7), (perMonth.get(key.slice(0, 7)) ?? 0) + 1);
  const inMonth = daysOfMonth(daily, year, month);
  return {
    current,
    bestInMonth: longestRun(inMonth.map(([, day]) => day)),
    bestAllTime: longestRun(all.map(([, day]) => day)),
    activeDaysInMonth: inMonth.length,
    bestMonthActiveDays: Math.max(0, ...perMonth.values()),
  };
}

/** Balance before the month's first day and after its last. */
export function monthBalances(
  trades: readonly Trade[],
  settings: JournalSettings,
  year: number,
  month: number,
): { start: number; end: number } {
  const from = new Date(year, month, 1).getTime();
  const to = new Date(year, month + 1, 1).getTime();
  return { start: balanceAt(trades, settings, from - 1), end: balanceAt(trades, settings, to - 1) };
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

/** "just now", "12m ago", "5h ago", "5d ago", "3mo ago". */
export function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

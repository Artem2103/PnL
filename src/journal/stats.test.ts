import { describe, expect, it } from 'vitest';
import type { Trade } from './types';
import {
  balanceAt,
  balanceCurve,
  bucketIndex,
  dailyTotals,
  heatmap,
  monthBalances,
  monthGrid,
  monthSummary,
  performance,
  pnlPercentages,
  relativeTime,
  streaks,
  tradesInPeriod,
} from './stats';
import { displaySymbol, normalizeSymbol, symbolInitials } from './symbols';
import { demoTrades } from './demo';
import { journalCardState } from './shareCard';
import { createDefaultState } from '../lib/defaults';
import { computeCard } from '../lib/pnl';

const settings = { startingBalance: 10_000, currency: 'USD' };

let n = 0;
function trade(pnl: number, opened: string, closed: string | null, extra: Partial<Trade> = {}): Trade {
  n += 1;
  return {
    id: `t${n}`,
    source: 'manual',
    externalId: null,
    symbol: 'EURUSD',
    side: 'buy',
    entryPrice: 1.1,
    closePrice: closed ? 1.2 : null,
    lots: 1,
    pnl,
    openedAt: new Date(opened).toISOString(),
    closedAt: closed ? new Date(closed).toISOString() : null,
    note: '',
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

// Local times, so the day and hour buckets are what a reader expects in any zone.
const a = trade(500, '2026-10-01T09:00', '2026-10-01T10:30');
const b = trade(-200, '2026-10-02T14:00', '2026-10-02T15:10');
const c = trade(300, '2026-10-05T09:00', '2026-10-05T11:00');
const d = trade(100, '2026-10-06T09:00', '2026-10-06T09:30');
const open = trade(-40, '2026-10-07T09:00', null);
const all = [d, b, open, a, c];

describe('balances', () => {
  it('adds realized PnL to the starting balance, ignoring open trades', () => {
    expect(balanceAt(all, settings)).toBe(10_700);
    expect(balanceAt(all, settings, new Date('2026-10-02T23:00').getTime())).toBe(10_300);
  });

  it('measures each trade against the balance when it opened', () => {
    const pct = pnlPercentages(all, settings);
    expect(pct.get(a.id)).toBeCloseTo(5);
    expect(pct.get(b.id)).toBeCloseTo((-200 / 10_500) * 100);
    expect(pct.get(c.id)).toBeCloseTo((300 / 10_300) * 100);
  });

  it('draws the curve from the window start through each close', () => {
    const now = new Date('2026-10-10T12:00').getTime();
    const start = new Date('2026-10-02T00:00').getTime();
    const curve = balanceCurve(all, settings, start, now);
    expect(curve.map((p) => p.balance)).toEqual([10_500, 10_300, 10_600, 10_700, 10_700]);
    expect(curve[0]?.time).toBe(start);
  });

  it('starts the Max curve at the starting balance', () => {
    const now = new Date('2026-10-10T12:00').getTime();
    expect(balanceCurve(all, settings, null, now)[0]?.balance).toBe(10_000);
  });

  it('gives a month its opening and closing balance', () => {
    expect(monthBalances(all, settings, 2026, 9)).toEqual({ start: 10_000, end: 10_700 });
    expect(monthBalances(all, settings, 2026, 10)).toEqual({ start: 10_700, end: 10_700 });
  });
});

describe('performance', () => {
  it('counts wins, losses, rate, factor and averages', () => {
    const closed = tradesInPeriod(all, null, Date.now());
    const stats = performance(closed, pnlPercentages(all, settings));
    expect(stats.total).toBe(4);
    expect(stats.wins).toBe(3);
    expect(stats.losses).toBe(1);
    expect(stats.totalPnl).toBe(700);
    expect(stats.winRate).toBe(75);
    expect(stats.profitFactor).toBeCloseTo(900 / 200);
    expect(stats.avgWin).toBe(300);
    expect(stats.avgLoss).toBe(-200);
    expect(stats.buckets.map((x) => x.count)).toEqual([0, 2, 1, 1, 0]);
  });

  it('has nothing to say about an empty period', () => {
    const stats = performance([], new Map());
    expect(stats.winRate).toBeNull();
    expect(stats.profitFactor).toBeNull();
  });

  it('buckets on the boundaries the way the labels read', () => {
    expect([5.01, 5, 2.01, 2, 0, -0.01, -2, -2.01].map(bucketIndex)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it('filters by close time', () => {
    const now = new Date('2026-10-06T12:00').getTime();
    expect(tradesInPeriod(all, now - 86_400_000, now).map((t) => t.id)).toEqual([d.id]);
  });
});

describe('heatmap', () => {
  it('buckets by weekday (Monday first) and hour of close', () => {
    const grid = heatmap(tradesInPeriod(all, null, Date.now()));
    // 1 Oct 2026 is a Thursday; closed 10:30.
    expect(grid[3]?.[10]).toEqual({ net: 500, count: 1 });
    // 5 Oct is a Monday, closed 11:00; 6 Oct a Tuesday, closed 09:30.
    expect(grid[0]?.[11]).toEqual({ net: 300, count: 1 });
    expect(grid[1]?.[9]).toEqual({ net: 100, count: 1 });
  });
});

describe('calendar', () => {
  const daily = dailyTotals(all);

  it('lays the month out Monday first', () => {
    const weeks = monthGrid(2026, 9, daily);
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0]?.[3]?.day).toBe(1);
    expect(weeks[0]?.[3]?.total).toEqual({ net: 500, count: 1 });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('splits the month into winning and losing days', () => {
    expect(monthSummary(daily, 2026, 9)).toEqual({
      total: 700, trades: 4, winDays: 3, winTotal: 900, lossDays: 1, lossTotal: -200, activeDays: 4,
    });
  });

  it('counts streaks in trading days', () => {
    const s = streaks(daily, 2026, 9, new Date('2026-10-20T12:00'));
    expect(s).toEqual({
      current: 2, bestInMonth: 2, bestAllTime: 2, activeDaysInMonth: 4, bestMonthActiveDays: 4,
    });
  });
});

describe('symbols', () => {
  it('normalizes and displays pairs', () => {
    expect(normalizeSymbol('eur/usd')).toBe('EURUSD');
    expect(displaySymbol('EURUSD')).toBe('EUR/USD');
    expect(displaySymbol('xauusd')).toBe('XAU/USD');
    expect(displaySymbol('NAS100')).toBe('NAS100');
    expect(symbolInitials('NAS100')).toBe('NAS');
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    expect(relativeTime('2026-10-20T12:00:00Z', now)).toBe('5d ago');
    expect(relativeTime('2026-10-25T11:30:00Z', now)).toBe('30m ago');
  });
});

describe('demo data', () => {
  it('makes about thirty closed trades over the last two months', () => {
    const now = new Date('2026-10-25T12:00');
    const trades = demoTrades(now);
    expect(trades.length).toBeGreaterThanOrEqual(28);
    for (const t of trades) {
      const closed = Date.parse(t.closedAt ?? '');
      expect(closed).toBeLessThanOrEqual(now.getTime());
      expect(closed).toBeGreaterThan(now.getTime() - 62 * 86_400_000);
      expect(Date.parse(t.openedAt)).toBeLessThan(closed);
      expect(t.pnl > 0).toBe(t.side === 'buy' ? (t.closePrice ?? 0) > t.entryPrice : (t.closePrice ?? 0) < t.entryPrice);
    }
  });
});

describe('share card', () => {
  it('prints the journal percentage on a trade card', () => {
    const state = journalCardState(createDefaultState(), { kind: 'trade', trade: a, pct: 5 }, 'USD');
    expect(state.mode).toBe('trade');
    expect(state.trade.symbol).toBe('EUR/USD');
    expect(computeCard(state).roiPct).toBe(5);
  });

  it('builds a month card from the balances', () => {
    const state = journalCardState(
      createDefaultState(),
      { kind: 'period', title: 'October 2026', startBalance: 10_000, endBalance: 10_700 },
      'EUR',
    );
    expect(state.period.title).toBe('October 2026');
    expect(state.brand.currency).toBe('EUR');
    expect(computeCard(state).roiPct).toBeCloseTo(7);
  });
});

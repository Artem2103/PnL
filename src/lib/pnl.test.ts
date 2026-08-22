import { describe, expect, it } from 'vitest';
import { approximateLiquidationPrice, computePeriod, computeTrade, signsDisagree } from './pnl';
import type { PeriodState, TradeState } from '../types';

const baseTrade: TradeState = {
  symbol: 'BTCUSDT',
  direction: 'long',
  leverage: 10,
  entryPrice: 100,
  exitPrice: 110,
  pnl: 20,
  showDirectionInTitle: true,
};

const trade = (patch: Partial<TradeState> = {}): TradeState => ({ ...baseTrade, ...patch });
const period = (patch: Partial<PeriodState> = {}): PeriodState => ({
  title: 'August 2026',
  startBalance: 10680,
  endBalance: 20800,
  ...patch,
});

describe('computeTrade', () => {
  it('multiplies a long move by leverage', () => {
    const result = computeTrade(trade());
    expect(result.roiPct).toBeCloseTo(100);
    expect(result.isProfit).toBe(true);
  });

  it('inverts the move for shorts', () => {
    expect(computeTrade(trade({ direction: 'short' })).roiPct).toBeCloseTo(-100);
  });

  it('profits on a short when price falls', () => {
    expect(computeTrade(trade({ direction: 'short', exitPrice: 90 })).roiPct).toBeCloseTo(100);
  });

  it('treats leverage below 1 as spot', () => {
    expect(computeTrade(trade({ leverage: 0 })).roiPct).toBeCloseTo(10);
  });

  it('takes the money exactly as entered, whatever the position size was', () => {
    expect(computeTrade(trade({ pnl: 1834.52 })).pnl).toBe(1834.52);
    expect(computeTrade(trade({ pnl: -640 })).pnl).toBe(-640);
  });

  it('colours by the entered money, not the price move', () => {
    expect(computeTrade(trade({ pnl: -640 })).isProfit).toBe(false);
  });

  it('is independent of position size — the percentage comes from prices alone', () => {
    const small = computeTrade(trade({ pnl: 12 }));
    const large = computeTrade(trade({ pnl: 12000 }));
    expect(small.roiPct).toBeCloseTo(large.roiPct);
  });

  it('still reports the money when the prices cannot give a percentage', () => {
    const result = computeTrade(trade({ entryPrice: 0, pnl: 250 }));
    expect(result.degenerate).toBe(true);
    expect(result.roiPct).toBe(0);
    expect(result.pnl).toBe(250);
  });

  it('survives NaN input', () => {
    expect(computeTrade(trade({ exitPrice: Number.NaN })).degenerate).toBe(true);
    expect(computeTrade(trade({ pnl: Number.NaN })).pnl).toBe(0);
  });
});

describe('signsDisagree', () => {
  it('is quiet when the money matches the price move', () => {
    expect(signsDisagree(trade({ pnl: 20 }))).toBe(false);
    expect(signsDisagree(trade({ direction: 'short', pnl: -20 }))).toBe(false);
  });

  it('flags a profit entered on a losing move', () => {
    expect(signsDisagree(trade({ direction: 'short', pnl: 20 }))).toBe(true);
  });

  it('stays quiet on zero or unusable input', () => {
    expect(signsDisagree(trade({ pnl: 0 }))).toBe(false);
    expect(signsDisagree(trade({ entryPrice: 0 }))).toBe(false);
    expect(signsDisagree(trade({ exitPrice: 100 }))).toBe(false);
  });
});

describe('computePeriod', () => {
  it('returns the balance delta and its percentage', () => {
    const result = computePeriod(period());
    expect(result.pnl).toBeCloseTo(10120);
    expect(result.roiPct).toBeCloseTo(94.76, 1);
    expect(result.isProfit).toBe(true);
  });

  it('handles a losing period', () => {
    const result = computePeriod(period({ startBalance: 20000, endBalance: 12000 }));
    expect(result.pnl).toBeCloseTo(-8000);
    expect(result.roiPct).toBeCloseTo(-40);
    expect(result.isProfit).toBe(false);
  });

  it('flags a zero start balance', () => {
    expect(computePeriod(period({ startBalance: 0 })).degenerate).toBe(true);
  });
});

describe('approximateLiquidationPrice', () => {
  it('sits below entry for longs and above for shorts', () => {
    expect(approximateLiquidationPrice(trade({ leverage: 10 }))).toBeCloseTo(90);
    expect(approximateLiquidationPrice(trade({ leverage: 10, direction: 'short' }))).toBeCloseTo(110);
  });

  it('is undefined without leverage', () => {
    expect(approximateLiquidationPrice(trade({ leverage: 1 }))).toBeNull();
  });
});

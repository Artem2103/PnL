import type { CardState, PeriodState, TradeState } from '../types';

export interface PnlResult {
  /** Profit or loss in quote currency. */
  pnl: number;
  /** Percentage shown on the first row. */
  roiPct: number;
  isProfit: boolean;
  /** Inputs are insufficient to compute a percentage. */
  degenerate: boolean;
}

const EPSILON = 1e-12;

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Price move, signed by direction. Long 10% up => 0.1; short 10% up => -0.1.
 * Returns null when the prices cannot produce one.
 */
export function priceMove(trade: TradeState): number | null {
  const { entryPrice: entry, exitPrice: exit } = trade;
  if (!isFiniteNumber(entry) || !isFiniteNumber(exit) || Math.abs(entry) < EPSILON) return null;
  const raw = (exit - entry) / entry;
  return trade.direction === 'long' ? raw : -raw;
}

/**
 * The money is taken as entered; the percentage is return on margin,
 * `move * leverage`, which holds whatever the position size was.
 */
export function computeTrade(trade: TradeState): PnlResult {
  const pnl = isFiniteNumber(trade.pnl) ? trade.pnl : 0;
  const leverage = Math.max(1, isFiniteNumber(trade.leverage) ? trade.leverage : 1);
  const move = priceMove(trade);

  return {
    pnl,
    roiPct: move === null ? 0 : move * leverage * 100,
    // The headline is the money, so that is what sets the colour.
    isProfit: pnl >= 0,
    degenerate: move === null,
  };
}

/**
 * True when the entered profit contradicts what the prices imply — worth
 * surfacing in the editor, but never silently "corrected".
 */
export function signsDisagree(trade: TradeState): boolean {
  const move = priceMove(trade);
  if (move === null || !isFiniteNumber(trade.pnl)) return false;
  if (move === 0 || trade.pnl === 0) return false;
  return move > 0 !== trade.pnl > 0;
}

/** Period mode: the percentage is the return on the starting balance. */
export function computePeriod(period: PeriodState): PnlResult {
  const { startBalance: start, endBalance: end } = period;
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || Math.abs(start) < EPSILON) {
    return { pnl: 0, roiPct: 0, isProfit: true, degenerate: true };
  }
  const pnl = end - start;
  return {
    pnl,
    roiPct: (pnl / Math.abs(start)) * 100,
    isProfit: pnl >= 0,
    degenerate: false,
  };
}

export function computeCard(state: CardState): PnlResult {
  return state.mode === 'trade' ? computeTrade(state.trade) : computePeriod(state.period);
}

/** Liquidation price for an isolated-margin position, ignoring fees and maintenance margin. */
export function approximateLiquidationPrice(trade: TradeState): number | null {
  const { entryPrice, leverage, direction } = trade;
  if (!isFiniteNumber(entryPrice) || entryPrice <= 0) return null;
  const lev = Math.max(1, leverage);
  if (lev <= 1) return null;
  return direction === 'long' ? entryPrice * (1 - 1 / lev) : entryPrice * (1 + 1 / lev);
}

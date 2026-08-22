import type { CardState } from '../types';
import type { PnlResult } from './pnl';
import {
  formatCompactMoney,
  formatMoney,
  formatPrice,
  formatSmartPercent,
} from './format';

export interface CardRow {
  label: string;
  value: string;
  /** Printed in the theme accent, like the percentage on the reference card. */
  accent: boolean;
}

export interface CardContent {
  title: string;
  /** The big value inside the accent block. */
  hero: string;
  rows: CardRow[];
}

/**
 * Turns card state into the exact strings the renderer prints. Both modes
 * produce the same shape — one title, one hero value, three rows — because the
 * layout is fixed.
 */
export function buildContent(state: CardState, result: PnlResult): CardContent {
  const { brand, display } = state;
  const hero = display.compactHero
    ? formatCompactMoney(result.pnl, brand.currency)
    : formatMoney(result.pnl, brand.currency);

  const pnlRow: CardRow = {
    label: 'PNL',
    value: formatSmartPercent(result.roiPct),
    accent: true,
  };

  if (state.mode === 'period') {
    return {
      title: state.period.title,
      hero,
      rows: [
        pnlRow,
        {
          label: 'Start Balance',
          value: formatCompactMoney(state.period.startBalance, brand.currency, false),
          accent: false,
        },
        {
          label: 'End Balance',
          value: formatCompactMoney(state.period.endBalance, brand.currency, false),
          accent: false,
        },
      ],
    };
  }

  const { trade } = state;
  const symbol = trade.symbol.trim().toUpperCase();
  const leverage = Number.isInteger(trade.leverage)
    ? String(trade.leverage)
    : trade.leverage.toFixed(1);
  const side = trade.direction === 'long' ? 'Long' : 'Short';
  const suffix = trade.leverage > 1 ? `${side} ${leverage}×` : side;

  return {
    title: trade.showDirectionInTitle && symbol ? `${symbol}  ${suffix}` : symbol,
    hero,
    rows: [
      pnlRow,
      { label: 'Entry Price', value: formatPrice(trade.entryPrice), accent: false },
      { label: 'Exit Price', value: formatPrice(trade.exitPrice), accent: false },
    ],
  };
}

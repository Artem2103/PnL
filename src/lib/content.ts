import type { CardState } from '../types';
import type { PnlResult } from './pnl';
import {
  formatCompactMoney,
  formatMoney,
  formatPrice,
  formatSmartPercent,
} from './format';

/**
 * The footer's right-hand string, on every card, always.
 *
 * It is a constant rather than a field of `BrandState` on purpose: the editor
 * has no input for it, nothing in the app writes it, and an old save or a
 * hand-edited `cards` row cannot carry a different one, because there is no
 * longer a key for it to be carried in. Changing what the card says here is a
 * change to this line and a redeploy.
 */
export const FOOTER_SECONDARY = 'Save 10% off fees';

/**
 * The three periods the card is usually made for. They fill the title field
 * rather than replacing it — a month ("August 2026", which is what the
 * reference card says) still has to be typeable.
 */
export const PERIOD_PRESETS: readonly string[] = ['1D Realized', '7D Realized', '30D Realized'];

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

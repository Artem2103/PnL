import { describe, expect, it } from 'vitest';
import { buildContent } from './content';
import { createDefaultState, hydrateState } from './defaults';
import { computeCard } from './pnl';
import type { CardState } from '../types';

function render(state: CardState) {
  return buildContent(state, computeCard(state));
}

describe('buildContent', () => {
  it('reproduces the reference card exactly from its balances', () => {
    const base = createDefaultState();
    const content = render({
      ...base,
      period: { ...base.period, startBalance: 10680, endBalance: 20800 },
    });
    expect(content.title).toBe('August 2026');
    expect(content.hero).toBe('+$10.1K');
    expect(content.rows.map((row) => [row.label, row.value])).toEqual([
      ['PNL', '+95%'],
      ['Start Balance', '$10.7K'],
      ['End Balance', '$20.8K'],
    ]);
    expect(content.rows[0]?.accent).toBe(true);
    expect(content.rows[1]?.accent).toBe(false);
  });

  it('starts a new trade as EURUSD at 1 to 1, titled without leverage', () => {
    const state = { ...createDefaultState(), mode: 'trade' as const };
    const content = render(state);
    expect(content.title).toBe('EURUSD  Long');
    expect(content.rows.map((row) => row.label)).toEqual(['PNL', 'Entry Price', 'Exit Price']);
    expect(content.rows[1]?.value).toBe('1.00');
    expect(content.rows[2]?.value).toBe('1.00');
  });

  it('works the percentage out at 100x, and never prints it', () => {
    const base = createDefaultState();
    // A 1% move at 100x is +100%.
    const state: CardState = {
      ...base,
      mode: 'trade',
      trade: { ...base.trade, exitPrice: 1.01, pnl: 250 },
    };
    const content = render(state);
    expect(content.rows[0]?.value).toBe('+100%');
    expect(content.title).not.toContain('×');
  });

  it('opens an old card saved at 20x at 100x', () => {
    const saved = { mode: 'trade', trade: { symbol: 'BTCUSDT', leverage: 20 } };
    const state = hydrateState(saved);
    expect(state.trade.leverage).toBe(100);
    expect(render(state).title).toBe('BTCUSDT  Long');
  });

  it('omits the suffix when the title toggle is off', () => {
    const base = createDefaultState();
    const state: CardState = {
      ...base,
      mode: 'trade',
      trade: { ...base.trade, showDirectionInTitle: false },
    };
    expect(render(state).title).toBe('EURUSD');
  });

  it('reads negative on a losing trade', () => {
    const base = createDefaultState();
    const state: CardState = {
      ...base,
      mode: 'trade',
      trade: { ...base.trade, exitPrice: 0.99, pnl: -4700 },
    };
    const content = render(state);
    expect(content.hero.startsWith('-')).toBe(true);
    expect(content.rows[0]?.value.startsWith('-')).toBe(true);
  });

  it('prints the entered profit as the hero value', () => {
    const base = createDefaultState();
    const state: CardState = {
      ...base,
      mode: 'trade',
      trade: { ...base.trade, pnl: 12400 },
    };
    expect(render(state).hero).toBe('+$12.4K');
  });

  it('uses the full amount when compact is off', () => {
    const base = createDefaultState();
    const state: CardState = {
      ...base,
      period: { ...base.period, startBalance: 10680, endBalance: 20800 },
      display: { ...base.display, compactHero: false },
    };
    expect(render(state).hero).toBe('+$10,120.00');
  });
});

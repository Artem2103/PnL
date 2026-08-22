import { describe, expect, it } from 'vitest';
import { buildContent } from './content';
import { createDefaultState } from './defaults';
import { computeCard } from './pnl';
import type { CardState } from '../types';

function render(state: CardState) {
  return buildContent(state, computeCard(state));
}

describe('buildContent', () => {
  it('reproduces the reference card exactly from the defaults', () => {
    const content = render(createDefaultState());
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

  it('builds a trade title with direction and leverage', () => {
    const state = { ...createDefaultState(), mode: 'trade' as const };
    const content = render(state);
    expect(content.title).toBe('BTCUSDT  Long 20×');
    expect(content.rows.map((row) => row.label)).toEqual(['PNL', 'Entry Price', 'Exit Price']);
    expect(content.rows[1]?.value).toBe('61,250.00');
  });

  it('omits the suffix when the title toggle is off', () => {
    const base = createDefaultState();
    const state: CardState = {
      ...base,
      mode: 'trade',
      trade: { ...base.trade, showDirectionInTitle: false },
    };
    expect(render(state).title).toBe('BTCUSDT');
  });

  it('reads negative on a losing trade', () => {
    const base = createDefaultState();
    const state: CardState = {
      ...base,
      mode: 'trade',
      trade: { ...base.trade, exitPrice: 55000, pnl: -4700 },
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
    const state: CardState = { ...base, display: { ...base.display, compactHero: false } };
    expect(render(state).hero).toBe('+$10,120.00');
  });
});

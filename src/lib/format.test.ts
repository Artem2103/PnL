import { describe, expect, it } from 'vitest';
import {
  formatCompactMoney,
  formatMoney,
  formatPercent,
  formatPrice,
  formatSmartPercent,
  slugify,
} from './format';

describe('formatPrice', () => {
  it('groups thousands and keeps two decimals', () => {
    expect(formatPrice(68420.5)).toBe('68,420.50');
  });

  it('gives sub-dollar prices more precision', () => {
    expect(formatPrice(0.5821)).toBe('0.5821');
    expect(formatPrice(0.00001234)).toBe('0.00001234');
  });

  it('keeps every decimal the trader entered', () => {
    // Forex is quoted to five decimals; rounding to four loses a pip.
    expect(formatPrice(1.16944)).toBe('1.16944');
    expect(formatPrice(1.1715)).toBe('1.1715');
    expect(formatPrice(146.7382)).toBe('146.7382');
  });

  it('handles junk input', () => {
    expect(formatPrice(Number.NaN)).toBe('—');
  });
});

describe('formatMoney', () => {
  it('signs the value and uses the currency symbol', () => {
    expect(formatMoney(1234.5, 'USDT')).toBe('+$1,234.50');
    expect(formatMoney(-1234.5, 'USD')).toBe('-$1,234.50');
  });

  it('falls back to a currency code when there is no symbol', () => {
    expect(formatMoney(10, 'SOL')).toBe('+10.00 SOL');
  });
});

describe('formatCompactMoney', () => {
  it('prints the reference card values', () => {
    expect(formatCompactMoney(10120, 'USD')).toBe('+$10.1K');
    expect(formatCompactMoney(10680, 'USD', false)).toBe('$10.7K');
    expect(formatCompactMoney(20800, 'USD', false)).toBe('$20.8K');
  });

  it('drops a trailing .0', () => {
    expect(formatCompactMoney(20000, 'USD', false)).toBe('$20K');
  });

  it('scales to millions and billions', () => {
    expect(formatCompactMoney(1250000, 'USD')).toBe('+$1.3M');
    expect(formatCompactMoney(-2400000000, 'USD')).toBe('-$2.4B');
  });

  it('stays plain below a thousand', () => {
    expect(formatCompactMoney(842.5, 'USD')).toBe('+$842.50');
    expect(formatCompactMoney(300, 'USD', false)).toBe('$300');
  });
});

describe('formatSmartPercent', () => {
  it('rounds to whole numbers once the value is large', () => {
    expect(formatSmartPercent(94.76)).toBe('+95%');
    expect(formatSmartPercent(-40)).toBe('-40%');
  });

  it('keeps precision on small moves', () => {
    expect(formatSmartPercent(4.28)).toBe('+4.3%');
    expect(formatSmartPercent(0.42)).toBe('+0.42%');
  });
});

describe('formatPercent', () => {
  it('always carries an explicit sign', () => {
    expect(formatPercent(12.345)).toBe('+12.35%');
    expect(formatPercent(-8)).toBe('-8.00%');
  });
});

describe('slugify', () => {
  it('produces a filename-safe slug', () => {
    expect(slugify('BTC/USDT')).toBe('btc-usdt');
    expect(slugify('!!!', 'pnl')).toBe('pnl');
  });
});

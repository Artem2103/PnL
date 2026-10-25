/**
 * Thirty demo trades spread over the last two months, for checking the
 * journal with data in it. Seeded, so every load produces the same set
 * relative to today.
 */

import type { TradeInput } from './types';

interface Instrument {
  symbol: string;
  price: number;
  /** Typical move per trade, in price. */
  move: number;
  /** Account currency per 1.0 price unit per lot. */
  valuePerLot: number;
  digits: number;
}

const INSTRUMENTS: readonly Instrument[] = [
  { symbol: 'EURUSD', price: 1.085, move: 0.0035, valuePerLot: 100_000, digits: 5 },
  { symbol: 'GBPUSD', price: 1.27, move: 0.004, valuePerLot: 100_000, digits: 5 },
  { symbol: 'USDJPY', price: 151.2, move: 0.45, valuePerLot: 660, digits: 3 },
  { symbol: 'XAUUSD', price: 2650, move: 6, valuePerLot: 100, digits: 2 },
  { symbol: 'NAS100', price: 20150, move: 60, valuePerLot: 5, digits: 1 },
  { symbol: 'US30', price: 42300, move: 140, valuePerLot: 5, digits: 1 },
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function demoTrades(now: Date = new Date(), count = 30): TradeInput[] {
  const random = rng(20261025);
  const out: TradeInput[] = [];
  const span = 60; // days
  for (let i = 0; i < count; i++) {
    const instrument = INSTRUMENTS[Math.floor(random() * INSTRUMENTS.length)] ?? INSTRUMENTS[0]!;
    const daysAgo = Math.floor(((count - i) / count) * span * (0.85 + random() * 0.15));
    const opened = new Date(now);
    opened.setDate(opened.getDate() - daysAgo);
    // Trading hours, mostly London and New York.
    opened.setHours(7 + Math.floor(random() * 11), Math.floor(random() * 60), 0, 0);
    // Weekends are closed.
    while (opened.getDay() === 0 || opened.getDay() === 6) opened.setDate(opened.getDate() - 1);
    const closed = new Date(opened.getTime() + (10 + random() * 300) * 60_000);
    if (closed > now) continue;

    const side = random() < 0.55 ? 'buy' : 'sell';
    const win = random() < 0.56;
    const lots = [0.1, 0.1, 0.2, 0.25, 0.3, 0.5, 0.5][Math.floor(random() * 7)] ?? 0.5;
    const size = instrument.move * (0.4 + random() * 1.4) * (win ? 1.15 : 1);
    const entry = instrument.price * (0.97 + random() * 0.06);
    const delta = (win ? 1 : -1) * (side === 'buy' ? 1 : -1) * size;
    const close = entry + delta;
    const pnl = (side === 'buy' ? close - entry : entry - close) * lots * instrument.valuePerLot;
    const round = (value: number, digits: number) => Number(value.toFixed(digits));

    out.push({
      source: 'manual',
      externalId: null,
      symbol: instrument.symbol,
      side,
      entryPrice: round(entry, instrument.digits),
      closePrice: round(close, instrument.digits),
      lots,
      pnl: round(pnl, 2),
      openedAt: opened.toISOString(),
      closedAt: closed.toISOString(),
      note: 'Demo trade',
    });
  }
  return out;
}

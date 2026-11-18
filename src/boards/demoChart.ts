/**
 * Stand-in screenshots for the demo board: a white chart with green and black
 * candles, red hand-drawn levels and a take-profit / stop-loss box, the way the
 * community's real TradingView screenshots look. Only for placeholders — a real
 * upload is always shown as the file itself.
 *
 * Deterministic: the same seed draws the same chart, so the board doesn't
 * reshuffle on every visit.
 */

import type { Timeframe } from './model';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZES: [number, number][] = [
  [1290, 860],
  [1290, 860],
  [1290, 855],
  [1600, 900],
  [1290, 860],
  [1200, 900],
];

export function demoSize(seed: number): [number, number] {
  return SIZES[Math.floor(rng(seed * 7 + 3)() * SIZES.length)] ?? [1290, 860];
}

const CANDLES: Record<Timeframe, number> = { '5m': 120, '15m': 86, '1h': 62 };
const UP = '#3fd17a';
const INK = '#111214';
const RED = '#e5484d';
const HAND = "'Segoe Print','Bradley Hand','Comic Sans MS',cursive";

const f = (n: number) => n.toFixed(1);

export function demoChartSvg(seed: number, timeframe: Timeframe): string {
  const [W, H] = demoSize(seed);
  const trade = rng(seed);
  const long = trade() > 0.42;
  const entryAt = 0.66 + trade() * 0.16;
  const symbol = ['GER40', 'NAS100', 'US500', 'XAUUSD', 'EURUSD', 'GBPUSD', 'US30'][Math.floor(trade() * 7)] ?? 'GER40';
  const r = rng(seed * 31 + timeframe.length * 977 + (timeframe === '1h' ? 5 : 0));

  const plotL = 12;
  const plotR = W - 92;
  const plotT = 40;
  const plotB = H - 56;
  const n = CANDLES[timeframe];
  const entry = Math.floor(n * entryAt);
  const vol = timeframe === '1h' ? 2.1 : timeframe === '15m' ? 1.5 : 1.1;

  // A random walk with a little drift and regime change, then a run to target.
  type C = { o: number; h: number; l: number; c: number };
  const candles: C[] = [];
  let price = 100;
  let drift = (r() - 0.5) * 0.6;
  for (let i = 0; i < n; i += 1) {
    if (i % 18 === 0) drift = (r() - 0.5) * 0.8;
    if (i > entry) drift = (long ? 1 : -1) * (0.55 + r() * 0.5);
    const o = price;
    const c = o + drift * vol * 0.6 + (r() - 0.5) * vol * 2.2;
    const h = Math.max(o, c) + r() * vol * 1.1;
    const l = Math.min(o, c) - r() * vol * 1.1;
    candles.push({ o, h, l, c });
    price = c;
  }

  const entryPrice = candles[entry]?.c ?? 100;
  const risk = vol * (2.2 + r() * 1.6);
  const stop = long ? entryPrice - risk : entryPrice + risk;
  const target = long ? entryPrice + risk * (2.2 + r() * 1.8) : entryPrice - risk * (2.2 + r() * 1.8);

  let lo = Math.min(stop, target);
  let hi = Math.max(stop, target);
  for (const k of candles) {
    lo = Math.min(lo, k.l);
    hi = Math.max(hi, k.h);
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const Y = (p: number) => plotB - ((p - lo) / (hi - lo)) * (plotB - plotT);
  const step = (plotR - plotL - 120) / n;
  const X = (i: number) => plotL + i * step + step / 2;
  const body = Math.max(2, step * 0.62);

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(
    `<text x="14" y="22" font-family="Arial,Helvetica,sans-serif" font-size="13" fill="#3b3d42">${symbol} · ${timeframe.toUpperCase()}</text>`,
  );

  // Price axis.
  const ticks = 9;
  for (let i = 0; i <= ticks; i += 1) {
    const p = lo + ((hi - lo) * i) / ticks;
    parts.push(
      `<text x="${W - 80}" y="${f(Y(p) + 4)}" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#55575d">${(p * 280).toFixed(1)}</text>`,
    );
  }
  // Time axis.
  for (let i = 0; i < 12; i += 1) {
    const hh = String((i * 3 + Math.floor(r() * 2)) % 24).padStart(2, '0');
    parts.push(
      `<text x="${f(plotL + 20 + i * ((plotR - plotL) / 12))}" y="${H - 30}" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="#55575d">${hh}:00</text>`,
    );
  }

  // Take-profit and stop-loss boxes, from the entry candle to the right.
  const boxL = X(entry);
  const boxR = Math.min(plotR - 4, boxL + (plotR - plotL) * 0.17);
  parts.push(
    `<rect x="${f(boxL)}" y="${f(Math.min(Y(entryPrice), Y(target)))}" width="${f(boxR - boxL)}" height="${f(Math.abs(Y(target) - Y(entryPrice)))}" fill="#bff5c4"/>`,
  );
  parts.push(
    `<rect x="${f(boxL)}" y="${f(Math.min(Y(entryPrice), Y(stop)))}" width="${f(boxR - boxL)}" height="${f(Math.abs(Y(stop) - Y(entryPrice)))}" fill="#f9d0d2"/>`,
  );
  parts.push(`<line x1="${f(boxL)}" x2="${f(boxR)}" y1="${f(Y(entryPrice))}" y2="${f(Y(entryPrice))}" stroke="#9a9ca3" stroke-width="1"/>`);
  for (const [p, bg] of [
    [target, '#22e05a'],
    [stop, '#9a9ca3'],
  ] as const) {
    parts.push(`<rect x="${W - 84}" y="${f(Y(p) - 9)}" width="74" height="18" fill="${bg}"/>`);
    parts.push(
      `<text x="${W - 80}" y="${f(Y(p) + 4)}" font-family="Arial,Helvetica,sans-serif" font-size="12" fill="${bg === '#22e05a' ? INK : '#fff'}">${(p * 280).toFixed(1)}</text>`,
    );
  }

  // Candles.
  const wicks: string[] = [];
  const ups: string[] = [];
  const downs: string[] = [];
  candles.forEach((k, i) => {
    const x = X(i);
    wicks.push(`M${f(x)} ${f(Y(k.h))}V${f(Y(k.l))}`);
    const top = Y(Math.max(k.o, k.c));
    const h = Math.max(1, Math.abs(Y(k.o) - Y(k.c)));
    const rect = `<rect x="${f(x - body / 2)}" y="${f(top)}" width="${f(body)}" height="${f(h)}"/>`;
    (k.c >= k.o ? ups : downs).push(rect);
  });
  parts.push(`<path d="${wicks.join('')}" stroke="${INK}" stroke-width="1.2"/>`);
  parts.push(`<g fill="${UP}" stroke="${INK}" stroke-width="1">${ups.join('')}</g>`);
  parts.push(`<g fill="${INK}">${downs.join('')}</g>`);

  // Hand-drawn levels: a swing high or low the trade reacted to.
  const wobble = () => (r() - 0.5) * 6;
  const levels = 1 + Math.floor(r() * 2.4);
  for (let i = 0; i < levels; i += 1) {
    const a = Math.floor(r() * entry * 0.7);
    const b = Math.min(entry + 2, a + 14 + Math.floor(r() * 30));
    const ref = candles[a];
    if (!ref) continue;
    const p = (i + (long ? 0 : 1)) % 2 === 0 ? ref.l : ref.h;
    const y = Y(p);
    parts.push(
      `<path d="M${f(X(a))} ${f(y + wobble())} Q${f((X(a) + X(b)) / 2)} ${f(y + wobble() * 1.4)} ${f(X(b))} ${f(y + wobble())}" stroke="${RED}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    );
  }

  // A freehand stroke and a note, like the ones people scribble on their charts.
  if (r() > 0.35) {
    const a = Math.floor(n * (0.1 + r() * 0.3));
    const ref = candles[a];
    if (ref) {
      const sx = X(a);
      const sy = Y(long ? ref.l : ref.h) + (long ? 40 : -40);
      const pts = Array.from({ length: 6 }, (_, j) => `${f(sx + j * 26 + wobble())} ${f(sy - (long ? 1 : -1) * j * 18 + wobble() * 2)}`);
      parts.push(`<path d="M${pts.join(' L')}" stroke="${RED}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  const mark = ['1', '2', '3', 'BOS', 'SMT', 'FVG', 'OB'][Math.floor(r() * 7)] ?? '1';
  const mx = X(Math.max(0, entry - 6 - Math.floor(r() * 10)));
  const my = Y(stop) + (long ? 46 : -30);
  parts.push(
    `<text x="${f(mx)}" y="${f(Math.min(plotB - 6, Math.max(plotT + 30, my)))}" font-family="${HAND}" font-size="34" fill="${RED}">${mark}</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

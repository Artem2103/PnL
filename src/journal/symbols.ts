/**
 * Instrument logos and how symbols are written.
 *
 * Logos are files in `/logos` named after the symbol — `EURUSD.png`,
 * `NAS100.svg`. Vite lists the folder at build time, so dropping a file in and
 * rebuilding is the whole process of adding one.
 */

const files = import.meta.glob('/logos/*.{png,svg,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const LOGOS: ReadonlyMap<string, string> = new Map(
  Object.entries(files).map(([path, url]) => [
    normalizeSymbol(path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''),
    url,
  ]),
);

/** Upper case with separators dropped: "eur/usd" → "EURUSD". */
export function normalizeSymbol(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

/** Codes that make a six-letter symbol read as a pair. */
const CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'SEK', 'NOK', 'DKK', 'PLN', 'HUF',
  'CZK', 'TRY', 'ZAR', 'MXN', 'SGD', 'HKD', 'CNH', 'XAU', 'XAG', 'XPT', 'XPD', 'BTC', 'ETH',
]);

/** "EURUSD" → "EUR/USD", "XAUUSD" → "XAU/USD"; anything else as is. */
export function displaySymbol(symbol: string): string {
  const s = normalizeSymbol(symbol);
  if (s.length === 6 && CODES.has(s.slice(0, 3)) && CODES.has(s.slice(3))) {
    return `${s.slice(0, 3)}/${s.slice(3)}`;
  }
  return s;
}

/** What the badge says when there is no logo: up to three leading letters. */
export function symbolInitials(symbol: string): string {
  const s = normalizeSymbol(symbol);
  return (s.match(/^[A-Z]+/)?.[0] ?? s).slice(0, 3) || '?';
}

/** Suggestions for the pair picker: every logo, then the common majors. */
export const SYMBOL_SUGGESTIONS: readonly string[] = [
  ...new Set([
    ...LOGOS.keys(),
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURJPY', 'GBPJPY',
    'EURGBP', 'XAUUSD', 'XAGUSD', 'NAS100', 'US30', 'SPX500', 'GER40', 'BTCUSD', 'ETHUSD', 'USOIL',
  ]),
].sort();

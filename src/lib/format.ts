const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  USDT: '$',
  USDC: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

export function currencySymbol(currency: string): string {
  const key = currency.trim().toUpperCase();
  return CURRENCY_SYMBOLS[key] ?? '';
}

function group(value: string): string {
  const [intPart = '', fracPart] = value.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${grouped}.${fracPart}` : grouped;
}

/** Decimal places actually present in the entered value, capped at `limit`. */
function enteredDecimals(value: number, limit: number): number {
  const text = String(value);
  // Exponential notation means the value is far smaller than the cap anyway.
  if (text.includes('e') || text.includes('E')) return limit;
  const fraction = text.split('.')[1];
  return fraction ? Math.min(fraction.length, limit) : 0;
}

/**
 * Prices span nine orders of magnitude, so decimals adapt:
 * 68,420.50 · 3,120.44 · 0.5821 · 0.00001234
 *
 * The tier is a floor, never a ceiling: a forex price entered as 1.16944 keeps
 * its fifth decimal rather than being rounded to 1.1694 on the card.
 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let decimals: number;
  if (abs === 0) decimals = 2;
  else if (abs >= 1000) decimals = 2;
  else if (abs >= 100) decimals = 2;
  else if (abs >= 1) decimals = 4;
  else if (abs >= 0.01) decimals = 5;
  else decimals = 8;

  decimals = Math.max(decimals, enteredDecimals(abs, 8));

  const fixed = abs.toFixed(decimals);
  // Trim trailing zeros but always keep at least two decimals for readable prices.
  const trimmed = decimals > 2 ? fixed.replace(/(\.\d{2}\d*?)0+$/, '$1') : fixed;
  return `${value < 0 ? '-' : ''}${group(trimmed)}`;
}

export function formatMoney(value: number, currency: string, withSign = true): string {
  if (!Number.isFinite(value)) return '—';
  const symbol = currencySymbol(currency);
  const abs = Math.abs(value);
  const decimals = abs >= 100000 ? 0 : 2;
  const body = group(abs.toFixed(decimals));
  const sign = withSign ? (value < 0 ? '-' : '+') : value < 0 ? '-' : '';
  const suffix = symbol ? '' : ` ${currency.trim().toUpperCase()}`;
  return `${sign}${symbol}${body}${suffix}`;
}

export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '+';
  const abs = Math.abs(value);
  // Four-digit ROIs are common with leverage; drop decimals so they still fit.
  const d = abs >= 1000 ? Math.min(decimals, 1) : decimals;
  return `${sign}${group(abs.toFixed(d))}%`;
}

/**
 * Percentage the way the reference cards print it: whole numbers once the
 * value is big enough to not need the precision (94.4% -> "+95%"), more
 * decimals only where dropping them would round the number away.
 */
export function formatSmartPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
  return formatPercent(value, decimals);
}

function trimZeroDecimal(value: string): string {
  return value.replace(/\.0$/, '');
}

/**
 * Compact money, as printed on the reference cards: "$10.1K", "$20.8K".
 * Falls back to plain grouped digits below a thousand.
 */
export function formatCompactMoney(value: number, currency: string, withSign = true): string {
  if (!Number.isFinite(value)) return '—';
  const symbol = currencySymbol(currency);
  const suffix = symbol ? '' : ` ${currency.trim().toUpperCase()}`;
  const sign = value < 0 ? '-' : withSign ? '+' : '';
  const abs = Math.abs(value);

  let body: string;
  if (abs >= 1e9) body = `${trimZeroDecimal((abs / 1e9).toFixed(1))}B`;
  else if (abs >= 1e6) body = `${trimZeroDecimal((abs / 1e6).toFixed(1))}M`;
  else if (abs >= 1e3) body = `${trimZeroDecimal((abs / 1e3).toFixed(1))}K`;
  else body = group(abs.toFixed(abs % 1 === 0 ? 0 : 2));

  return `${sign}${symbol}${body}${suffix}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "22 Aug 2026 · 14:05" in the viewer's local time. */
export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()] ?? '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${date.getFullYear()} · ${hours}:${minutes}`;
}

/** Value for <input type="datetime-local">, which wants local time without a zone. */
export function toDateTimeLocalValue(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** Filename-safe slug for downloads. */
export function slugify(value: string, fallback = 'pnl'): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

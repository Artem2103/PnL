import { formatCompactMoney, formatMoney } from '../../lib/format';

/** Sign class for a money value: profit, loss, or neither. */
export function tone(value: number): string {
  return value > 0 ? 'is-up' : value < 0 ? 'is-down' : '';
}

/** "+$1,234.50" / "-$12.00" — exact, for rows and the table. */
export const money = (value: number, currency: string, sign = true) => formatMoney(value, currency, sign);

/** "+$1.2K" — for calendar cells and tight spots. */
export const compact = (value: number, currency: string, sign = true) =>
  formatCompactMoney(value, currency, sign);

/** "+1.25%". */
export function pct(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(decimals)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 21, 14:05". */
export function shortDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function monthLabel(year: number, month: number, long = false): string {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: long ? 'long' : 'short',
    year: 'numeric',
  });
}

import type { CardState } from '../types';
import { supabase } from './supabase';

/**
 * Plans, the free-card limit and promo codes, as the browser sees them.
 *
 * None of this is the enforcement. The limit is counted and decided by
 * `claim_export` in the database, a plan is granted only by the payment
 * webhook or `redeem_promo`, and the codes never reach the bundle. What lives
 * here is the display copy of the prices and the calls that ask.
 *
 * With accounts off (local mode) there is nothing to ask, and every export is
 * allowed: there is no account to hold a plan.
 */

export type PlanId = 'monthly' | 'quarterly';

export interface Plan {
  id: PlanId;
  label: string;
  /** USD for the whole period. Must match `billing_plans` in the schema. */
  price: number;
  months: number;
}

export const PLANS: readonly Plan[] = [
  { id: 'monthly', label: 'Monthly', price: 5.99, months: 1 },
  { id: 'quarterly', label: '3 months', price: 12.99, months: 3 },
];

/** Must match `free_cards_per_month()` in the schema. */
export const FREE_CARDS_PER_MONTH = 1;

/**
 * Whether the payment page can take cards, Apple Pay and Google Pay as well as
 * crypto. That is a switch in the NOWPayments dashboard (fiat payments, which
 * needs its verification), so the page only says so once it is on.
 */
export const CARD_PAYMENTS = import.meta.env.VITE_CARD_PAYMENTS === 'on';

export function monthlyPrice(plan: Plan): number {
  return plan.price / plan.months;
}

/** Whole percent saved against paying monthly for the same time. */
export function savingPercent(plan: Plan, plans: readonly Plan[] = PLANS): number {
  const monthly = plans.find((candidate) => candidate.months === 1);
  if (!monthly || plan.months <= 1) return 0;
  return Math.round((1 - plan.price / (monthly.price * plan.months)) * 100);
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// ------------------------------------------------------------- card identity

/** JSON with every object's keys sorted, so equal values give equal strings. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * What makes a card a *different* card for the free limit: what it says — the
 * trade or the period, and whose name is on it. Colour, text tone, frames,
 * background and its placement are left out, so a free card can be restyled
 * and exported again as often as wanted; a different result is a new card.
 */
export function cardIdentity(state: CardState): unknown {
  return {
    mode: state.mode,
    numbers: state.mode === 'trade' ? state.trade : state.period,
    brand: state.brand,
  };
}

export async function cardKey(state: CardState): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(cardIdentity(state)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- plan status

export interface PlanStatus {
  paidUntil: Date | null;
  isPaid: boolean;
  freeLimit: number;
  /** Different cards exported on the free plan this calendar month (UTC). */
  freeUsed: number;
  /** Their keys: exporting one of these again costs nothing. */
  freeCards: string[];
  /** When the free allowance starts again. */
  resetsAt: Date;
}

export function parsePlanStatus(raw: unknown): PlanStatus {
  const record = (raw ?? {}) as Record<string, unknown>;
  const date = (value: unknown) => (typeof value === 'string' ? new Date(value) : null);
  return {
    paidUntil: date(record.paid_until),
    isPaid: record.is_paid === true,
    freeLimit: typeof record.free_limit === 'number' ? record.free_limit : FREE_CARDS_PER_MONTH,
    freeUsed: typeof record.free_used === 'number' ? record.free_used : 0,
    freeCards: Array.isArray(record.free_cards)
      ? record.free_cards.filter((key): key is string => typeof key === 'string')
      : [],
    resetsAt: date(record.resets_at) ?? nextMonthUtc(new Date()),
  };
}

export function nextMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** What a free account may still do with this particular card. */
export type Allowance = 'paid' | 'this-card-covered' | 'free-left' | 'used-up';

export function allowanceFor(status: PlanStatus, key: string | null): Allowance {
  if (status.isPaid) return 'paid';
  if (key && status.freeCards.includes(key)) return 'this-card-covered';
  return status.freeUsed < status.freeLimit ? 'free-left' : 'used-up';
}

/**
 * "1 Oct 2026". Fixed to English, because it sits inside English sentences (a
 * Russian-language browser gave "1 окт. 2026 г.."), and to UTC, because the
 * month resets at midnight UTC — local time put it on 30 Sep west of London.
 */
export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The database answers "function not found" until `schema.sql` has been run
 * again with the billing section. That one case lets exports through, so a
 * deploy that lands before the SQL does not lock every account out; the
 * account cannot cause it. Any other failure blocks the export.
 */
export function isBillingNotInstalled(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

export class BillingError extends Error {}

export async function fetchPlanStatus(): Promise<PlanStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('plan_status');
  if (error) {
    if (isBillingNotInstalled(error)) return null;
    throw new BillingError(`Could not load your plan: ${error.message}`);
  }
  return parsePlanStatus(data);
}

export type ExportFormat = 'png' | 'mp4' | 'copy' | 'share';

export type ExportDecision =
  | { allowed: true; status: PlanStatus | null }
  | { allowed: false; status: PlanStatus };

/**
 * Asks the database whether this export may go ahead, and records it if so.
 * Called before the render starts, so a refused export costs no rendering.
 */
export async function claimExport(state: CardState, format: ExportFormat): Promise<ExportDecision> {
  if (!supabase) return { allowed: true, status: null };
  const key = await cardKey(state);
  const { data, error } = await supabase.rpc('claim_export', { p_card_key: key, p_format: format });
  if (error) {
    if (isBillingNotInstalled(error)) {
      console.warn('Billing is not installed in the database yet; exports are not being counted.');
      return { allowed: true, status: null };
    }
    throw new BillingError(`Could not check your plan, so the export did not start: ${error.message}`);
  }
  const status = parsePlanStatus(data);
  return (data as { allowed?: unknown } | null)?.allowed === true
    ? { allowed: true, status }
    : { allowed: false, status };
}

// ------------------------------------------------------------------ promo

export type PromoResult =
  | { ok: true; months: number; paidUntil: Date | null }
  | { ok: false; reason: 'invalid' | 'already_redeemed' | 'used_up' | 'too_many_attempts' | 'error' };

export async function redeemPromo(code: string): Promise<PromoResult> {
  if (!supabase) throw new BillingError('Promo codes need an account.');
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, reason: 'invalid' };
  const { data, error } = await supabase.rpc('redeem_promo', { p_code: trimmed });
  if (error) throw new BillingError(`Could not redeem the code: ${error.message}`);
  const record = (data ?? {}) as Record<string, unknown>;
  if (record.ok === true) {
    return {
      ok: true,
      months: typeof record.months === 'number' ? record.months : 0,
      paidUntil: typeof record.paid_until === 'string' ? new Date(record.paid_until) : null,
    };
  }
  const reason = record.reason;
  return {
    ok: false,
    reason:
      reason === 'invalid' || reason === 'already_redeemed' || reason === 'used_up' || reason === 'too_many_attempts'
        ? reason
        : 'error',
  };
}

export function promoMessage(result: PromoResult): string {
  if (result.ok) {
    const months = `${result.months} month${result.months === 1 ? '' : 's'}`;
    return result.paidUntil
      ? `Code applied: ${months} free. Your plan runs until ${formatDay(result.paidUntil)}.`
      : `Code applied: ${months} free.`;
  }
  switch (result.reason) {
    case 'invalid':
      return 'That code is not valid.';
    case 'already_redeemed':
      return 'This account has already used that code.';
    case 'used_up':
      return 'That code has been used up.';
    case 'too_many_attempts':
      return 'Too many wrong codes. Try again in an hour.';
    case 'error':
      return 'The code could not be applied. Try again.';
  }
}

// ---------------------------------------------------------------- checkout

/** Opens a payment for a plan; resolves to the NOWPayments page to go to. */
export async function startCheckout(plan: PlanId): Promise<string> {
  if (!supabase) throw new BillingError('Plans need an account.');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new BillingError('Sign in first.');

  const response = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan }),
  });
  const body = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!response.ok || !body?.url) {
    throw new BillingError(body?.error ?? 'The payment page could not be opened. Try again.');
  }
  return body.url;
}

export interface PaymentRow {
  id: string;
  plan_id: PlanId;
  status: string;
  credited_at: string | null;
  created_at: string;
}

export async function fetchPayment(id: string): Promise<PaymentRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('payments')
    .select('id, plan_id, status, credited_at, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return data as PaymentRow | null;
}

/** How a payment's status reads on the plans page while it is being confirmed. */
export function paymentMessage(payment: PaymentRow | null): { text: string; done: boolean; failed: boolean } {
  if (!payment) return { text: 'Looking for your payment…', done: false, failed: false };
  if (payment.credited_at) return { text: 'Payment received — your plan is active.', done: true, failed: false };
  switch (payment.status) {
    case 'created':
    case 'invoice':
    case 'waiting':
      return { text: 'Waiting for your payment to arrive…', done: false, failed: false };
    case 'confirming':
    case 'confirmed':
    case 'sending':
      return { text: 'Payment seen — waiting for the network to confirm it. This can take a few minutes.', done: false, failed: false };
    case 'partially_paid':
      return { text: 'Less than the full amount arrived. Contact support with your payment details.', done: true, failed: true };
    case 'amount_mismatch':
      return { text: 'The payment did not match the plan price. Contact support.', done: true, failed: true };
    case 'expired':
      return { text: 'The payment page expired before a payment arrived. Nothing was charged.', done: true, failed: true };
    case 'failed':
    case 'refunded':
    case 'invoice_failed':
      return { text: 'The payment did not go through. Nothing was added to your plan.', done: true, failed: true };
    default:
      return { text: 'Waiting for your payment…', done: false, failed: false };
  }
}

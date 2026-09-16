import { describe, expect, it } from 'vitest';
import {
  PLANS,
  allowanceFor,
  canonicalJson,
  formatDay,
  cardKey,
  isBillingNotInstalled,
  monthlyPrice,
  nextMonthUtc,
  parsePlanStatus,
  paymentMessage,
  promoMessage,
  savingPercent,
  type PaymentRow,
} from './billing';
import { createDefaultState } from './defaults';
import { pageFor } from './route';

describe('plans', () => {
  it('are the two tiers at the agreed prices', () => {
    expect(PLANS.map((plan) => [plan.id, plan.price, plan.months])).toEqual([
      ['monthly', 5.99, 1],
      ['quarterly', 12.99, 3],
    ]);
  });

  it('works out the 3-month plan per month and against paying monthly', () => {
    const quarterly = PLANS.find((plan) => plan.id === 'quarterly')!;
    expect(monthlyPrice(quarterly).toFixed(2)).toBe('4.33');
    // 12.99 against 3 × 5.99 = 17.97.
    expect(savingPercent(quarterly)).toBe(28);
    expect(savingPercent(PLANS[0]!)).toBe(0);
  });
});

describe('card identity', () => {
  it('serialises with sorted keys, so key order never changes the answer', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe(canonicalJson({ a: [{ c: null, d: 2 }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: 'x' })).toBe('{"b":"x"}');
  });

  it('is a 64-character hex SHA-256, stable for the same card', async () => {
    const state = createDefaultState();
    const key = await cardKey(state);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await cardKey(structuredClone(state))).toBe(key);
  });

  it('ignores styling: colour, tone, frame and background are the same card', async () => {
    const state = createDefaultState();
    const restyled = {
      ...state,
      display: { ...state.display, themeId: 'custom', customAccent: '#ff0000', textTone: 'dark' as const },
      artwork: { ...state.artwork, imageId: 'some-clip', zoom: 2, offsetX: 0.4 },
      avatarId: 'avatar',
    };
    expect(await cardKey(restyled)).toBe(await cardKey(state));
  });

  it('treats different numbers, or a different name, as a new card', async () => {
    const state = createDefaultState();
    const base = await cardKey(state);
    expect(await cardKey({ ...state, period: { ...state.period, endBalance: state.period.endBalance + 1 } })).not.toBe(base);
    expect(await cardKey({ ...state, brand: { ...state.brand, handle: '@someone-else' } })).not.toBe(base);
    expect(await cardKey({ ...state, mode: 'trade' })).not.toBe(base);
  });

  it('only counts the numbers of the mode on show', async () => {
    const state = createDefaultState(); // period mode
    expect(await cardKey({ ...state, trade: { ...state.trade, pnl: 123456 } })).toBe(await cardKey(state));
  });
});

describe('plan status', () => {
  it('reads what plan_status returns', () => {
    const status = parsePlanStatus({
      paid_until: null,
      is_paid: false,
      free_limit: 1,
      free_used: 1,
      free_cards: ['a'.repeat(64)],
      resets_at: '2026-10-01T00:00:00+00:00',
    });
    expect(status.isPaid).toBe(false);
    expect(status.freeCards).toEqual(['a'.repeat(64)]);
    expect(status.resetsAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('says what the free plan still allows for a given card', () => {
    const key = 'a'.repeat(64);
    const other = 'b'.repeat(64);
    const fresh = parsePlanStatus({ free_limit: 1, free_used: 0, free_cards: [] });
    const used = parsePlanStatus({ free_limit: 1, free_used: 1, free_cards: [key] });
    expect(allowanceFor(fresh, other)).toBe('free-left');
    expect(allowanceFor(used, key)).toBe('this-card-covered');
    expect(allowanceFor(used, other)).toBe('used-up');
    expect(allowanceFor({ ...used, isPaid: true }, other)).toBe('paid');
  });

  it('writes dates in English and in UTC, whatever the browser language', () => {
    expect(formatDay(new Date('2026-10-01T00:00:00Z'))).toBe('1 Oct 2026');
  });

  it('rolls over on the first of the next month, in UTC', () => {
    expect(nextMonthUtc(new Date('2026-12-31T23:59:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('lets exports through only when the billing SQL is not installed, not on other errors', () => {
    expect(isBillingNotInstalled({ code: 'PGRST202' })).toBe(true);
    expect(isBillingNotInstalled({ code: '42883' })).toBe(true);
    expect(isBillingNotInstalled({ code: '28000' })).toBe(false);
    expect(isBillingNotInstalled({})).toBe(false);
    expect(isBillingNotInstalled(null)).toBe(false);
  });
});

describe('messages', () => {
  it('words each promo outcome', () => {
    expect(promoMessage({ ok: true, months: 3, paidUntil: null })).toBe('Code applied: 3 months free.');
    expect(promoMessage({ ok: false, reason: 'invalid' })).toBe('That code is not valid.');
    expect(promoMessage({ ok: false, reason: 'already_redeemed' })).toContain('already used');
    expect(promoMessage({ ok: false, reason: 'too_many_attempts' })).toContain('hour');
  });

  it('keeps polling a payment until it is credited or has failed', () => {
    const row = (status: string, credited_at: string | null = null): PaymentRow => ({
      id: 'x',
      plan_id: 'monthly',
      status,
      credited_at,
      created_at: '',
    });
    expect(paymentMessage(null).done).toBe(false);
    for (const status of ['invoice', 'waiting', 'confirming', 'confirmed', 'sending']) {
      expect(paymentMessage(row(status)).done).toBe(false);
    }
    expect(paymentMessage(row('finished', '2026-09-17T00:00:00Z'))).toMatchObject({ done: true, failed: false });
    for (const status of ['expired', 'failed', 'partially_paid', 'amount_mismatch']) {
      expect(paymentMessage(row(status))).toMatchObject({ done: true, failed: true });
    }
  });
});

describe('pageFor', () => {
  it('routes /pricing to the plans page and everything else to the studio', () => {
    expect(pageFor('/pricing')).toBe('pricing');
    expect(pageFor('/pricing/')).toBe('pricing');
    expect(pageFor('/')).toBe('studio');
    expect(pageFor('/anything')).toBe('studio');
  });
});

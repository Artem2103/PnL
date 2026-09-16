import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleCheckout, readEnv } from '../../api/checkout';
import { handleIpn, ipnSignature, sortDeep, verifyIpnSignature } from '../../api/nowpayments-ipn';

const SUPABASE = 'https://project.supabase.co';
const ORDER = '6f1c2a4e-8b1d-4e2f-9a3b-0c5d7e9f1a2b';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A fetch that answers from a list of [matcher, response] and records every call. */
function fakeFetch(routes: Array<[(call: Call) => boolean, () => Response]>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const raw = init?.body;
    const call: Call = { method, url, body: typeof raw === 'string' && raw ? JSON.parse(raw) : null };
    calls.push(call);
    const route = routes.find(([match]) => match(call));
    if (!route) return new Response(JSON.stringify({ message: `unrouted ${method} ${url}` }), { status: 404 });
    return route[1]();
  }) as typeof fetch;
  return { impl, calls };
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('IPN signature', () => {
  const secret = 'ipn-secret';

  it('matches the NOWPayments reference algorithm for a flat body', () => {
    const body = { payment_status: 'finished', order_id: ORDER, price_amount: 5.99, payment_id: 123 };
    // Their documented Node example: keys sorted, then HMAC-SHA512, hex.
    const reference = createHmac('sha512', secret)
      .update(JSON.stringify(body, Object.keys(body).sort()))
      .digest('hex');
    expect(ipnSignature(body, secret)).toBe(reference);
    expect(verifyIpnSignature(body, reference, secret)).toBe(true);
  });

  it('sorts nested objects too', () => {
    expect(JSON.stringify(sortDeep({ b: { d: 1, c: 2 }, a: [{ f: 1, e: 2 }] }))).toBe(
      '{"a":[{"e":2,"f":1}],"b":{"c":2,"d":1}}',
    );
  });

  it('refuses a changed body, a wrong secret or no header', () => {
    const body = { payment_status: 'waiting', order_id: ORDER };
    const signature = ipnSignature(body, secret);
    expect(verifyIpnSignature({ ...body, payment_status: 'finished' }, signature, secret)).toBe(false);
    expect(verifyIpnSignature(body, signature, 'other')).toBe(false);
    expect(verifyIpnSignature(body, null, secret)).toBe(false);
    expect(verifyIpnSignature(body, 'short', secret)).toBe(false);
  });
});

describe('IPN handler', () => {
  const env = { supabaseUrl: SUPABASE, serviceRoleKey: 'service', ipnSecret: 'ipn-secret' };
  const ipnRequest = (body: Record<string, unknown>, signature = ipnSignature(body, env.ipnSecret)) =>
    new Request('https://astra.test/api/nowpayments-ipn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nowpayments-sig': signature },
      body: JSON.stringify(body),
    });

  it('answers 401 to a forged call and never touches the database', async () => {
    const { impl, calls } = fakeFetch([]);
    const response = await handleIpn(
      ipnRequest({ order_id: ORDER, payment_status: 'finished' }, 'f'.repeat(128)),
      env,
      impl,
    );
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('hands a signed finished payment to record_payment with its fields', async () => {
    const { impl, calls } = fakeFetch([
      [(call) => call.url.endsWith('/rest/v1/rpc/record_payment'), () => ok({ ok: true, credited: true })],
    ]);
    const response = await handleIpn(
      ipnRequest({
        payment_id: 5077125051,
        payment_status: 'finished',
        order_id: ORDER,
        price_amount: 12.99,
        price_currency: 'usd',
        pay_currency: 'usdttrc20',
        actually_paid: '13.1',
      }),
      env,
      impl,
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      p_payment: ORDER,
      p_payment_id: '5077125051',
      p_status: 'finished',
      p_price_amount: 12.99,
      p_price_currency: 'usd',
      p_pay_currency: 'usdttrc20',
      p_actually_paid: 13.1,
    });
  });

  it('asks for a retry when the database call fails', async () => {
    const { impl } = fakeFetch([
      [(call) => call.url.includes('/rpc/record_payment'), () => ok({ message: 'down' }, 500)],
    ]);
    const response = await handleIpn(ipnRequest({ order_id: ORDER, payment_status: 'finished' }), env, impl);
    expect(response.status).toBe(500);
  });

  it('acknowledges, without recording, a signed call that is not one of our orders', async () => {
    const { impl, calls } = fakeFetch([]);
    const response = await handleIpn(ipnRequest({ order_id: 'not-ours', payment_status: 'finished' }), env, impl);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
  });

  it('is unavailable until its keys are set', async () => {
    const { impl } = fakeFetch([]);
    expect((await handleIpn(ipnRequest({}), null, impl)).status).toBe(503);
  });
});

describe('checkout handler', () => {
  const env = readEnv({
    VITE_SUPABASE_URL: SUPABASE,
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    NOWPAYMENTS_API_KEY: 'np-key',
    SITE_URL: 'https://astra.test/',
  });

  const checkoutRequest = (body: unknown, token: string | null = 'user-jwt') =>
    new Request('https://preview.vercel.app/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  const happyRoutes = (invoice: () => Response): Array<[(call: Call) => boolean, () => Response]> => [
    [(call) => call.url.endsWith('/auth/v1/user'), () => ok({ id: 'user-1', aud: 'authenticated', email: 'a@b.c' })],
    [(call) => call.url.includes('/rest/v1/billing_plans'), () => ok({ id: 'quarterly', label: '3 months', price_usd: 12.99, months: 3 })],
    [(call) => call.method === 'POST' && call.url.includes('/rest/v1/payments'), () => ok({ id: ORDER }, 201)],
    [(call) => call.method === 'PATCH' && call.url.includes('/rest/v1/payments'), () => new Response(null, { status: 204 })],
    [(call) => call.url === 'https://api.nowpayments.io/v1/invoice', invoice],
  ];

  it('reads the Supabase URL from the VITE_ variable Vercel already has', () => {
    expect(env).toMatchObject({ supabaseUrl: SUPABASE, apiBase: 'https://api.nowpayments.io/v1', siteUrl: 'https://astra.test' });
    expect(readEnv({ VITE_SUPABASE_URL: SUPABASE })).toBeNull();
  });

  it('opens an invoice at the price from the database and returns its page', async () => {
    const { impl, calls } = fakeFetch(
      happyRoutes(() => ok({ id: '4522625843', invoice_url: 'https://nowpayments.io/payment/?iid=4522625843' })),
    );
    // The request claims a price; it must be ignored.
    const response = await handleCheckout(checkoutRequest({ plan: 'quarterly', price: 0.01 }), env, impl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://nowpayments.io/payment/?iid=4522625843', paymentId: ORDER });

    const invoice = calls.find((call) => call.url.endsWith('/invoice'))!;
    expect(invoice.body).toEqual({
      price_amount: 12.99,
      price_currency: 'usd',
      order_id: ORDER,
      order_description: 'Astra — 3 months',
      ipn_callback_url: 'https://astra.test/api/nowpayments-ipn',
      success_url: `https://astra.test/pricing?payment=${ORDER}`,
      cancel_url: 'https://astra.test/pricing?cancelled=1',
    });
    const insert = calls.find((call) => call.method === 'POST' && call.url.includes('/rest/v1/payments'))!;
    expect(insert.body).toEqual({ user_id: 'user-1', plan_id: 'quarterly', price_usd: 12.99 });
    const update = calls.find((call) => call.method === 'PATCH')!;
    expect(update.body).toEqual({ status: 'invoice', invoice_id: '4522625843' });
  });

  it('marks the payment failed and answers 502 when NOWPayments refuses', async () => {
    const { impl, calls } = fakeFetch(happyRoutes(() => ok({ message: 'amountTo is too small' }, 400)));
    const response = await handleCheckout(checkoutRequest({ plan: 'monthly' }), env, impl);
    expect(response.status).toBe(502);
    expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({ status: 'invoice_failed' });
  });

  it('refuses no session, a bad session, an unknown plan, and missing keys', async () => {
    const { impl } = fakeFetch([
      [(call) => call.url.endsWith('/auth/v1/user'), () => ok({ message: 'invalid JWT' }, 401)],
    ]);
    expect((await handleCheckout(checkoutRequest({ plan: 'monthly' }, null), env, impl)).status).toBe(401);
    expect((await handleCheckout(checkoutRequest({ plan: 'monthly' }), env, impl)).status).toBe(401);
    expect((await handleCheckout(checkoutRequest({ plan: 'lifetime' }), env, impl)).status).toBe(400);
    expect((await handleCheckout(checkoutRequest({ plan: 'monthly' }), null, impl)).status).toBe(503);
  });
});

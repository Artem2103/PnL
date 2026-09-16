import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/nowpayments-ipn — NOWPayments calls this every time a payment's
 * status changes.
 *
 * The call is trusted only when its `x-nowpayments-sig` header is the
 * HMAC-SHA512 of the body — keys sorted, recursively — under the IPN secret
 * from the NOWPayments dashboard. Anyone can POST here; without the secret they
 * cannot produce that header.
 *
 * Everything else is `record_payment` in the database: it stores the status,
 * and on `finished` grants the plan once, checking the amount against the
 * plan's price. Retries are harmless. Answering non-2xx makes NOWPayments try
 * again later, so that is only done when a retry could help.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function ipnSignature(body: unknown, secret: string): string {
  return createHmac('sha512', secret).update(JSON.stringify(sortDeep(body))).digest('hex');
}

export function verifyIpnSignature(body: unknown, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(ipnSignature(body, secret), 'utf8');
  const given = Buffer.from(header.trim().toLowerCase(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function toNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

export interface IpnEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  ipnSecret: string;
}

export function readIpnEnv(env: Record<string, string | undefined>): IpnEnv | null {
  const supabaseUrl = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const ipnSecret = (env.NOWPAYMENTS_IPN_SECRET ?? '').trim();
  if (!supabaseUrl || !serviceRoleKey || !ipnSecret) return null;
  return { supabaseUrl, serviceRoleKey, ipnSecret };
}

export async function POST(request: Request): Promise<Response> {
  return handleIpn(request, readIpnEnv(process.env), fetch);
}

export async function handleIpn(
  request: Request,
  env: IpnEnv | null,
  fetchImpl: typeof fetch,
): Promise<Response> {
  if (!env) {
    console.error('NOWPayments IPN received, but the server is missing its keys.');
    return new Response('not configured', { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return new Response('bad body', { status: 400 });
  }

  if (!verifyIpnSignature(body, request.headers.get('x-nowpayments-sig'), env.ipnSecret)) {
    return new Response('bad signature', { status: 401 });
  }

  const orderId = typeof body.order_id === 'string' ? body.order_id : '';
  const status = typeof body.payment_status === 'string' ? body.payment_status : '';
  // Not one of ours (a payment made some other way on the same account): say
  // OK, or NOWPayments keeps retrying something that can never be recorded.
  if (!UUID.test(orderId) || !status) return new Response('ignored', { status: 200 });

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  });

  const { data, error } = await admin.rpc('record_payment', {
    p_payment: orderId,
    p_payment_id: body.payment_id == null ? null : String(body.payment_id),
    p_status: status,
    p_price_amount: toNumber(body.price_amount),
    p_price_currency: typeof body.price_currency === 'string' ? body.price_currency : null,
    p_pay_currency: typeof body.pay_currency === 'string' ? body.pay_currency : null,
    p_actually_paid: toNumber(body.actually_paid),
  });

  if (error) {
    console.error('record_payment failed:', error.message);
    return new Response('retry', { status: 500 });
  }
  const result = data as { ok?: boolean; reason?: string } | null;
  if (result && result.ok === false) {
    console.error(`Payment ${orderId} not credited: ${result.reason}`);
  }
  return new Response('ok', { status: 200 });
}

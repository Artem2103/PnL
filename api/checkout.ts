import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/checkout — starts a payment for one of the plans.
 *
 * Body `{ plan: 'monthly' | 'quarterly' }`, header `Authorization: Bearer
 * <the Supabase session's access token>`. Creates a `payments` row, asks
 * NOWPayments for a hosted invoice whose order_id is that row's id, and answers
 * `{ url }` for the browser to go to. The invoice page is NOWPayments': the
 * customer picks a coin there, or a card / Apple Pay / Google Pay when fiat
 * payments are switched on in the NOWPayments dashboard.
 *
 * The price comes from `billing_plans`, never from the request, and nothing
 * here grants a plan — that happens only when the signed webhook says the
 * payment finished (`nowpayments-ipn.ts`).
 *
 * Self-contained on purpose: a Vercel function importing a sibling .ts file
 * has to get the ESM extension rules exactly right, and this is not the place
 * to find out it did not.
 */

const PLAN_IDS = new Set(['monthly', 'quarterly']);

export interface CheckoutEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  apiKey: string;
  apiBase: string;
  siteUrl: string | null;
}

export function readEnv(env: Record<string, string | undefined>): CheckoutEnv | null {
  const supabaseUrl = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const apiKey = (env.NOWPAYMENTS_API_KEY ?? '').trim();
  if (!supabaseUrl || !serviceRoleKey || !apiKey) return null;
  return {
    supabaseUrl,
    serviceRoleKey,
    apiKey,
    apiBase: (env.NOWPAYMENTS_API_BASE ?? 'https://api.nowpayments.io/v1').trim().replace(/\/+$/, ''),
    siteUrl: env.SITE_URL?.trim().replace(/\/+$/, '') || null,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleCheckout(request, readEnv(process.env), fetch);
}

export async function handleCheckout(
  request: Request,
  env: CheckoutEnv | null,
  fetchImpl: typeof fetch,
): Promise<Response> {
  if (!env) {
    return json(503, { error: 'Payments are not set up yet. Try again later.' });
  }

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Sign in first.' });

  let plan: unknown;
  try {
    plan = ((await request.json()) as { plan?: unknown }).plan;
  } catch {
    return json(400, { error: 'Bad request.' });
  }
  if (typeof plan !== 'string' || !PLAN_IDS.has(plan)) {
    return json(400, { error: 'Unknown plan.' });
  }

  const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json(401, { error: 'Your session has expired. Sign in again.' });
  const user = userData.user;

  const { data: planRow, error: planError } = await admin
    .from('billing_plans')
    .select('id, label, price_usd, months')
    .eq('id', plan)
    .single();
  if (planError || !planRow) return json(500, { error: 'Could not load the plan.' });

  const { data: payment, error: paymentError } = await admin
    .from('payments')
    .insert({ user_id: user.id, plan_id: planRow.id, price_usd: planRow.price_usd })
    .select('id')
    .single();
  if (paymentError || !payment) return json(500, { error: 'Could not start the payment.' });

  const site = env.siteUrl ?? new URL(request.url).origin;
  const invoiceResponse = await fetchImpl(`${env.apiBase}/invoice`, {
    method: 'POST',
    headers: { 'x-api-key': env.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      price_amount: Number(planRow.price_usd),
      price_currency: 'usd',
      order_id: payment.id,
      order_description: `Astra — ${planRow.label}`,
      ipn_callback_url: `${site}/api/nowpayments-ipn`,
      success_url: `${site}/pricing?payment=${payment.id}`,
      cancel_url: `${site}/pricing?cancelled=1`,
    }),
  });

  const invoice = (await invoiceResponse.json().catch(() => null)) as {
    id?: string | number;
    invoice_url?: string;
    message?: string;
  } | null;

  if (!invoiceResponse.ok || !invoice?.invoice_url) {
    await admin.from('payments').update({ status: 'invoice_failed' }).eq('id', payment.id);
    console.error('NOWPayments invoice failed:', invoiceResponse.status, invoice?.message);
    return json(502, { error: 'The payment page could not be opened. Try again in a minute.' });
  }

  await admin
    .from('payments')
    .update({ status: 'invoice', invoice_id: invoice.id == null ? null : String(invoice.id) })
    .eq('id', payment.id);

  return json(200, { url: invoice.invoice_url, paymentId: payment.id });
}

// Dev-only: runs supabase/schema.sql in real Postgres (PGlite, WebAssembly) and
// checks the billing functions — the free limit, MM33, payments, and that none
// of it can be written around. PGlite is not a dependency of the app: copy this
// file into a scratch folder, `npm i @electric-sql/pglite` there, and run
// `node billing-sql.mjs` (SCHEMA=<path> if the repo is not at D:/PnL).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(process.env.SCHEMA ?? 'D:/PnL/supabase/schema.sql', 'utf8');
const db = new PGlite();
let failures = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures++;
};

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  alter table storage.objects enable row level security;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

await db.exec(schema);
await db.exec(schema); // it claims to be re-runnable
check('schema.sql applies, twice', true);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@test'), ('${B}', 'b@test')`);

const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);

async function as(role, uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}
async function denied(role, uid, sql) {
  try {
    const result = await as(role, uid, sql);
    return { denied: false, rows: result.rows };
  } catch (error) {
    return { denied: true, message: error.message };
  }
}
const one = (result) => Object.values(result.rows[0])[0];

// --- free limit
let status = one(await as('authenticated', A, 'select public.plan_status()'));
check('new account is free with 0 of 1 used', status.is_paid === false && status.free_used === 0 && status.free_limit === 1, JSON.stringify(status));

let claim = one(await as('authenticated', A, `select public.claim_export('${keyA}', 'png')`));
check('first card exports', claim.allowed === true && claim.free_used === 1);
claim = one(await as('authenticated', A, `select public.claim_export('${keyA}', 'mp4')`));
check('same card again (as MP4) still exports, still 1 used', claim.allowed === true && claim.free_used === 1);
claim = one(await as('authenticated', A, `select public.claim_export('${keyB}', 'png')`));
check('a second, different card is refused', claim.allowed === false && claim.free_used === 1, JSON.stringify(claim));
const rows = one(await db.query(`select count(*)::int from public.card_exports where user_id = '${A}'`));
check('the refused export was not recorded', rows === 2, `rows=${rows}`);

let r = await denied('authenticated', A, `select public.claim_export('not-a-key', 'png')`);
check('a malformed card key is rejected', r.denied, r.message);
r = await denied('anon', null, `select public.plan_status()`);
check('anon cannot call plan_status', r.denied, r.message);

// Last month's exports do not count.
await db.exec(`update public.card_exports set created_at = date_trunc('month', now()) - interval '1 day' where user_id = '${A}'`);
claim = one(await as('authenticated', A, `select public.claim_export('${keyB}', 'png')`));
check('last month\'s card does not count this month', claim.allowed === true && claim.free_used === 1);

// --- nothing can be written around the functions
r = await denied('authenticated', A, `insert into public.card_exports (user_id, card_key, format, paid) values ('${A}', '${keyA}', 'png', true)`);
check('cannot insert card_exports directly', r.denied, r.message);
r = await denied('authenticated', A, `delete from public.card_exports where user_id = '${A}'`);
check('cannot delete own exports to reset the counter', r.denied, r.message);
r = await denied('authenticated', A, `insert into public.subscriptions (user_id, paid_until, last_source) values ('${A}', now() + interval '10 years', 'x')`);
check('cannot insert a subscription', r.denied, r.message);
r = await denied('authenticated', A, `select * from public.promo_codes`);
check('cannot list promo codes', r.denied, r.message);
r = await denied('authenticated', A, `select public.extend_subscription('${A}', 120, 'x')`);
check('cannot call extend_subscription', r.denied, r.message);
r = await denied('authenticated', A, `select public.record_payment('${A}', '1', 'finished', 100, 'usd', null, null)`);
check('cannot call record_payment', r.denied, r.message);
r = await denied('authenticated', A, `select * from admin.subscribers`);
check('cannot read admin.subscribers', r.denied, r.message);

// --- promo
let promo = one(await as('authenticated', A, `select public.redeem_promo(' mm33 ')`));
const until = new Date(promo.paid_until);
const months = (until.getUTCFullYear() - new Date().getUTCFullYear()) * 12 + until.getUTCMonth() - new Date().getUTCMonth();
check('MM33 (any case, spaces) gives 3 months', promo.ok === true && promo.months === 3 && months === 3, JSON.stringify(promo));
promo = one(await as('authenticated', A, `select public.redeem_promo('MM33')`));
check('MM33 twice on one account is refused', promo.ok === false && promo.reason === 'already_redeemed');
status = one(await as('authenticated', A, 'select public.plan_status()'));
check('account is now paid', status.is_paid === true);
for (const key of ['c', 'd', 'e']) {
  claim = one(await as('authenticated', A, `select public.claim_export('${key.repeat(64)}', 'png')`));
  if (!claim.allowed) break;
}
check('paid account exports any number of cards', claim.allowed === true);
status = one(await as('authenticated', A, 'select public.plan_status()'));
check('paid exports do not use the free allowance', status.free_used === 1, `free_used=${status.free_used}`);

promo = one(await as('authenticated', B, `select public.redeem_promo('MM33')`));
check('another account can also redeem MM33 once', promo.ok === true);

for (let i = 0; i < 10; i++) await as('authenticated', B, `select public.redeem_promo('WRONG${i}')`);
promo = one(await as('authenticated', B, `select public.redeem_promo('MM34')`));
check('11th wrong code within the hour is throttled', promo.ok === false && promo.reason === 'too_many_attempts', JSON.stringify(promo));

// --- isolation
const seen = await as('authenticated', B, `select count(*)::int as n from public.card_exports`);
check("B cannot see A's exports", seen.rows[0].n === 0, `n=${seen.rows[0].n}`);

// --- payments via the webhook's role
const C = '33333333-3333-4333-8333-333333333333';
await db.exec(`insert into auth.users (id, email) values ('${C}', 'c@test')`);
const pay = (await as('service_role', null, `insert into public.payments (user_id, plan_id, price_usd) values ('${C}', 'quarterly', 12.99) returning id`)).rows[0].id;
let res = one(await as('service_role', null, `select public.record_payment('${pay}', '999', 'waiting', 12.99, 'usd', 'usdttrc20', 0)`));
check('waiting records but does not credit', res.ok && res.credited === false);
res = one(await as('service_role', null, `select public.record_payment('${pay}', '999', 'finished', 12.99, 'usd', 'usdttrc20', 13.1)`));
check('finished credits the plan', res.ok && res.credited === true, JSON.stringify(res));
const firstUntil = res.paid_until;
res = one(await as('service_role', null, `select public.record_payment('${pay}', '999', 'finished', 12.99, 'usd', 'usdttrc20', 13.1)`));
check('a retried finished webhook does not credit twice', res.ok && res.credited === false);
res = one(await as('service_role', null, `select public.record_payment('${pay}', '999', 'waiting', 12.99, 'usd', null, null)`));
const payRow = (await db.query(`select status, credited_at from public.payments where id = '${pay}'`)).rows[0];
check('a late waiting does not overwrite finished', payRow.status === 'finished' && payRow.credited_at, JSON.stringify(payRow));
const cUntil = one(await db.query(`select paid_until from public.subscriptions where user_id = '${C}'`));
check('quarterly payment = 3 months', Math.round((new Date(cUntil) - Date.now()) / 86400000) >= 89 && new Date(cUntil).getTime() === new Date(firstUntil).getTime());

const pay2 = (await as('service_role', null, `insert into public.payments (user_id, plan_id, price_usd) values ('${C}', 'monthly', 5.99) returning id`)).rows[0].id;
res = one(await as('service_role', null, `select public.record_payment('${pay2}', '1000', 'finished', 1.00, 'usd', null, null)`));
check('a finished payment below the plan price is not credited', res.ok === false && res.reason === 'amount_mismatch');
const pay3 = (await as('service_role', null, `insert into public.payments (user_id, plan_id, price_usd) values ('${C}', 'monthly', 5.99) returning id`)).rows[0].id;
res = one(await as('service_role', null, `select public.record_payment('${pay3}', '1001', 'finished', 5.99, 'usd', null, null)`));
const extended = new Date(res.paid_until);
const expected = new Date(cUntil);
expected.setUTCMonth(expected.getUTCMonth() + 1);
check('paying while paid adds the month to the end', Math.abs(extended - expected) < 86400000 * 1.5, `${res.paid_until} vs ${expected.toISOString()}`);
res = one(await as('service_role', null, `select public.record_payment('${A}', '1', 'finished', 5.99, 'usd', null, null)`));
check('an unknown order id is reported, not credited', res.ok === false && res.reason === 'unknown_payment');

const mine = await as('authenticated', C, `select count(*)::int as n from public.payments`);
const theirs = await as('authenticated', A, `select count(*)::int as n from public.payments`);
check('an account sees its own payments only', mine.rows[0].n === 3 && theirs.rows[0].n === 0);

const subs = await db.query(`select email, active, last_source, paid_payments, promo_codes from admin.subscribers order by email`);
console.log(subs.rows);

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);

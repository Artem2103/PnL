// Dev-only: runs supabase/schema.sql in real Postgres (PGlite, WebAssembly) and
// checks the journal tables — that each account sees and writes only its own
// trades and settings, that `source` is manual/mt5 only, and that an MT5 deal
// ticket cannot be imported twice. Run it like billing-sql.mjs: copy into a
// scratch folder, `npm i @electric-sql/pglite` there, `node journal-sql.mjs`.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const schema = readFileSync('D:/PnL/supabase/schema.sql', 'utf8');
const db = new PGlite();
let fails = 0;
const check = (n, c, d='') => { console.log(`${c?'PASS':'FAIL'}  ${n} ${d}`); if(!c) fails++; };
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
await db.exec(schema); await db.exec(schema);
check('schema applies twice', true);
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users (id,email) values ('${A}','a@x'),('${B}','b@x')`);
const as = async (u, sql) => { await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${u}',false);`); try { return await db.query(sql); } finally { await db.exec('reset role'); } };
await as(A, `insert into public.trades (user_id,symbol,side,entry_price,close_price,lots,pnl,opened_at,closed_at) values ('${A}','EURUSD','buy',1.1,1.2,1,50,now()-interval '1 hour',now())`);
check('A sees own trade', (await as(A,'select * from public.trades')).rows.length===1);
check('B sees none', (await as(B,'select * from public.trades')).rows.length===0);
let blocked=false; try { await as(B, `insert into public.trades (user_id,symbol,side,entry_price,lots,pnl,opened_at) values ('${A}','X','buy',1,1,1,now())`);} catch { blocked=true; }
check('B cannot write as A', blocked);
const del = await as(B, `delete from public.trades returning id`); check('B cannot delete A', del.rows.length===0);
let bad=false; try { await as(A, `insert into public.trades (user_id,source,symbol,side,entry_price,lots,pnl,opened_at) values ('${A}','csv','X','buy',1,1,1,now())`);} catch { bad=true; }
check('source is limited to manual/mt5', bad);
await as(A, `insert into public.trades (user_id,source,external_id,symbol,side,entry_price,lots,pnl,opened_at) values ('${A}','mt5','T1','X','buy',1,1,1,now())`);
let dup=false; try { await as(A, `insert into public.trades (user_id,source,external_id,symbol,side,entry_price,lots,pnl,opened_at) values ('${A}','mt5','T1','X','buy',1,1,1,now())`);} catch { dup=true; }
check('an MT5 ticket cannot be imported twice', dup);
await as(A, `insert into public.journal_settings (user_id, starting_balance, currency) values ('${A}', 5000, 'EUR') on conflict (user_id) do update set starting_balance = excluded.starting_balance`);
check('settings round-trip', (await as(A,'select starting_balance from public.journal_settings')).rows[0]?.starting_balance===5000);
check('B cannot see A settings', (await as(B,'select * from public.journal_settings')).rows.length===0);
process.exit(fails?1:0);

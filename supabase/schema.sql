-- =====================================================================
-- Astra — accounts, cards and media
-- =====================================================================
--
-- Run once, whole file, in the Supabase dashboard's SQL editor
-- (Project -> SQL Editor -> New query -> paste -> Run). It is written to be
-- re-runnable: every object is created only if it is missing, and every policy
-- is dropped before it is recreated, so applying it twice is harmless.
--
-- What it sets up:
--   profiles   one row per account, created automatically on sign-up
--   cards      the saved card state, as JSON, one row per card
--   media      one row per uploaded file; the bytes live in Storage
--   storage    a private "media" bucket, partitioned by user id
--
-- Every table is protected by row-level security keyed to auth.uid(), so the
-- anon key that ships in the browser can only ever reach the signed-in user's
-- own rows. That is the whole security model — there is no server in front of
-- it to check anything, so these policies have to be right.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'One row per account. Exists so future per-user settings have somewhere to go that is not the auth schema, which the app cannot extend.';

-- A copy of the sign-in email, so the Table Editor shows who each row is. It
-- is kept in step with auth.users by the triggers further down; nothing else
-- should write it. RLS still limits each account to its own row, so the API
-- never shows one user another's email.
alter table public.profiles add column if not exists email text;

-- The app never writes this table. Users may set their own display name, but
-- not the mirrored email, which would then lie about who the account is.
revoke insert, update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ------------------------------------------------------------------- cards

create table if not exists public.cards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'Untitled card',
  -- The whole CardState blob. Kept as one JSON document rather than a column
  -- per field: the shape changes with the layout, and hydrateState() already
  -- merges an old save over current defaults. A migration per tweak would be
  -- the wrong trade.
  state      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cards_user_updated_idx
  on public.cards (user_id, updated_at desc);

-- ------------------------------------------------------------------- media

create table if not exists public.media (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('artwork', 'avatar', 'logo')),
  kind         text not null check (kind in ('image', 'video')),
  name         text not null default '',
  width        integer not null default 0,
  height       integer not null default 0,
  duration     real    not null default 0,
  byte_size    bigint  not null default 0,
  mime_type    text    not null default 'application/octet-stream',
  -- Paths inside the "media" bucket. Always "<user_id>/<id>", which is what the
  -- storage policies below match on.
  storage_path text not null,
  poster_path  text,
  created_at   timestamptz not null default now()
);

create index if not exists media_user_role_idx
  on public.media (user_id, role, created_at desc);

comment on table public.media is
  'Metadata for each uploaded file. The bytes are in the "media" storage bucket; this table is the manifest a second device syncs from.';

-- The id is generated on the client so the browser cache, the storage path and
-- this row all share one key. Rows are inserted after the upload succeeds, so a
-- row here always has bytes behind it.

-- --------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at
  before update on public.cards
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------- profile row on sign-up

-- security definer because it writes to public.profiles as the new user before
-- any session exists. search_path is pinned: without it, a schema earlier on
-- the path could shadow "profiles" and this would write somewhere else.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do update
    set email        = excluded.email,
        display_name = coalesce(excluded.display_name, public.profiles.display_name);
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Same function on change, so a changed email or name reaches the profile.
drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- Accounts made before the email column existed, and any without a profile.
insert into public.profiles (id, email, display_name)
select u.id, u.email, nullif(u.raw_user_meta_data ->> 'display_name', '')
from auth.users u
on conflict (id) do update
  set email        = excluded.email,
      display_name = coalesce(excluded.display_name, public.profiles.display_name);

-- ================================================================= RLS

alter table public.profiles enable row level security;
alter table public.cards    enable row level security;
alter table public.media    enable row level security;

drop policy if exists "profiles are self-service" on public.profiles;
create policy "profiles are self-service" on public.profiles
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "cards are self-service" on public.cards;
create policy "cards are self-service" on public.cards
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "media rows are self-service" on public.media;
create policy "media rows are self-service" on public.media
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================= storage

-- Private bucket: nothing in it is reachable by URL alone. The app reads it
-- with short-lived signed URLs, so a card's background cannot be guessed at or
-- hotlinked from outside the account.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 104857600)  -- 100 MB, above the 80 MB client cap
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- Every object is stored as "<user_id>/<media_id>", so the first path segment
-- is the owner and these four policies are the whole access model.
drop policy if exists "media objects are readable by their owner"  on storage.objects;
drop policy if exists "media objects are writable by their owner"  on storage.objects;
drop policy if exists "media objects are updatable by their owner" on storage.objects;
drop policy if exists "media objects are deletable by their owner" on storage.objects;

create policy "media objects are readable by their owner" on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media objects are writable by their owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media objects are updatable by their owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media objects are deletable by their owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========================================================= admin views

-- For browsing uploads in the dashboard, not for the app. Table Editor ->
-- schema "admin" -> uploads shows every file with the account that uploaded
-- it; the file itself opens from Storage -> media -> <user_id> folder, where
-- objects are named "<original name>--<media id>.<ext>" (older uploads are
-- just "<media id>").
--
-- It lives in its own schema on purpose. A view reads as its owner and so
-- skips row-level security, and it joins auth.users: in "public" the API would
-- hand every account's email to anyone holding the anon key. "admin" is not
-- in the API's exposed schemas, and the grants below shut it for API roles
-- even if someone adds it there later.
create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;

create or replace view admin.uploads as
select
  m.created_at                                              as uploaded_at,
  u.email                                                   as uploader_email,
  coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''),
           nullif(p.display_name, ''))                      as uploader_name,
  m.name                                                    as file_name,
  m.kind,
  m.role,
  m.mime_type,
  round(m.duration::numeric, 1)                             as seconds,
  round(m.byte_size / 1048576.0, 2)                         as megabytes,
  m.width,
  m.height,
  'media/' || m.storage_path                                as file_in_storage,
  m.user_id,
  m.id                                                      as media_id
from public.media m
join auth.users u on u.id = m.user_id
left join public.profiles p on p.id = m.user_id
order by m.created_at desc;

revoke all on admin.uploads from public, anon, authenticated;

-- Deleting a media row does NOT delete its bytes: Postgres cannot reach into
-- the storage API. The client deletes the object first and the row second, and
-- orphaned objects are the failure mode to look for if the two ever disagree.

-- ============================================================== billing
--
-- Plans, payments, the free-card limit and promo codes. Anything that could
-- give an account a plan is written only by the security-definer functions
-- below, or by the payment webhook with the service-role key; to the browser
-- these tables are read-only, and only its own rows.
--
--   billing_plans      the two paid plans and their prices — what a payment has
--                      to cover before it counts
--   subscriptions      one row per account that has ever had a plan: paid_until
--   payments           one row per checkout, updated by the payment webhook
--   card_exports       one row per export; the free limit is counted from it
--   promo_codes        the codes — never readable from the browser
--   promo_redemptions  one redemption per code per account
--   promo_attempts     wrong codes, so they cannot be guessed at speed

create table if not exists public.billing_plans (
  id        text primary key,
  label     text not null,
  price_usd numeric(10, 2) not null check (price_usd > 0),
  months    integer not null check (months > 0)
);

insert into public.billing_plans (id, label, price_usd, months) values
  ('monthly',   'Monthly',  5.99,  1),
  ('quarterly', '3 months', 12.99, 3)
on conflict (id) do update
  set label = excluded.label, price_usd = excluded.price_usd, months = excluded.months;

create table if not exists public.subscriptions (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  paid_until  timestamptz not null,
  -- What last extended it: 'payment' or 'promo'.
  last_source text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.payments (
  -- Sent to NOWPayments as order_id, and handed back in every webhook call.
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  plan_id       text not null references public.billing_plans (id),
  price_usd     numeric(10, 2) not null,
  provider      text not null default 'nowpayments',
  invoice_id    text,
  payment_id    text,
  -- 'created' / 'invoice' from here, then NOWPayments' own: waiting,
  -- confirming, confirmed, sending, partially_paid, finished, failed,
  -- refunded, expired. 'amount_mismatch' if a finished payment was short.
  status        text not null default 'created',
  pay_currency  text,
  actually_paid numeric,
  credited_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists payments_user_created_idx
  on public.payments (user_id, created_at desc);

create table if not exists public.card_exports (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 of the card's settings. The same card exported again — PNG, then
  -- MP4, then a copy — is still one card, not three.
  card_key   text not null,
  format     text not null check (format in ('png', 'mp4', 'copy', 'share')),
  -- Whether the account had a plan at the time. Only free exports count.
  paid       boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists card_exports_user_created_idx
  on public.card_exports (user_id, created_at desc);

create table if not exists public.promo_codes (
  code            text primary key check (code = upper(code)),
  months          integer not null check (months > 0),
  active          boolean not null default true,
  expires_at      timestamptz,
  -- Across all accounts; null is unlimited. One redemption per account always.
  max_redemptions integer,
  created_at      timestamptz not null default now()
);

insert into public.promo_codes (code, months) values ('MM33', 3)
on conflict (code) do nothing;

create table if not exists public.promo_redemptions (
  code        text not null references public.promo_codes (code) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

create table if not exists public.promo_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists promo_attempts_user_created_idx
  on public.promo_attempts (user_id, created_at desc);

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_updated_at();

alter table public.billing_plans     enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.payments          enable row level security;
alter table public.card_exports      enable row level security;
alter table public.promo_codes       enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.promo_attempts    enable row level security;

-- Supabase grants every API role full rights on new tables; RLS would stop
-- the writes anyway, and this says so a second time.
revoke insert, update, delete on
  public.billing_plans, public.subscriptions, public.payments, public.card_exports,
  public.promo_codes, public.promo_redemptions, public.promo_attempts
from anon, authenticated;
-- The codes are not listable at all, or the page would hand them out.
revoke select on public.promo_codes, public.promo_attempts from anon, authenticated;

drop policy if exists "plans are public" on public.billing_plans;
create policy "plans are public" on public.billing_plans
  for select to anon, authenticated using (true);

drop policy if exists "own subscription is readable" on public.subscriptions;
create policy "own subscription is readable" on public.subscriptions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own payments are readable" on public.payments;
create policy "own payments are readable" on public.payments
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own exports are readable" on public.card_exports;
create policy "own exports are readable" on public.card_exports
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own redemptions are readable" on public.promo_redemptions;
create policy "own redemptions are readable" on public.promo_redemptions
  for select to authenticated using (auth.uid() = user_id);

-- How many different cards a free account may export per calendar month (UTC).
create or replace function public.free_cards_per_month()
returns integer
language sql
immutable
as $fn$ select 1 $fn$;

-- Adds months to an account's plan, counted from whichever is later: now, or
-- the end of the time it already has. Paying or redeeming while paid extends.
create or replace function public.extend_subscription(p_user uuid, p_months integer, p_source text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_until timestamptz;
begin
  insert into public.subscriptions as s (user_id, paid_until, last_source)
  values (p_user, now() + make_interval(months => p_months), p_source)
  on conflict (user_id) do update
    set paid_until  = greatest(s.paid_until, now()) + make_interval(months => p_months),
        last_source = excluded.last_source
  returning paid_until into v_until;
  return v_until;
end;
$fn$;

-- The signed-in account's plan, and what is left of this month's free card.
create or replace function public.plan_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid         uuid := auth.uid();
  v_until       timestamptz;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_keys        text[];
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  select paid_until into v_until from public.subscriptions where user_id = v_uid;

  select coalesce(array_agg(distinct card_key), '{}') into v_keys
  from public.card_exports
  where user_id = v_uid and not paid and created_at >= v_month_start;

  return jsonb_build_object(
    'paid_until', v_until,
    'is_paid',    coalesce(v_until > now(), false),
    'free_limit', public.free_cards_per_month(),
    'free_used',  coalesce(array_length(v_keys, 1), 0),
    'free_cards', to_jsonb(v_keys),
    'resets_at',  v_month_start + interval '1 month'
  );
end;
$fn$;

-- Called by the editor before every export. Records the export and says
-- whether it may go ahead: always on a paid plan; on the free plan, when this
-- card is the one the month's allowance already went on, or there is
-- allowance left.
create or replace function public.claim_export(p_card_key text, p_format text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid         uuid := auth.uid();
  v_paid        boolean;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_keys        text[];
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_card_key is null or p_card_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad card key.' using errcode = '22023';
  end if;
  if p_format is null or p_format not in ('png', 'mp4', 'copy', 'share') then
    raise exception 'Bad export format.' using errcode = '22023';
  end if;

  -- Two exports started at once must not both take the last free card.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));

  select paid_until > now() into v_paid from public.subscriptions where user_id = v_uid;
  v_paid := coalesce(v_paid, false);

  if not v_paid then
    select coalesce(array_agg(distinct card_key), '{}') into v_keys
    from public.card_exports
    where user_id = v_uid and not paid and created_at >= v_month_start;

    if not (p_card_key = any (v_keys))
       and coalesce(array_length(v_keys, 1), 0) >= public.free_cards_per_month() then
      return public.plan_status() || jsonb_build_object('allowed', false);
    end if;
  end if;

  insert into public.card_exports (user_id, card_key, format, paid)
  values (v_uid, p_card_key, p_format, v_paid);

  return public.plan_status() || jsonb_build_object('allowed', true);
end;
$fn$;

-- Redeems a promo code for the signed-in account. Returns { ok, reason?,
-- months?, paid_until? }; reason is invalid, already_redeemed, used_up or
-- too_many_attempts.
create or replace function public.redeem_promo(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_promo public.promo_codes;
  v_used  integer;
  v_until timestamptz;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 43));

  if (select count(*) from public.promo_attempts
      where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  select * into v_promo from public.promo_codes where code = v_code for update;

  if not found or not v_promo.active
     or (v_promo.expires_at is not null and v_promo.expires_at <= now()) then
    insert into public.promo_attempts (user_id) values (v_uid);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if exists (select 1 from public.promo_redemptions where code = v_code and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'already_redeemed');
  end if;

  if v_promo.max_redemptions is not null then
    select count(*) into v_used from public.promo_redemptions where code = v_code;
    if v_used >= v_promo.max_redemptions then
      return jsonb_build_object('ok', false, 'reason', 'used_up');
    end if;
  end if;

  insert into public.promo_redemptions (code, user_id) values (v_code, v_uid);
  v_until := public.extend_subscription(v_uid, v_promo.months, 'promo');

  return jsonb_build_object('ok', true, 'months', v_promo.months, 'paid_until', v_until);
end;
$fn$;

-- Called only by the payment webhook, with the service-role key, with what
-- NOWPayments reported. Records the status and, on 'finished', grants the
-- plan's months — once, however often the webhook is retried, and only when
-- the invoice was for at least the plan's price in USD.
create or replace function public.record_payment(
  p_payment        uuid,
  p_payment_id     text,
  p_status         text,
  p_price_amount   numeric,
  p_price_currency text,
  p_pay_currency   text,
  p_actually_paid  numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row    public.payments;
  v_months integer;
  v_until  timestamptz;
begin
  select * into v_row from public.payments where id = p_payment for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown_payment');
  end if;

  update public.payments
    set payment_id    = coalesce(p_payment_id, payment_id),
        -- A retried 'waiting' arriving late must not overwrite 'finished'.
        status        = case when credited_at is null then p_status else status end,
        pay_currency  = coalesce(p_pay_currency, pay_currency),
        actually_paid = coalesce(p_actually_paid, actually_paid)
  where id = p_payment;

  if p_status <> 'finished' or v_row.credited_at is not null then
    return jsonb_build_object('ok', true, 'credited', false);
  end if;

  if lower(coalesce(p_price_currency, '')) <> 'usd'
     or coalesce(p_price_amount, 0) < v_row.price_usd then
    update public.payments set status = 'amount_mismatch' where id = p_payment;
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  select months into v_months from public.billing_plans where id = v_row.plan_id;
  v_until := public.extend_subscription(v_row.user_id, v_months, 'payment');
  update public.payments set credited_at = now(), status = 'finished' where id = p_payment;

  return jsonb_build_object('ok', true, 'credited', true, 'paid_until', v_until);
end;
$fn$;

-- Postgres grants EXECUTE to PUBLIC by default. Two of these hand out months
-- and must never be callable with the anon key or a user's session.
revoke execute on function public.extend_subscription(uuid, integer, text)
  from public, anon, authenticated;
revoke execute on function public.record_payment(uuid, text, text, numeric, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.record_payment(uuid, text, text, numeric, text, text, numeric)
  to service_role;

revoke execute on function public.plan_status()            from public, anon;
revoke execute on function public.claim_export(text, text) from public, anon;
revoke execute on function public.redeem_promo(text)       from public, anon;
grant execute on function public.plan_status()             to authenticated;
grant execute on function public.claim_export(text, text)  to authenticated;
grant execute on function public.redeem_promo(text)        to authenticated;

-- For the dashboard: who has a plan, until when, and how they got it. Same
-- reasoning as admin.uploads — its own schema, closed to the API roles.
create or replace view admin.subscribers as
select
  s.paid_until,
  s.paid_until > now()                                           as active,
  s.last_source,
  u.email,
  coalesce(nullif(u.raw_user_meta_data ->> 'display_name', ''),
           nullif(p.display_name, ''))                           as name,
  (select count(*) from public.payments x
    where x.user_id = s.user_id and x.credited_at is not null)   as paid_payments,
  (select string_agg(r.code, ', ') from public.promo_redemptions r
    where r.user_id = s.user_id)                                 as promo_codes,
  s.user_id
from public.subscriptions s
join auth.users u on u.id = s.user_id
left join public.profiles p on p.id = s.user_id
order by s.paid_until desc;

revoke all on admin.subscribers from public, anon, authenticated;

-- ============================================================== journal

-- The trading journal: one row per trade, and one settings row per account.
--
-- `source` is where a row came from. Today every row is 'manual', typed into
-- the journal; MT5 sync will write 'mt5' rows into this same table, carrying
-- the broker's deal ticket in `external_id`. The unique index on
-- (user_id, source, external_id) is what will let a sync be re-run without
-- duplicating anything. The UI reads the table without caring which it is.
--
-- `closed_at` null means a position that is still open: its `pnl` is then the
-- floating PnL. Manual entry always closes a trade; MT5 sync will not.

create table if not exists public.trades (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  source      text not null default 'manual' check (source in ('manual', 'mt5')),
  external_id text,
  symbol      text not null check (char_length(symbol) between 1 and 32),
  side        text not null check (side in ('buy', 'sell')),
  entry_price double precision not null,
  close_price double precision,
  lots        double precision not null check (lots > 0),
  -- In the account currency of journal_settings, as the broker reports it.
  pnl         double precision not null,
  opened_at   timestamptz not null,
  closed_at   timestamptz,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists trades_user_closed_idx
  on public.trades (user_id, closed_at desc);

create unique index if not exists trades_user_source_external_idx
  on public.trades (user_id, source, external_id)
  where external_id is not null;

create table if not exists public.journal_settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  starting_balance double precision not null default 10000,
  currency         text not null default 'USD' check (char_length(currency) between 1 and 8),
  updated_at       timestamptz not null default now()
);

drop trigger if exists trades_touch_updated_at on public.trades;
create trigger trades_touch_updated_at
  before update on public.trades
  for each row execute function public.touch_updated_at();

drop trigger if exists journal_settings_touch_updated_at on public.journal_settings;
create trigger journal_settings_touch_updated_at
  before update on public.journal_settings
  for each row execute function public.touch_updated_at();

alter table public.trades           enable row level security;
alter table public.journal_settings enable row level security;

drop policy if exists "trades are self-service" on public.trades;
create policy "trades are self-service" on public.trades
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "journal settings are self-service" on public.journal_settings;
create policy "journal settings are self-service" on public.journal_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================== community
--
-- The public feed. Everything here is world-readable on purpose, so nothing
-- private may live here: `profiles` keeps the email and stays self-service, and
-- `community_profiles` carries only what a person chose to show. Pictures go in
-- their own public bucket, never the private "media" one.

create table if not exists public.community_profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  handle       text not null,
  display_name text not null default '' check (char_length(display_name) <= 50),
  bio          text not null default '' check (char_length(bio) <= 160),
  -- Paths in the "community" bucket, not URLs: a URL could point anywhere and
  -- track everyone who loads the feed.
  avatar_path  text,
  banner_path  text,
  created_at   timestamptz not null default now(),
  constraint community_handle_shape check (handle ~ '^[a-z0-9_]{3,20}$'),
  constraint community_handle_reserved check (
    handle not in ('admin', 'astra', 'support', 'help', 'official', 'moderator', 'staff', 'community', 'everyone')
  ),
  constraint community_paths_are_own check (
    (avatar_path is null or split_part(avatar_path, '/', 1) = id::text)
    and (banner_path is null or split_part(banner_path, '/', 1) = id::text)
  )
);

create unique index if not exists community_profiles_handle_idx
  on public.community_profiles (handle);

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  heading    text not null default '' check (char_length(heading) <= 80),
  body       text not null default '' check (char_length(body) <= 2000),
  images     text[] not null default '{}' check (cardinality(images) <= 4),
  -- "#ict" and "$eurusd", lower case. Written by the trigger below from the text.
  tags       text[] not null default '{}',
  reply_to   uuid references public.posts (id) on delete cascade,
  repost_of  uuid references public.posts (id) on delete cascade,
  -- Set by hand from the dashboard to take a post down; see `post_reports`.
  hidden     boolean not null default false,
  created_at timestamptz not null default now(),
  constraint posts_not_empty check (
    char_length(btrim(body)) > 0 or cardinality(images) > 0 or repost_of is not null
  )
);

create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_created_idx on public.posts (user_id, created_at desc);
create index if not exists posts_reply_idx on public.posts (reply_to) where reply_to is not null;
create index if not exists posts_tags_idx on public.posts using gin (tags);
create unique index if not exists posts_one_repost_idx
  on public.posts (user_id, repost_of) where repost_of is not null;

create table if not exists public.post_likes (
  user_id    uuid not null references auth.users (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists post_likes_post_idx on public.post_likes (post_id);

create table if not exists public.post_bookmarks (
  user_id    uuid not null references auth.users (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);

create table if not exists public.post_reports (
  post_id     uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason      text not null check (reason in ('spam', 'scam', 'abuse', 'other')),
  created_at  timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  actor_id   uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('like', 'reply', 'repost', 'follow')),
  post_id    uuid references public.posts (id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- The server decides what a post is: its tags and its time. A client that sets
-- `created_at` to next year would otherwise sit on top of the feed for a year.
create or replace function public.prepare_post()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  recent integer;
begin
  select count(*) into recent from public.posts
    where user_id = new.user_id and created_at > now() - interval '1 hour';
  if recent >= 30 then
    raise exception 'You are posting too fast. Try again in a while.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(new.images) as path where split_part(path, '/', 1) <> new.user_id::text) then
    raise exception 'A post can only use your own pictures.' using errcode = 'P0001';
  end if;
  new.created_at := now();
  new.hidden := false;
  new.tags := coalesce(
    array(select distinct lower(m[1]) from regexp_matches(new.body, '(?:^|\s)([#$][A-Za-z][A-Za-z0-9_]{0,29})', 'g') as m),
    '{}'
  );
  return new;
end;
$$;

drop trigger if exists posts_prepare on public.posts;
create trigger posts_prepare
  before insert on public.posts
  for each row execute function public.prepare_post();

-- Notifications are written here and nowhere else: definer, because the row
-- belongs to someone other than the person acting.
create or replace function public.notify_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
  actor  uuid;
  what   text;
  post   uuid;
begin
  if tg_table_name = 'post_likes' then
    select p.user_id into target from public.posts p where p.id = new.post_id;
    actor := new.user_id; what := 'like'; post := new.post_id;
  elsif tg_table_name = 'follows' then
    target := new.followee_id; actor := new.follower_id; what := 'follow'; post := null;
  elsif new.reply_to is not null then
    select p.user_id into target from public.posts p where p.id = new.reply_to;
    actor := new.user_id; what := 'reply'; post := new.reply_to;
  elsif new.repost_of is not null then
    select p.user_id into target from public.posts p where p.id = new.repost_of;
    actor := new.user_id; what := 'repost'; post := new.repost_of;
  end if;
  if target is not null and target <> actor then
    insert into public.notifications (user_id, actor_id, kind, post_id) values (target, actor, what, post);
  end if;
  return new;
end;
$$;

revoke all on function public.notify_activity() from public, anon, authenticated;

drop trigger if exists post_likes_notify on public.post_likes;
create trigger post_likes_notify after insert on public.post_likes
  for each row execute function public.notify_activity();
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_activity();
drop trigger if exists posts_notify on public.posts;
create trigger posts_notify after insert on public.posts
  for each row execute function public.notify_activity();

alter table public.community_profiles enable row level security;
alter table public.posts              enable row level security;
alter table public.post_likes         enable row level security;
alter table public.post_bookmarks     enable row level security;
alter table public.follows            enable row level security;
alter table public.post_reports       enable row level security;
alter table public.notifications      enable row level security;

drop policy if exists "community profiles are public" on public.community_profiles;
create policy "community profiles are public" on public.community_profiles
  for select to anon, authenticated using (true);
drop policy if exists "community profiles are created by their owner" on public.community_profiles;
create policy "community profiles are created by their owner" on public.community_profiles
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "community profiles are edited by their owner" on public.community_profiles;
create policy "community profiles are edited by their owner" on public.community_profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- No update policy on posts: a post is not edited, and `hidden` is the
-- moderator's alone. The author still sees their own hidden post.
drop policy if exists "posts are public" on public.posts;
create policy "posts are public" on public.posts
  for select to anon, authenticated using (not hidden or auth.uid() = user_id);
drop policy if exists "posts are written by their author" on public.posts;
create policy "posts are written by their author" on public.posts
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "posts are deleted by their author" on public.posts;
create policy "posts are deleted by their author" on public.posts
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "likes are public" on public.post_likes;
create policy "likes are public" on public.post_likes
  for select to anon, authenticated using (true);
drop policy if exists "likes are given by their owner" on public.post_likes;
create policy "likes are given by their owner" on public.post_likes
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "likes are taken back by their owner" on public.post_likes;
create policy "likes are taken back by their owner" on public.post_likes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "bookmarks are private" on public.post_bookmarks;
create policy "bookmarks are private" on public.post_bookmarks
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "follows are public" on public.follows;
create policy "follows are public" on public.follows
  for select to anon, authenticated using (true);
drop policy if exists "follows are made by the follower" on public.follows;
create policy "follows are made by the follower" on public.follows
  for insert to authenticated with check (auth.uid() = follower_id);
drop policy if exists "follows are ended by the follower" on public.follows;
create policy "follows are ended by the follower" on public.follows
  for delete to authenticated using (auth.uid() = follower_id);

-- Write-only: nobody reads reports through the API, or who reported whom. Read
-- them in the dashboard.
drop policy if exists "reports are filed by the reporter" on public.post_reports;
create policy "reports are filed by the reporter" on public.post_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

drop policy if exists "notifications are read by their owner" on public.notifications;
create policy "notifications are read by their owner" on public.notifications
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "notifications are marked by their owner" on public.notifications;
create policy "notifications are marked by their owner" on public.notifications
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Runs as the caller, so every row above still decides what comes back.
create or replace function public.community_feed(
  p_tab    text default 'foryou',
  p_tag    text default null,
  p_query  text default null,
  p_author uuid default null,
  p_parent uuid default null,
  p_before timestamptz default null,
  p_limit  integer default 30
)
returns table (
  entry_id uuid, entry_at timestamptz, reposted_by text,
  id uuid, user_id uuid, heading text, body text, images text[], reply_to uuid, created_at timestamptz,
  handle text, display_name text, avatar_path text,
  like_count bigint, reply_count bigint, repost_count bigint,
  liked boolean, reposted boolean, bookmarked boolean, following boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    e.id, e.created_at, rb.handle,
    v.id, v.user_id, v.heading, v.body, v.images, v.reply_to, v.created_at,
    a.handle, a.display_name, a.avatar_path,
    (select count(*) from public.post_likes l where l.post_id = v.id),
    (select count(*) from public.posts r where r.reply_to = v.id and not r.hidden),
    (select count(*) from public.posts r where r.repost_of = v.id and not r.hidden),
    exists (select 1 from public.post_likes l where l.post_id = v.id and l.user_id = auth.uid()),
    exists (select 1 from public.posts r where r.repost_of = v.id and r.user_id = auth.uid()),
    exists (select 1 from public.post_bookmarks b where b.post_id = v.id and b.user_id = auth.uid()),
    exists (select 1 from public.follows f where f.followee_id = v.user_id and f.follower_id = auth.uid())
  from public.posts e
  join public.posts v on v.id = coalesce(e.repost_of, e.id)
  join public.community_profiles a on a.id = v.user_id
  left join public.community_profiles rb on e.repost_of is not null and rb.id = e.user_id
  where (p_before is null or e.created_at < p_before)
    and case when p_parent is not null then e.reply_to = p_parent else e.reply_to is null end
    and (p_author is null or e.user_id = p_author)
    and (p_tag is null or v.tags @> array[lower(p_tag)])
    and (
      p_query is null
      or v.body ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or v.heading ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or a.handle ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    )
    and (p_tab <> 'following' or e.user_id in (select f.followee_id from public.follows f where f.follower_id = auth.uid()))
    and (p_tab <> 'bookmarks' or (e.repost_of is null and exists (
      select 1 from public.post_bookmarks b where b.post_id = v.id and b.user_id = auth.uid()
    )))
  order by e.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.community_trending()
returns table (tag text, uses bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select t.tag, count(*)
  from public.posts p, unnest(p.tags) as t(tag)
  where p.created_at > now() - interval '7 days' and p.repost_of is null
  group by t.tag
  order by count(*) desc, t.tag
  limit 10;
$$;

grant execute on function public.community_feed(text, text, text, uuid, uuid, timestamptz, integer) to anon, authenticated;
grant execute on function public.community_trending() to anon, authenticated;

-- Public bucket: anyone can read a file by its URL, which is what a public feed
-- is. Only images, and never SVG, which is a document that can run script.
-- 8 MB is well above what the browser's re-encoding produces.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 8388608, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "community objects are readable by anyone" on storage.objects;
drop policy if exists "community objects are writable by their owner" on storage.objects;
drop policy if exists "community objects are deletable by their owner" on storage.objects;

create policy "community objects are readable by anyone" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'community');
create policy "community objects are writable by their owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "community objects are deletable by their owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text);

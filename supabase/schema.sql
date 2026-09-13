-- =====================================================================
-- PnL Card Studio — accounts, cards and media
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

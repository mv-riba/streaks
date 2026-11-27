-- Streaks MVP schema (PRD §10–11), ported from Supabase to Neon.
-- Original: docs/supabase-migration-20261119000001_init.sql
--
-- Run once in Neon Console → SQL Editor on branch `production`, database `neondb`
-- (it runs as neondb_owner). Then refresh the Data API schema cache:
--   Console → Data API → "Refresh schema cache", or `neon data-api refresh-schema`.
--
-- Differences from the Supabase version:
--   * auth.users          → neon_auth."user" (Neon Auth / Managed Better Auth; id is uuid)
--   * auth.uid()          → public.current_user_id(), a wrapper around Neon's documented
--                           auth.user_id() (the JWT `sub`, as text). The wrapper is needed
--                           because the `authenticated` role has no USAGE on schema `auth`
--                           on this project (checked 2026-11-27: "permission denied for
--                           schema auth"), and neondb_owner cannot grant it.
--   * anon                → anonymous (the Data API role for requests without a user JWT)
--   * handle_new_user / on_auth_user_created removed: Neon Auth's user table is managed by
--     Neon, so the app upserts the profile on sign-in instead (src/data/api.ts syncProfile).
--   * delete_my_account() added: Neon Auth has no self-service delete-user endpoint, so the
--     app calls this RPC instead of the old delete-account Edge Function.

begin;

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------

-- The signed-in user's id from the Data API request JWT, or null for anonymous requests.
-- SECURITY DEFINER so `authenticated` can use it without USAGE on schema auth.
create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(auth.user_id(), '')::uuid;
$$;

create or replace function public.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

------------------------------------------------------------------------------
-- profiles
------------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references neon_auth."user" (id) on delete cascade,
  email       text,
  timezone    text not null default 'UTC',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.validate_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_validate before insert or update on public.profiles
  for each row execute function public.validate_profile();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- (Supabase's handle_new_user trigger on auth.users is intentionally not ported; see header.)

------------------------------------------------------------------------------
-- streaks
------------------------------------------------------------------------------
create table public.streaks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default public.current_user_id() references neon_auth."user" (id) on delete cascade,
  name             text not null,
  description      text,
  frequency        text not null default 'daily',
  start_date       date not null,
  checkin_enabled  boolean not null default false,
  checkin_time     time,
  is_active        boolean not null default true,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint streaks_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint streaks_description_length check (description is null or char_length(description) <= 280),
  constraint streaks_frequency_daily check (frequency = 'daily'),
  constraint streaks_checkin_time_consistent check (
    (checkin_enabled and checkin_time is not null) or (not checkin_enabled and checkin_time is null)
  ),
  constraint streaks_archive_consistent check (
    (is_active and archived_at is null) or (not is_active and archived_at is not null)
  ),
  -- Target for the composite FK from completions: guarantees owner consistency.
  constraint streaks_id_user_unique unique (id, user_id)
);

create index streaks_user_active_idx on public.streaks (user_id) where is_active;

create trigger streaks_updated_at before update on public.streaks
  for each row execute function public.set_updated_at();

------------------------------------------------------------------------------
-- completions
------------------------------------------------------------------------------
create table public.completions (
  id              uuid primary key default gen_random_uuid(),
  streak_id       uuid not null,
  user_id         uuid not null,
  completed_date  date not null,
  source          text not null,
  created_at      timestamptz not null default now(),

  constraint completions_source_valid check (source in ('manual', 'notification')),
  constraint completions_one_per_day unique (streak_id, completed_date),
  constraint completions_streak_owner_fk foreign key (streak_id, user_id)
    references public.streaks (id, user_id) on delete cascade
);

create index completions_user_date_idx on public.completions (user_id, completed_date);

-- Last-line integrity checks that hold no matter who inserts (§10.3).
create or replace function public.validate_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_start date;
begin
  select start_date into v_start from public.streaks where id = new.streak_id;
  if v_start is null then
    raise exception 'streak_not_found' using errcode = 'P0002';
  end if;
  if new.completed_date < v_start then
    raise exception 'before_start_date' using errcode = '22023';
  end if;
  -- No place on Earth has reached this date yet → it is a future date for everyone.
  if new.completed_date > (now() at time zone 'Pacific/Kiritimati')::date then
    raise exception 'future_date' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger completions_validate before insert or update on public.completions
  for each row execute function public.validate_completion();

-- A start date can't be moved past existing history.
create or replace function public.guard_start_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.start_date > old.start_date and exists (
    select 1 from public.completions c
    where c.streak_id = new.id and c.completed_date < new.start_date
  ) then
    raise exception 'start_date_after_completions' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger streaks_guard_start_date before update of start_date on public.streaks
  for each row execute function public.guard_start_date();

------------------------------------------------------------------------------
-- Row Level Security (§11)
------------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.streaks     enable row level security;
alter table public.completions enable row level security;

create policy "profiles: read own"   on public.profiles for select to authenticated using (id = (select public.current_user_id()));
create policy "profiles: insert own" on public.profiles for insert to authenticated with check (id = (select public.current_user_id()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select public.current_user_id())) with check (id = (select public.current_user_id()));

create policy "streaks: read own"   on public.streaks for select to authenticated using (user_id = (select public.current_user_id()));
create policy "streaks: insert own" on public.streaks for insert to authenticated with check (user_id = (select public.current_user_id()));
create policy "streaks: update own" on public.streaks for update to authenticated
  using (user_id = (select public.current_user_id())) with check (user_id = (select public.current_user_id()));
create policy "streaks: delete own" on public.streaks for delete to authenticated using (user_id = (select public.current_user_id()));

-- Completions are read directly but only ever written through record_completion().
create policy "completions: read own" on public.completions for select to authenticated using (user_id = (select public.current_user_id()));

-- Neon does not add default grants for `authenticated` when the Data API is enabled from
-- neon.ts, so every privilege is explicit here.
grant usage on schema public to authenticated;
revoke all on public.profiles, public.streaks, public.completions from public, anonymous, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.streaks to authenticated;
grant select on public.completions to authenticated;

-- Used in column defaults and policies evaluated as `authenticated`.
revoke all on function public.current_user_id() from public, anonymous;
grant execute on function public.current_user_id() to authenticated;

------------------------------------------------------------------------------
-- record_completion: the single server-side path for manual, notification and
-- offline-synced completions (§9.2, §10.3). Called through the Data API as
-- POST /rpc/record_completion.
--   p_timezone: the device's current IANA timezone, used to decide what "today" is.
--   Returns {"status": "created" | "already_completed", "completed_date": ...}
--   Rejections raise an exception whose message is a stable code.
------------------------------------------------------------------------------
create or replace function public.record_completion(
  p_streak_id uuid,
  p_completed_date date,
  p_timezone text,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := public.current_user_id();
  v_streak public.streaks%rowtype;
  v_today  date;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_source is null or p_source not in ('manual', 'notification') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;
  if not public.is_valid_timezone(p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if p_completed_date is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select * into v_streak from public.streaks where id = p_streak_id and user_id = v_uid;
  if not found then
    raise exception 'streak_not_found' using errcode = 'P0002';
  end if;
  if not v_streak.is_active then
    raise exception 'streak_archived' using errcode = '22023';
  end if;

  v_today := (now() at time zone p_timezone)::date;
  if p_completed_date > v_today then
    raise exception 'future_date' using errcode = '22023';
  end if;
  -- Offline / delayed notification answers may sync late, but only within a week.
  if p_completed_date < v_today - 7 then
    raise exception 'date_too_old' using errcode = '22023';
  end if;
  if p_completed_date < v_streak.start_date then
    raise exception 'before_start_date' using errcode = '22023';
  end if;

  insert into public.completions (streak_id, user_id, completed_date, source)
  values (p_streak_id, v_uid, p_completed_date, p_source)
  on conflict (streak_id, completed_date) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('status', 'already_completed', 'completed_date', p_completed_date);
  end if;
  return jsonb_build_object('status', 'created', 'id', v_id, 'completed_date', p_completed_date);
end;
$$;

revoke all on function public.record_completion(uuid, date, text, text) from public, anonymous;
grant execute on function public.record_completion(uuid, date, text, text) to authenticated;

------------------------------------------------------------------------------
-- delete_my_account: permanently deletes the caller's Neon Auth user (§4.1, §11).
-- Replaces the Supabase delete-account Edge Function. The user id comes from the
-- verified request JWT, never from the client. Deleting neon_auth."user" cascades to
-- Neon Auth's sessions/accounts and to profiles → streaks → completions.
-- Called through the Data API as POST /rpc/delete_my_account.
------------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.current_user_id();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from neon_auth."user" where id = v_uid;
  return jsonb_build_object('deleted', found);
end;
$$;

revoke all on function public.delete_my_account() from public, anonymous;
grant execute on function public.delete_my_account() to authenticated;

commit;

-- Ask the Data API (PostgREST) to reload its schema cache. If the new tables still return
-- 404, use "Refresh schema cache" in the Console or `neon data-api refresh-schema`.
notify pgrst, 'reload schema';

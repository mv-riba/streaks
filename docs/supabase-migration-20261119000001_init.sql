-- Streaks MVP schema (PRD §10–11)
-- Run with `supabase db push`, or paste into Supabase → SQL Editor.

------------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------------
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
  id          uuid primary key references auth.users (id) on delete cascade,
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

-- Create the profile when an auth user is created (§4.2). The device timezone is
-- passed as sign-up metadata; invalid values fall back to UTC and are corrected on login.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text := new.raw_user_meta_data ->> 'timezone';
begin
  if not public.is_valid_timezone(v_tz) then
    v_tz := 'UTC';
  end if;
  insert into public.profiles (id, email, timezone)
  values (new.id, new.email, v_tz)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

------------------------------------------------------------------------------
-- streaks
------------------------------------------------------------------------------
create table public.streaks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
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

create policy "profiles: read own"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles: insert own" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "streaks: read own"   on public.streaks for select to authenticated using (user_id = (select auth.uid()));
create policy "streaks: insert own" on public.streaks for insert to authenticated with check (user_id = (select auth.uid()));
create policy "streaks: update own" on public.streaks for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "streaks: delete own" on public.streaks for delete to authenticated using (user_id = (select auth.uid()));

-- Completions are read directly but only ever written through record_completion().
create policy "completions: read own" on public.completions for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.profiles, public.streaks, public.completions from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.streaks to authenticated;
grant select on public.completions to authenticated;
revoke insert, update, delete on public.completions from authenticated;

------------------------------------------------------------------------------
-- record_completion: the single server-side path for manual, notification and
-- offline-synced completions (§9.2, §10.3).
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
  v_uid    uuid := auth.uid();
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

revoke all on function public.record_completion(uuid, date, text, text) from public, anon;
grant execute on function public.record_completion(uuid, date, text, text) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;

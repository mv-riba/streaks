-- Database tests: constraints, RLS isolation, record_completion, delete_my_account and the
-- data import. Run via scripts/test-db.sh (as neondb_owner, after the migrations).
\set ON_ERROR_STOP on
\set QUIET on

-- Test helpers (owned by neondb_owner, executed as caller).
create schema tests;
grant usage on schema tests to authenticated, anonymous;

create function tests.expect_error(p_sql text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like '%' || p_message || '%' then
      raise exception 'Expected error "%", got "%" for: %', p_message, sqlerrm, p_sql;
    end if;
    raise notice 'ok - rejected (%)', p_message;
    return;
  end;
  raise exception 'Expected error "%" but statement succeeded: %', p_message, p_sql;
end $$;

create function tests.eq(actual anyelement, expected anyelement, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok - %', label;
end $$;

-- What the Data API does per request: put the verified JWT claims in the session.
create function tests.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
$$;
grant execute on all functions in schema tests to authenticated, anonymous;

-- Neon Auth users alice (1111…) and bob (2222…) are created by scripts/test-db.sh as the
-- superuser, standing in for sign-up (neondb_owner cannot insert into neon_auth."user").

------------------------------------------------------------------ as Alice
set role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');

-- The documented auth.user_id() is not callable by `authenticated` (as on the real project);
-- current_user_id() is the wrapper everything uses.
select tests.expect_error($$select auth.user_id()$$, 'permission denied for schema auth');
select tests.eq(public.current_user_id(), '11111111-1111-1111-1111-111111111111'::uuid, 'current_user_id() reads the JWT sub');

-- Profiles are created by the app on sign-in (replaces the on_auth_user_created trigger).
insert into public.profiles (id, email, timezone) values ('11111111-1111-1111-1111-111111111111', 'alice@example.com', 'Europe/Helsinki')
  on conflict (id) do update set timezone = excluded.timezone;
select tests.eq((select timezone from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Europe/Helsinki', 'profile upserted with device timezone');
select tests.expect_error($$insert into public.profiles (id, timezone) values ('11111111-1111-1111-1111-111111111111', 'Not/AZone') on conflict (id) do update set timezone = excluded.timezone$$, 'invalid_timezone');
select tests.expect_error($$insert into public.profiles (id, timezone) values ('22222222-2222-2222-2222-222222222222', 'UTC')$$, 'row-level security');

insert into public.streaks (id, name, start_date, checkin_enabled, checkin_time)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Read for 20 minutes', current_date - 30, true, '20:00');
insert into public.streaks (id, name, start_date)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'Morning workout', current_date);

select tests.eq((select user_id::text from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '11111111-1111-1111-1111-111111111111', 'user_id defaults to current_user_id()');

-- Streak validation (§10.2)
select tests.expect_error($$insert into public.streaks (name, start_date, frequency) values ('x', current_date, 'weekly')$$, 'streaks_frequency_daily');
select tests.expect_error($$insert into public.streaks (name, start_date, checkin_enabled) values ('x', current_date, true)$$, 'streaks_checkin_time_consistent');
select tests.expect_error($$insert into public.streaks (name, start_date, checkin_enabled, checkin_time) values ('x', current_date, false, '08:00')$$, 'streaks_checkin_time_consistent');
select tests.expect_error($$insert into public.streaks (name, start_date) values ('   ', current_date)$$, 'streaks_name_length');
select tests.expect_error($$insert into public.streaks (name, start_date, user_id) values ('steal', current_date, '22222222-2222-2222-2222-222222222222')$$, 'row-level security');
select tests.expect_error($$update public.streaks set is_active = false where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$, 'streaks_archive_consistent');

-- Clients cannot write completions directly
select tests.expect_error($$insert into public.completions (streak_id, user_id, completed_date, source) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', current_date, 'manual')$$, 'permission denied');

-- record_completion
select tests.eq(public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'Europe/Helsinki')::date, 'Europe/Helsinki', 'manual') ->> 'status', 'created', 'manual completion created');
select tests.eq(public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'Europe/Helsinki')::date, 'Europe/Helsinki', 'notification') ->> 'status', 'already_completed', 'duplicate completion is idempotent');
select tests.eq((select count(*)::int from public.completions where streak_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1, 'only one record per day');
select tests.eq(public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'Europe/Helsinki')::date - 1, 'Europe/Helsinki', 'notification') ->> 'status', 'created', 'delayed sync for yesterday accepted');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'Europe/Helsinki')::date + 1, 'Europe/Helsinki', 'manual')$$, 'future_date');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'Europe/Helsinki')::date - 8, 'Europe/Helsinki', 'manual')$$, 'date_too_old');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000002', current_date - 1, 'UTC', 'manual')$$, 'before_start_date');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'Mars/Olympus', 'manual')$$, 'invalid_timezone');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'UTC', 'magic')$$, 'invalid_source');

-- Start date can't jump past history
select tests.expect_error($$update public.streaks set start_date = current_date + 1 where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, 'start_date_after_completions');

-- Turning check-ins off keeps history (§7.5)
update public.streaks set checkin_enabled = false, checkin_time = null where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.eq((select count(*)::int from public.completions where streak_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2, 'disabling check-in preserves completions');

-- Archive: history kept, no new completions
update public.streaks set is_active = false, archived_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000002', current_date, 'UTC', 'manual')$$, 'streak_archived');

------------------------------------------------------------------ as Bob
select tests.login('22222222-2222-2222-2222-222222222222');
insert into public.profiles (id, email, timezone) values ('22222222-2222-2222-2222-222222222222', 'bob@example.com', 'UTC');
select tests.eq((select count(*)::int from public.streaks), 0, 'Bob cannot see Alice''s streaks');
select tests.eq((select count(*)::int from public.completions), 0, 'Bob cannot see Alice''s completions');
select tests.eq((select count(*)::int from public.profiles), 1, 'Bob sees only his own profile');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'UTC', 'manual')$$, 'streak_not_found');
update public.streaks set name = 'hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set timezone = 'UTC' where id = '11111111-1111-1111-1111-111111111111';
select tests.expect_error($$update public.profiles set timezone = 'Bogus/Zone' where id = '22222222-2222-2222-2222-222222222222'$$, 'invalid_timezone');
select tests.expect_error($$delete from public.profiles where id = '22222222-2222-2222-2222-222222222222'$$, 'permission denied');
select tests.expect_error($$delete from neon_auth."user" where id = '11111111-1111-1111-1111-111111111111'$$, 'permission denied');

------------------------------------------------------------------ anonymous (no user JWT)
select set_config('request.jwt.claims', '', false);
set role anonymous;
select tests.expect_error($$select count(*) from public.streaks$$, 'permission denied');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'UTC', 'manual')$$, 'permission denied');
select tests.expect_error($$select public.delete_my_account()$$, 'permission denied');
select tests.expect_error($$select public.current_user_id()$$, 'permission denied');

------------------------------------------------------------------ verify as owner
reset role;
select tests.eq((select name from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'Read for 20 minutes', 'Bob''s update had no effect');
select tests.eq((select timezone from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Europe/Helsinki', 'Bob could not change Alice''s profile');

-- Direct owner insert of a future date is still blocked by the trigger
select tests.expect_error($$insert into public.completions (streak_id, user_id, completed_date, source) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', current_date + 3, 'manual')$$, 'future_date');
-- Owner mismatch is blocked by the composite FK
select tests.expect_error($$insert into public.completions (streak_id, user_id, completed_date, source) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', current_date - 2, 'manual')$$, 'completions_streak_owner_fk');

-- Deleting a streak removes its completions
delete from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- delete_my_account as Alice removes everything of hers, and nothing of Bob's (§4.1, §11)
set role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');
select tests.eq(public.delete_my_account() ->> 'deleted', 'true', 'delete_my_account reports deletion');
reset role;
select tests.eq((select count(*)::int from neon_auth."user" where id = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes the Neon Auth user');
select tests.eq((select count(*)::int from neon_auth.session where "userId" = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes sessions');
select tests.eq((select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes profile');
select tests.eq((select count(*)::int from public.streaks where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes streaks');
select tests.eq((select count(*)::int from public.completions where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes completions');
select tests.eq((select count(*)::int from neon_auth."user" where id = '22222222-2222-2222-2222-222222222222'), 1, 'other users are untouched');

\echo 'ALL DATABASE TESTS PASSED'

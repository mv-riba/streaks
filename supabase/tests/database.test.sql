-- Database tests: constraints, RLS isolation, record_completion. Run via scripts/test-db.sh
\set ON_ERROR_STOP on
\set QUIET on

-- Test helpers (owned by superuser, executed as caller).
create schema tests;
grant usage on schema tests to authenticated, anon;

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

create function tests.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid::text, false);
$$;
grant execute on all functions in schema tests to authenticated, anon;

-- Two users. The trigger must create their profiles.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{"timezone":"Europe/Helsinki"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',   '{"timezone":"Not/AZone"}');

select tests.eq((select timezone from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Europe/Helsinki', 'profile created with device timezone');
select tests.eq((select timezone from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 'UTC', 'invalid sign-up timezone falls back to UTC');

------------------------------------------------------------------ as Alice
set role authenticated;
select tests.login('11111111-1111-1111-1111-111111111111');

insert into public.streaks (id, name, start_date, checkin_enabled, checkin_time)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Read for 20 minutes', current_date - 30, true, '20:00');
insert into public.streaks (id, name, start_date)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'Morning workout', current_date);

select tests.eq((select user_id::text from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '11111111-1111-1111-1111-111111111111', 'user_id defaults to auth.uid()');

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
select tests.eq((select count(*)::int from public.streaks), 0, 'Bob cannot see Alice''s streaks');
select tests.eq((select count(*)::int from public.completions), 0, 'Bob cannot see Alice''s completions');
select tests.eq((select count(*)::int from public.profiles), 1, 'Bob sees only his own profile');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'UTC', 'manual')$$, 'streak_not_found');
update public.streaks set name = 'hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set timezone = 'UTC' where id = '11111111-1111-1111-1111-111111111111';
select tests.expect_error($$update public.profiles set timezone = 'Bogus/Zone' where id = '22222222-2222-2222-2222-222222222222'$$, 'invalid_timezone');

------------------------------------------------------------------ anonymous
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.expect_error($$select count(*) from public.streaks$$, 'permission denied');
select tests.expect_error($$select public.record_completion('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'UTC', 'manual')$$, 'permission denied');

------------------------------------------------------------------ verify as superuser
reset role;
select tests.eq((select name from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'Read for 20 minutes', 'Bob''s update had no effect');
select tests.eq((select timezone from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 'Europe/Helsinki', 'Bob could not change Alice''s profile');

-- Direct superuser insert of a future date is still blocked by the trigger
select tests.expect_error($$insert into public.completions (streak_id, user_id, completed_date, source) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', current_date + 3, 'manual')$$, 'future_date');
-- Owner mismatch is blocked by the composite FK
select tests.expect_error($$insert into public.completions (streak_id, user_id, completed_date, source) values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', current_date - 2, 'manual')$$, 'completions_streak_owner_fk');

-- Deleting a streak removes its completions; deleting the account removes everything (§7.5, §11)
delete from public.streaks where id = 'aaaaaaaa-0000-0000-0000-000000000002';
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select tests.eq((select count(*)::int from public.streaks where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes streaks');
select tests.eq((select count(*)::int from public.completions where user_id = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes completions');
select tests.eq((select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 0, 'account deletion removes profile');

\echo 'ALL DATABASE TESTS PASSED'

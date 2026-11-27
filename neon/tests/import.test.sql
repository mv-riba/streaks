-- Checks neon/migrations/0002_import_my_data.sql after scripts/test-db.sh ran it with the
-- placeholders replaced by two test users.
\set ON_ERROR_STOP on
\set QUIET on
select tests.eq((select count(*)::int from public.streaks where user_id = '33333333-3333-3333-3333-333333333333'), 3, 'import: first account has 3 streaks');
select tests.eq((select count(*)::int from public.completions where user_id = '33333333-3333-3333-3333-333333333333'), 14, 'import: first account has 14 completions');
select tests.eq((select count(*)::int from public.streaks where user_id = '44444444-4444-4444-4444-444444444444'), 2, 'import: second account has 2 streaks');
select tests.eq((select count(*)::int from public.completions where user_id = '44444444-4444-4444-4444-444444444444'), 2, 'import: second account has 2 completions');
select tests.eq((select timezone || ' ' || email from public.profiles where id = '44444444-4444-4444-4444-444444444444'), 'Europe/Helsinki second@example.com', 'import: profile uses new email + old timezone');
select tests.eq((select count(*)::int from public.streaks where id = '4dec2b18-9435-46ee-bcb5-bbe7590d8f01'), 1, 'import: original streak ids kept');
select tests.eq((select count(*)::int from public.completions where id = '7d6c09f1-b05e-46fa-b390-a2ec3815a64d'), 1, 'import: original completion ids kept');

-- The imported user sees exactly their data through RLS.
set role authenticated;
select tests.login('33333333-3333-3333-3333-333333333333');
select tests.eq((select count(*)::int from public.streaks), 3, 'import: RLS shows the first account its 3 streaks');
select tests.eq((select count(*)::int from public.completions), 14, 'import: RLS shows the first account its 14 completions');
reset role;
\echo 'IMPORT TESTS PASSED'

-- Minimal stand-in for what Neon provides (Neon Auth's neon_auth."user", the Data API roles
-- and pg_session_jwt's auth.user_id()) so the migrations and RLS can be tested on plain
-- PostgreSQL. NOT used in production. Run as a superuser; migrations then run as the
-- non-superuser neondb_owner, like the Neon SQL Editor.
-- (neondb_owner and the neondb database it owns are created by scripts/test-db.sh.)
create role authenticated nologin;
create role anonymous nologin;
create role authenticator nologin;
grant authenticated, anonymous to authenticator;
grant authenticated, anonymous to neondb_owner; -- lets tests SET ROLE, as on Neon

-- Like Neon: schema auth is not owned by neondb_owner and `authenticated` has NO usage on it.
create schema auth;
grant usage on schema auth to neondb_owner;
create function auth.user_id() returns text language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')
$$;

create role neon_auth nologin;
create schema neon_auth authorization neon_auth;
create table neon_auth."user" (
  id              uuid primary key default gen_random_uuid(),
  name            text not null default '',
  email           text not null,
  "emailVerified" boolean not null default false,
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);
create table neon_auth.session (
  id       uuid primary key default gen_random_uuid(),
  "userId" uuid not null references neon_auth."user" (id) on delete cascade
);
alter table neon_auth."user" owner to neon_auth;
alter table neon_auth.session owner to neon_auth;
grant usage on schema neon_auth to neondb_owner;
grant select, delete, references on neon_auth."user" to neondb_owner;
grant select on neon_auth.session to neondb_owner;


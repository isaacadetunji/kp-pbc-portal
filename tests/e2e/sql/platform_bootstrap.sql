-- Platform objects a hosted Supabase project has before any app migration runs.
-- Applied by reset-db.sh BEFORE GoTrue's own migrations and supabase/tests/supabase_stubs.sql.
-- Local E2E only; never run against a real project.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists extensions;
create schema if not exists auth;      -- GoTrue creates its tables/functions here (auth migrate)
create schema if not exists storage;

grant usage on schema public, extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase's default privileges for objects created by `postgres` in public:
-- the API roles get everything, and migrations then REVOKE / GRANT narrowly.
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Supabase installs pgcrypto/uuid helpers in `extensions` and puts it on the search path.
alter database postgres set search_path = public, extensions;

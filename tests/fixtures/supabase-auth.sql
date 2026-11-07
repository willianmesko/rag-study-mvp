-- Local disposable PostgreSQL fixtures only. Supabase already provides these
-- roles and auth.uid(). Never apply this file to a hosted project.
DO $roles$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;
DO $fixture$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $sql$
      CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $uid$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $uid$
    $sql$;
  END IF;
END
$fixture$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

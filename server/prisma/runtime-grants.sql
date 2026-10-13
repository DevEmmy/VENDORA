-- Run once as the database administrator after migrate deploy. Configure the
-- actual runtime login as a member of vendora_runtime, never the migration owner.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vendora_runtime') THEN
    CREATE ROLE vendora_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA vendora TO vendora_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA vendora TO vendora_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA vendora TO vendora_runtime;
REVOKE ALL ON vendora.auth_audit_events FROM vendora_runtime;
GRANT INSERT ON vendora.auth_audit_events TO vendora_runtime;
-- Re-run this reviewed grant script after migrations add tables. No default DDL
-- or Supabase auth/storage grants are granted to the runtime role.

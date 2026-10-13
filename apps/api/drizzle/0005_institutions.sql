-- Phase 1: "school" becomes "institution" (school, chain, college, university, academy,
-- training centre). Renames only — every row is kept.
-- acadex:reviewed-destructive — the DROP CONSTRAINT statements below only replace CHECK
-- constraints whose allowed values are renamed in the same transaction; no data is dropped.
ALTER TABLE schools RENAME TO institutions;
--> statement-breakpoint
ALTER SEQUENCE schools_id_seq RENAME TO institutions_id_seq;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'school_id' LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN school_id TO institution_id', r.table_name);
  END LOOP;
  -- constraint names (unique / primary key constraints rename their index too)
  FOR r IN SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace AND conname LIKE '%school%' LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, replace(r.conname, 'school', 'institution'));
  END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%school%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, replace(r.indexname, 'school', 'institution'));
  END LOOP;
END $$;
--> statement-breakpoint
-- RLS: policies reference the function, so renaming it keeps them all working
ALTER FUNCTION app_school_id() RENAME TO app_institution_id;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_institution_id() RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.institution_id', true), '')::integer $$;
--> statement-breakpoint
-- primary role "school_admin" → "institution_admin"
ALTER TABLE users DROP CONSTRAINT users_role_check;
--> statement-breakpoint
UPDATE users SET role = 'institution_admin' WHERE role = 'school_admin';
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['super_admin'::text, 'institution_admin'::text, 'teacher'::text, 'student'::text, 'parent'::text]));
--> statement-breakpoint
-- role scope "school" → "institution"
ALTER TABLE roles DROP CONSTRAINT roles_scope_type_check;
--> statement-breakpoint
UPDATE roles SET scope_type = 'institution' WHERE scope_type = 'school';
--> statement-breakpoint
UPDATE roles SET key = 'institution_admin', name = 'Institution administrator' WHERE key = 'school_admin' AND institution_id IS NULL;
--> statement-breakpoint
ALTER TABLE roles ALTER COLUMN scope_type SET DEFAULT 'institution';
--> statement-breakpoint
ALTER TABLE roles ADD CONSTRAINT roles_scope_type_check CHECK (scope_type IN ('platform', 'institution'));
--> statement-breakpoint
ALTER TABLE user_roles DROP CONSTRAINT user_roles_scope_check;
--> statement-breakpoint
UPDATE user_roles SET scope_type = 'institution' WHERE scope_type = 'school';
--> statement-breakpoint
ALTER TABLE user_roles ADD CONSTRAINT user_roles_scope_check
  CHECK ((scope_type = 'platform' AND scope_id IS NULL) OR (scope_type = 'institution' AND scope_id IS NOT NULL));
--> statement-breakpoint
ALTER POLICY tenant_isolation ON user_roles
  USING (app_bypass_rls() OR (scope_type = 'institution' AND scope_id = app_institution_id()) OR user_id = app_user_id())
  WITH CHECK (app_bypass_rls() OR (scope_type = 'institution' AND scope_id = app_institution_id()));
--> statement-breakpoint
-- permission keys (role_permissions follows via ON UPDATE CASCADE)
UPDATE permissions SET key = 'institution.dashboard.read' WHERE key = 'school.dashboard.read';
--> statement-breakpoint
UPDATE permissions SET key = 'platform.institutions.read' WHERE key = 'platform.schools.read';
--> statement-breakpoint
UPDATE permissions SET key = 'platform.institutions.manage' WHERE key = 'platform.schools.manage';

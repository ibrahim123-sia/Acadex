-- Row-Level Security: a second safety net under the application's own tenant filters.
-- The API sets these transaction-local settings for every request (src/db/context.ts):
--   app.school_id  – the caller's school (empty = none)
--   app.user_id    – the caller's user id
--   app.bypass_rls – 'on' only for cross-tenant system work (auth lookups, platform staff,
--                    migrations, seed, background jobs)
-- With nothing set, tenant tables show no rows at all (fail closed).
CREATE OR REPLACE FUNCTION app_school_id() RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.school_id', true), '')::integer $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::integer $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  -- tables owned by exactly one school
  FOREACH t IN ARRAY ARRAY[
    'classes', 'subjects', 'teachers', 'students', 'teacher_subjects', 'timetable', 'exam_schedule',
    'assignments', 'submissions', 'grades', 'student_attendance', 'teacher_attendance',
    'tuition_fee', 'announcements', 'parent_children', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR school_id = app_school_id()) '
      'WITH CHECK (app_bypass_rls() OR school_id = app_school_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- the school row itself
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE schools FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON schools
  USING (app_bypass_rls() OR id = app_school_id())
  WITH CHECK (app_bypass_rls() OR id = app_school_id());
--> statement-breakpoint
-- accounts: members of the school, and your own row (platform staff have no school)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON users
  USING (app_bypass_rls() OR school_id = app_school_id() OR id = app_user_id())
  WITH CHECK (app_bypass_rls() OR school_id = app_school_id() OR id = app_user_id());
--> statement-breakpoint
-- notifications: the school's, plus your own (platform staff receive them without a school)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON notifications
  USING (app_bypass_rls() OR school_id = app_school_id() OR user_id = app_user_id())
  WITH CHECK (app_bypass_rls() OR school_id = app_school_id() OR user_id = app_user_id());
--> statement-breakpoint
-- roles: built-in roles are readable by everyone, writable by no tenant;
-- custom roles belong to one school
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_read ON roles FOR SELECT
  USING (app_bypass_rls() OR school_id IS NULL OR school_id = app_school_id());
--> statement-breakpoint
CREATE POLICY roles_write ON roles
  USING (app_bypass_rls() OR school_id = app_school_id())
  WITH CHECK (app_bypass_rls() OR school_id = app_school_id());
--> statement-breakpoint
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));
--> statement-breakpoint
CREATE POLICY role_permissions_write ON role_permissions
  USING (app_bypass_rls() OR EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.school_id = app_school_id()))
  WITH CHECK (app_bypass_rls() OR EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.school_id = app_school_id()));
--> statement-breakpoint
-- role assignments inside the school
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_roles
  USING (app_bypass_rls() OR (scope_type = 'school' AND scope_id = app_school_id()))
  WITH CHECK (app_bypass_rls() OR (scope_type = 'school' AND scope_id = app_school_id()));

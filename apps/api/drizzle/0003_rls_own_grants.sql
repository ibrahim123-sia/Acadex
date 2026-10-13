-- Users can read their own role assignments (e.g. platform staff, whose grants have no
-- school), so authentication can run inside the caller's own context without bypassing RLS.
DROP POLICY tenant_isolation ON user_roles;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON user_roles
  USING (app_bypass_rls() OR (scope_type = 'school' AND scope_id = app_school_id()) OR user_id = app_user_id())
  WITH CHECK (app_bypass_rls() OR (scope_type = 'school' AND scope_id = app_school_id()));

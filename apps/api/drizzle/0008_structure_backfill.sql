-- Phase 1, step 3: move existing data into the new structure, then tighten the schema.
-- acadex:reviewed-destructive — the dropped columns are copied first:
--   course_offerings.code/name → courses, students.guardian_name/phone → guardians,
--   guardianships.parent_user_id → guardians.user_id. Replaced CHECK constraints are
--   re-added (widened) in the same transaction.

-- campuses: every institution starts with its main campus
INSERT INTO campuses (institution_id, name, code, address, phone, is_main)
SELECT id, 'Main campus', 'MAIN', coalesce(address, ''), coalesce(phone, ''), true FROM institutions;
--> statement-breakpoint
UPDATE sections s SET campus_id = c.id FROM campuses c WHERE c.institution_id = s.institution_id AND c.is_main;
--> statement-breakpoint
UPDATE teachers t SET campus_id = c.id FROM campuses c WHERE c.institution_id = t.institution_id AND c.is_main;
--> statement-breakpoint
-- the current academic year (August–July) with one annual term
INSERT INTO academic_years (institution_id, name, starts_on, ends_on, status, is_current)
SELECT i.id, y.y || '–' || right((y.y + 1)::text, 2), make_date(y.y, 8, 1), make_date(y.y + 1, 7, 31), 'active', true
  FROM institutions i,
       LATERAL (SELECT CASE WHEN extract(month FROM current_date) >= 8 THEN extract(year FROM current_date)::int
                            ELSE extract(year FROM current_date)::int - 1 END AS y) y;
--> statement-breakpoint
INSERT INTO terms (institution_id, academic_year_id, name, kind, sequence, starts_on, ends_on, status)
SELECT institution_id, id, 'Annual', 'annual', 1, starts_on, ends_on, 'active' FROM academic_years;
--> statement-breakpoint
UPDATE sections s SET academic_year_id = ay.id FROM academic_years ay WHERE ay.institution_id = s.institution_id AND ay.is_current;
--> statement-breakpoint
-- default grading scheme
INSERT INTO grading_schemes (institution_id, name, kind, bands, pass_percent, is_default)
SELECT id, 'Letter grades', 'letter',
       '[{"min":90,"label":"A+","passed":true},{"min":80,"label":"A","passed":true},{"min":70,"label":"B","passed":true},{"min":60,"label":"C","passed":true},{"min":50,"label":"D","passed":true},{"min":40,"label":"E","passed":true},{"min":0,"label":"F","passed":false}]'::jsonb,
       40, true
  FROM institutions;
--> statement-breakpoint
-- one program whose levels are the existing class names, in the order they were created
INSERT INTO programs (institution_id, name, code)
SELECT i.id, 'General', 'GEN' FROM institutions i WHERE EXISTS (SELECT 1 FROM sections s WHERE s.institution_id = i.id);
--> statement-breakpoint
INSERT INTO program_levels (institution_id, program_id, name, sequence)
SELECT p.institution_id, p.id, x.name, row_number() OVER (PARTITION BY p.id ORDER BY x.first_id)
  FROM programs p
  JOIN (SELECT institution_id, name, min(id) AS first_id FROM sections GROUP BY institution_id, name) x
    ON x.institution_id = p.institution_id;
--> statement-breakpoint
UPDATE sections s SET program_level_id = l.id FROM program_levels l WHERE l.institution_id = s.institution_id AND l.name = s.name;
--> statement-breakpoint
-- course catalog: one course per distinct subject name
INSERT INTO courses (institution_id, code, name)
SELECT institution_id, base || CASE WHEN rn > 1 THEN rn::text ELSE '' END, name
  FROM (SELECT institution_id, name, base, row_number() OVER (PARTITION BY institution_id, base ORDER BY name) AS rn
          FROM (SELECT DISTINCT institution_id, name,
                       coalesce(upper(left(nullif(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'), ''), 6)), 'COURSE') AS base
                  FROM course_offerings) d) x;
--> statement-breakpoint
UPDATE course_offerings o SET course_id = c.id FROM courses c WHERE c.institution_id = o.institution_id AND c.name = o.name;
--> statement-breakpoint
UPDATE course_offerings o SET term_id = t.id
  FROM sections s JOIN terms t ON t.academic_year_id = s.academic_year_id
 WHERE s.id = o.section_id;
--> statement-breakpoint
UPDATE section_staff ss SET section_id = o.section_id FROM course_offerings o WHERE o.id = ss.offering_id AND ss.section_id IS NULL;
--> statement-breakpoint
-- guardians: parent accounts …
INSERT INTO guardians (institution_id, user_id, first_name, last_name, email)
SELECT u.institution_id, u.id, split_part(btrim(u.full_name), ' ', 1),
       btrim(substr(btrim(u.full_name), length(split_part(btrim(u.full_name), ' ', 1)) + 1)), u.email
  FROM users u WHERE u.role = 'parent' AND u.institution_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE guardianships ALTER COLUMN parent_user_id DROP NOT NULL;
--> statement-breakpoint
UPDATE guardianships g SET guardian_id = gd.id FROM guardians gd WHERE gd.user_id = g.parent_user_id;
--> statement-breakpoint
-- … and the guardian named on a student record without a linked account
INSERT INTO guardians (institution_id, first_name, last_name, phone, custom_data)
SELECT s.institution_id, split_part(btrim(s.guardian_name), ' ', 1),
       btrim(substr(btrim(s.guardian_name), length(split_part(btrim(s.guardian_name), ' ', 1)) + 1)),
       coalesce(s.guardian_phone, ''), jsonb_build_object('_backfill_student', s.id)
  FROM students s
 WHERE coalesce(btrim(s.guardian_name), '') <> ''
   AND NOT EXISTS (SELECT 1 FROM guardianships g WHERE g.student_id = s.id);
--> statement-breakpoint
INSERT INTO guardianships (institution_id, guardian_id, student_id, relationship, is_primary)
SELECT institution_id, id, (custom_data ->> '_backfill_student')::int, 'guardian', true
  FROM guardians WHERE custom_data ? '_backfill_student';
--> statement-breakpoint
UPDATE guardians SET custom_data = custom_data - '_backfill_student' WHERE custom_data ? '_backfill_student';
--> statement-breakpoint
UPDATE guardians gd SET phone = s.guardian_phone
  FROM guardianships g JOIN students s ON s.id = g.student_id
 WHERE g.guardian_id = gd.id AND gd.phone = '' AND coalesce(s.guardian_phone, '') <> '';
--> statement-breakpoint
UPDATE guardianships SET is_primary = true
 WHERE id IN (SELECT DISTINCT ON (student_id) id FROM guardianships ORDER BY student_id, id);
--> statement-breakpoint
-- permission keys follow the rename (role_permissions follows via ON UPDATE CASCADE)
UPDATE permissions SET key = 'sections.read' WHERE key = 'classes.read';
--> statement-breakpoint
UPDATE permissions SET key = 'sections.manage' WHERE key = 'classes.manage';
--> statement-breakpoint
-- role grants carry the institution they live in (RLS keys on it)
UPDATE user_roles SET institution_id = scope_id WHERE scope_type = 'institution';
--> statement-breakpoint
ALTER TABLE "guardianships" DROP CONSTRAINT "guardianships_parent_user_id_student_id_key";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_status_check";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_scope_type_check";--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_scope_check";--> statement-breakpoint
ALTER TABLE "guardianships" DROP CONSTRAINT "guardianships_parent_user_id_fkey";
--> statement-breakpoint
DROP INDEX "idx_pc_parent";--> statement-breakpoint
ALTER TABLE "course_offerings" ALTER COLUMN "course_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ALTER COLUMN "guardian_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guardianships_student" ON "guardianships" USING btree ("student_id");--> statement-breakpoint
ALTER TABLE "course_offerings" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "course_offerings" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "students" DROP COLUMN "guardian_name";--> statement-breakpoint
ALTER TABLE "students" DROP COLUMN "guardian_phone";--> statement-breakpoint
ALTER TABLE "guardianships" DROP COLUMN "parent_user_id";--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_guardian_id_student_id_key" UNIQUE("guardian_id","student_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" = ANY (ARRAY['super_admin'::text, 'group_admin'::text, 'institution_admin'::text, 'teacher'::text, 'student'::text, 'parent'::text]));--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_status_check" CHECK ("students"."status" IN ('active', 'inactive', 'graduated', 'left'));--> statement-breakpoint
ALTER TABLE "guardianships" ADD CONSTRAINT "guardianships_relationship_check" CHECK ("guardianships"."relationship" IN ('father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'));--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_scope_type_check" CHECK ("roles"."scope_type" IN ('platform', 'group', 'institution'));--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_scope_check" CHECK (("user_roles"."scope_type" = 'platform' AND "user_roles"."scope_id" IS NULL AND "user_roles"."institution_id" IS NULL) OR ("user_roles"."scope_type" = 'group' AND "user_roles"."scope_id" IS NOT NULL AND "user_roles"."institution_id" IS NULL) OR ("user_roles"."scope_type" IN ('institution', 'campus') AND "user_roles"."scope_id" IS NOT NULL AND "user_roles"."institution_id" IS NOT NULL));--> statement-breakpoint
-- ---------- Row-level security for the new tables ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'campuses', 'grading_schemes', 'departments', 'programs', 'program_levels', 'academic_years', 'terms',
    'holidays', 'courses', 'enrollments', 'student_promotions', 'guardians', 'student_medical',
    'custom_fields', 'person_documents', 'id_cards', 'document_templates', 'issued_documents',
    'import_jobs', 'files'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR institution_id = app_institution_id()) '
      'WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- groups: an institution may read its own group; only platform work writes them
ALTER TABLE institution_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE institution_groups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY group_read ON institution_groups FOR SELECT
  USING (app_bypass_rls() OR id = (SELECT i.group_id FROM institutions i WHERE i.id = app_institution_id()));
--> statement-breakpoint
CREATE POLICY group_write ON institution_groups USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
--> statement-breakpoint
-- role grants: institution and campus grants live in their institution
ALTER POLICY tenant_isolation ON user_roles
  USING (app_bypass_rls() OR institution_id = app_institution_id() OR user_id = app_user_id())
  WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id());
--> statement-breakpoint
-- ---------- Soft delete ----------
-- Deleted rows are invisible to every query unless the request explicitly opts in
-- (app.include_deleted = 'on': the recycle bin, restore, and the delete itself).
CREATE OR REPLACE FUNCTION app_include_deleted() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.include_deleted', true), '') = 'on' $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'campuses', 'departments', 'programs', 'sections', 'courses', 'teachers', 'students', 'guardians',
    'person_documents', 'files'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY hide_deleted ON %I AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL OR app_include_deleted())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- ---------- Audit trail ----------
-- Every change to the listed tables writes who changed what. Restricted tables record only
-- which fields changed, never the values; ignored columns (secrets, bookkeeping) never appear.
CREATE OR REPLACE FUNCTION acadex_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_j jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_j jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  masked boolean := TG_NARGS > 0 AND TG_ARGV[0] = 'masked';
  ignored text[] := CASE WHEN TG_NARGS > 1 THEN string_to_array(TG_ARGV[1], ',') ELSE ARRAY[]::text[] END;
  diff jsonb := '{}'::jsonb;
  k text;
  act text;
  inst integer;
BEGIN
  IF coalesce(current_setting('app.audit', true), '') = 'off' THEN
    RETURN NULL;
  END IF;
  ignored := ignored || ARRAY['updated_at'];
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(new_j) LOOP
      IF NOT (k = ANY (ignored)) AND (old_j -> k) IS DISTINCT FROM (new_j -> k) THEN
        diff := diff || jsonb_build_object(k, CASE WHEN masked THEN '"changed"'::jsonb ELSE jsonb_build_array(old_j -> k, new_j -> k) END);
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
    act := CASE
      WHEN old_j ? 'deleted_at' AND old_j ->> 'deleted_at' IS NULL AND new_j ->> 'deleted_at' IS NOT NULL THEN 'delete'
      WHEN old_j ? 'deleted_at' AND old_j ->> 'deleted_at' IS NOT NULL AND new_j ->> 'deleted_at' IS NULL THEN 'restore'
      ELSE 'update' END;
  ELSIF TG_OP = 'INSERT' THEN
    act := 'create';
    diff := NULL;
  ELSE
    act := 'purge';
    diff := NULL;
  END IF;
  inst := CASE WHEN TG_TABLE_NAME = 'institutions' THEN coalesce(new_j ->> 'id', old_j ->> 'id')::int
               ELSE coalesce(new_j ->> 'institution_id', old_j ->> 'institution_id')::int END;
  INSERT INTO audit_log (institution_id, user_id, actor, action, entity, entity_id, changes, request_id, detail)
  VALUES (inst, app_user_id(), '', act, TG_TABLE_NAME,
          coalesce(new_j ->> 'id', old_j ->> 'id', new_j ->> 'student_id', old_j ->> 'student_id'),
          diff, nullif(current_setting('app.request_id', true), ''), '');
  RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'institutions', 'campuses', 'departments', 'programs', 'program_levels', 'academic_years', 'terms',
    'holidays', 'grading_schemes', 'sections', 'courses', 'course_offerings', 'section_staff', 'enrollments',
    'teachers', 'students', 'guardians', 'guardianships', 'custom_fields', 'person_documents', 'id_cards',
    'document_templates', 'issued_documents', 'roles', 'user_roles', 'tuition_fee', 'student_promotions'
  ] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acadex_audit()', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON student_medical
  FOR EACH ROW EXECUTE FUNCTION acadex_audit('masked');
--> statement-breakpoint
CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION acadex_audit('full', 'password_hash,token_version,last_login_at');

-- Phase 2, step 3: move the old assignments, submissions, marks, day attendance and timetable
-- into the LMS model, then drop the legacy tables.
-- acadex:reviewed-destructive — every legacy table is copied below before it is dropped; the
-- two _legacy columns are temporary mapping helpers added and removed in this migration.

ALTER TABLE assessments ADD COLUMN _legacy_assignment integer, ADD COLUMN _legacy_key text;
--> statement-breakpoint
-- old assignments → assessments (due at 23:59 in the institution's timezone)
INSERT INTO assessments (institution_id, offering_id, kind, title, instructions_html, points, due_at, status, position, created_by, created_at, _legacy_assignment)
SELECT a.institution_id,
       COALESCE(a.offering_id, (SELECT o.id FROM course_offerings o WHERE o.section_id = a.section_id ORDER BY o.id LIMIT 1)),
       'assignment', a.title,
       CASE WHEN coalesce(a.description, '') = '' THEN ''
            ELSE '<p>' || replace(replace(replace(a.description, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' END,
       100,
       CASE WHEN a.due_date IS NULL THEN NULL ELSE (a.due_date + time '23:59') AT TIME ZONE i.timezone END,
       'published', a.id,
       (SELECT u.id FROM users u WHERE u.role = 'teacher' AND u.ref_id = a.teacher_id AND u.institution_id = a.institution_id LIMIT 1),
       coalesce(a.created_at, now()), a.id
  FROM legacy_assignments a JOIN institutions i ON i.id = a.institution_id
 WHERE COALESCE(a.offering_id, (SELECT o.id FROM course_offerings o WHERE o.section_id = a.section_id ORDER BY o.id LIMIT 1)) IS NOT NULL;
--> statement-breakpoint
-- old submissions → submissions with one version each
INSERT INTO submissions (institution_id, assessment_id, student_id, attempt, status, submitted_at, created_at, updated_at)
SELECT DISTINCT ON (n.id, s.student_id) s.institution_id, n.id, s.student_id, 1, 'submitted', s.submitted_date,
       coalesce(s.submitted_date, now()), coalesce(s.submitted_date, now())
  FROM legacy_submissions s JOIN assessments n ON n._legacy_assignment = s.assignment_id
 ORDER BY n.id, s.student_id, s.id DESC;
--> statement-breakpoint
INSERT INTO submission_versions (institution_id, submission_id, version, text_html, link_url, created_at)
SELECT DISTINCT ON (sub.id) sub.institution_id, sub.id, 1,
       CASE WHEN coalesce(ls.title, '') = '' THEN ''
            ELSE '<p>' || replace(replace(replace(ls.title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>' END,
       coalesce(ls.file_link, ''), sub.created_at
  FROM submissions sub JOIN assessments n ON n.id = sub.assessment_id
  JOIN legacy_submissions ls ON ls.assignment_id = n._legacy_assignment AND ls.student_id = sub.student_id
 ORDER BY sub.id, ls.id DESC;
--> statement-breakpoint
-- letter grades written on old submissions become released feedback
INSERT INTO grades (institution_id, assessment_id, student_id, feedback_html, status, graded_at, released_at)
SELECT DISTINCT ON (n.id, ls.student_id) ls.institution_id, n.id, ls.student_id,
       '<p>Grade: ' || replace(replace(replace(ls.grade, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>', 'released', now(), now()
  FROM legacy_submissions ls JOIN assessments n ON n._legacy_assignment = ls.assignment_id
 WHERE coalesce(ls.grade, '') <> ''
 ORDER BY n.id, ls.student_id, ls.id DESC;
--> statement-breakpoint
-- old marks → a category per assessment type, an assessment per test, and released grades
INSERT INTO grade_categories (institution_id, offering_id, name)
SELECT DISTINCT g.institution_id, g.offering_id, initcap(g.assignment_type)
  FROM legacy_grades g WHERE g.offering_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO assessments (institution_id, offering_id, category_id, kind, title, points, status, release_mode, grades_released_at, _legacy_key)
SELECT DISTINCT ON (k.key) g.institution_id, g.offering_id, c.id,
       CASE lower(g.assignment_type) WHEN 'quiz' THEN 'quiz' WHEN 'assignment' THEN 'assignment' WHEN 'project' THEN 'project' ELSE 'exam' END,
       g.assignment_name, g.total_marks, 'published', 'manual', now(), k.key
  FROM legacy_grades g
  JOIN grade_categories c ON c.offering_id = g.offering_id AND c.name = initcap(g.assignment_type)
  CROSS JOIN LATERAL (SELECT g.offering_id || '|' || g.assignment_name || '|' || g.assignment_type || '|' || g.total_marks AS key) k
 WHERE g.offering_id IS NOT NULL
 ORDER BY k.key, g.id;
--> statement-breakpoint
INSERT INTO grades (institution_id, assessment_id, student_id, points, status, graded_at, released_at, updated_at)
SELECT DISTINCT ON (a.id, g.student_id) g.institution_id, a.id, g.student_id, g.obtained_marks, 'released',
       coalesce(g.created_at, now()), coalesce(g.created_at, now()), coalesce(g.created_at, now())
  FROM legacy_grades g
  JOIN assessments a ON a._legacy_key = g.offering_id || '|' || g.assignment_name || '|' || g.assignment_type || '|' || g.total_marks
 ORDER BY a.id, g.student_id, g.id DESC;
--> statement-breakpoint
-- day attendance → one 'day' session per section and date
INSERT INTO attendance_sessions (institution_id, section_id, date, kind)
SELECT DISTINCT institution_id, section_id, att_date, 'day' FROM legacy_student_attendance WHERE section_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO attendance_records (session_id, student_id, institution_id, status, method)
SELECT DISTINCT ON (s.id, a.student_id) s.id, a.student_id, a.institution_id, lower(a.status), 'import'
  FROM legacy_student_attendance a
  JOIN attendance_sessions s ON s.section_id = a.section_id AND s.date = a.att_date AND s.offering_id IS NULL AND s.period_id IS NULL
 ORDER BY s.id, a.student_id, a.id DESC;
--> statement-breakpoint
-- the free-text timetable → a bell schedule (periods) and slots
INSERT INTO periods (institution_id, name, starts_at, ends_at, position)
SELECT institution_id, 'Period ' || row_number() OVER w, st, en, row_number() OVER w
  FROM (SELECT DISTINCT institution_id, split_part(time_slot, '-', 1)::time AS st, split_part(time_slot, '-', 2)::time AS en
          FROM legacy_timetable WHERE time_slot ~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$') x
WINDOW w AS (PARTITION BY institution_id ORDER BY st);
--> statement-breakpoint
INSERT INTO timetable_slots (institution_id, term_id, section_id, offering_id, teacher_id, weekday, period_id)
SELECT DISTINCT ON (t.section_id, t.wd, p.id) t.institution_id,
       (SELECT tm.id FROM terms tm JOIN sections s ON s.academic_year_id = tm.academic_year_id WHERE s.id = t.section_id
         ORDER BY (tm.status = 'active') DESC, tm.starts_on LIMIT 1),
       t.section_id,
       (SELECT o.id FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.section_id = t.section_id AND lower(c.name) = lower(t.subject) LIMIT 1),
       t.teacher_id, t.wd, p.id
  FROM (SELECT lt.*, array_position(ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], initcap(lt.day_of_week)) - 1 AS wd,
               split_part(lt.time_slot, '-', 1)::time AS st, split_part(lt.time_slot, '-', 2)::time AS en
          FROM legacy_timetable lt WHERE lt.time_slot ~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$') t
  JOIN periods p ON p.institution_id = t.institution_id AND p.starts_at = t.st AND p.ends_at = t.en AND p.campus_id IS NULL
 WHERE t.wd IS NOT NULL
 ORDER BY t.section_id, t.wd, p.id, t.id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE assessments DROP COLUMN _legacy_assignment, DROP COLUMN _legacy_key;
--> statement-breakpoint
DROP TABLE "legacy_timetable" CASCADE;--> statement-breakpoint
DROP TABLE "legacy_assignments" CASCADE;--> statement-breakpoint
DROP TABLE "legacy_grades" CASCADE;--> statement-breakpoint
DROP TABLE "legacy_submissions" CASCADE;--> statement-breakpoint
DROP TABLE "legacy_student_attendance" CASCADE;--> statement-breakpoint
-- ---------- Row-level security for the LMS tables ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'course_blueprints', 'modules', 'content_items', 'content_progress', 'live_sessions', 'scorm_packages',
    'grade_categories', 'rubrics', 'rubric_criteria', 'group_sets', 'student_groups', 'group_members',
    'assessments', 'assessment_extensions', 'accommodations', 'submissions', 'submission_versions',
    'submission_annotations', 'peer_reviews', 'question_banks', 'questions', 'assessment_questions',
    'quiz_attempts', 'attempt_answers', 'attempt_events', 'grades', 'grade_history', 'final_grade_overrides',
    'rooms', 'periods', 'timetable_slots', 'teacher_unavailability', 'substitutions', 'attendance_sessions',
    'attendance_records', 'leave_requests', 'live_joins', 'discussions', 'discussion_posts', 'polls',
    'poll_votes', 'surveys', 'survey_responses', 'badges', 'badge_awards', 'points_ledger',
    'certificate_templates', 'certificates', 'scorm_attempts', 'xapi_statements', 'content_imports'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR institution_id = app_institution_id()) '
      'WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id())', t);
  END LOOP;
  -- personal settings belong to their person
  FOREACH t IN ARRAY ARRAY['notification_preferences', 'push_subscriptions', 'delivery_logs', 'calendar_feeds'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY owner_only ON %I USING (app_bypass_rls() OR user_id = app_user_id()) '
      'WITH CHECK (app_bypass_rls() OR user_id = app_user_id())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['course_blueprints', 'content_items', 'assessments', 'question_banks', 'questions', 'discussions'] LOOP
    EXECUTE format(
      'CREATE POLICY hide_deleted ON %I AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL OR app_include_deleted())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY[
    'course_blueprints', 'modules', 'content_items', 'grade_categories', 'rubrics', 'assessments',
    'assessment_extensions', 'grades', 'final_grade_overrides', 'question_banks', 'rooms', 'periods',
    'timetable_slots', 'substitutions', 'attendance_records', 'leave_requests', 'live_sessions',
    'discussions', 'certificates', 'surveys'
  ] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acadex_audit()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- accommodations are sensitive: the audit trail records which fields changed, not the values
CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON accommodations
  FOR EACH ROW EXECUTE FUNCTION acadex_audit('masked');

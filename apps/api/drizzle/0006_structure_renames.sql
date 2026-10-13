-- Phase 1, step 1 of the academic structure: renames only (every row is kept).
--   classes          → sections          (a teaching group: a class, a batch, a cohort)
--   subjects         → course_offerings  (a course taught to a section / in a term)
--   teacher_subjects → section_staff     (who teaches it: teacher, co-teacher, TA)
--   parent_children  → guardianships
--   class_id → section_id, subject_id → offering_id, classes.section → sections.label
CREATE FUNCTION pg_temp.acadex_rename(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(n,
    'teacher_subjects', 'section_staff'),
    'parent_children', 'guardianships'),
    'subjects', 'course_offerings'),
    'classes', 'sections'),
    'class_id', 'section_id'),
    'subject_id', 'offering_id'),
    'idx_students_class', 'idx_students_section')
$$;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  -- columns first (constraint definitions follow automatically)
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name IN ('class_id', 'subject_id') LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', r.table_name, r.column_name, pg_temp.acadex_rename(r.column_name));
  END LOOP;
  ALTER TABLE classes RENAME COLUMN section TO label;
  ALTER TABLE classes RENAME TO sections;
  ALTER TABLE subjects RENAME TO course_offerings;
  ALTER TABLE teacher_subjects RENAME TO section_staff;
  ALTER TABLE parent_children RENAME TO guardianships;
  FOR r IN SELECT c.relname FROM pg_class c
            WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
              AND c.relname IN ('classes_id_seq', 'subjects_id_seq', 'teacher_subjects_id_seq', 'parent_children_id_seq') LOOP
    EXECUTE format('ALTER SEQUENCE %I RENAME TO %I', r.relname, pg_temp.acadex_rename(r.relname));
  END LOOP;
  FOR r IN SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace AND pg_temp.acadex_rename(conname) <> conname LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, pg_temp.acadex_rename(r.conname));
  END LOOP;
  FOR r IN SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public' AND pg_temp.acadex_rename(indexname) <> indexname LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, pg_temp.acadex_rename(r.indexname));
  END LOOP;
END $$;

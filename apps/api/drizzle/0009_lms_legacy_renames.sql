-- Phase 2, step 1: the tables the LMS replaces are renamed legacy_* (their names go to the new
-- tables). Migration 0011 moves their rows into the new model and drops them.
DO $$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['assignments', 'submissions', 'grades', 'student_attendance', 'timetable'] LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I', t, 'legacy_' || t);
    EXECUTE format('ALTER SEQUENCE IF EXISTS %I RENAME TO %I', t || '_id_seq', 'legacy_' || t || '_id_seq');
    FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = ('public.legacy_' || t)::regclass AND conname LIKE t || '\_%' LOOP
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', 'legacy_' || t, r.conname, 'legacy_' || r.conname);
    END LOOP;
  END LOOP;
  ALTER INDEX IF EXISTS idx_grades_institution RENAME TO legacy_idx_grades_institution;
  ALTER INDEX IF EXISTS idx_satt_institution RENAME TO legacy_idx_satt_institution;
END $$;

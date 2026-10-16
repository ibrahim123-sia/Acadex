-- Phase 3: the old fee records become invoices with payments, and the old free-text exam
-- schedule becomes exam series with papers; then the two legacy tables are dropped.
-- acadex:reviewed-destructive — tuition_fee and exam_schedule are copied below before the drop.

ALTER TABLE invoices ADD COLUMN _legacy_fee integer;
--> statement-breakpoint
INSERT INTO invoices (institution_id, number, student_id, title, issue_date, due_date, status, currency, total, paid, _legacy_fee, created_at)
SELECT f.institution_id, 'INV-' || lpad(f.id::text, 6, '0'), f.student_id, 'Tuition fee',
       COALESCE(f.created_at::date, f.payment_date, CURRENT_DATE), COALESCE(f.payment_date, f.created_at::date, CURRENT_DATE),
       CASE WHEN f.remaining_balance <= 0 THEN 'paid' WHEN f.paid_amount > 0 THEN 'partially_paid' ELSE 'issued' END,
       i.currency, f.total_fee, f.paid_amount, f.id, COALESCE(f.created_at, now())
  FROM tuition_fee f JOIN institutions i ON i.id = f.institution_id;
--> statement-breakpoint
INSERT INTO invoice_items (institution_id, invoice_id, kind, head, label, amount)
SELECT institution_id, id, 'fee', 'Tuition', 'Tuition fee', total FROM invoices WHERE _legacy_fee IS NOT NULL;
--> statement-breakpoint
INSERT INTO payments (institution_id, invoice_id, student_id, receipt_no, amount, method, status, received_at)
SELECT n.institution_id, n.id, n.student_id, f.receipt_id, f.paid_amount, 'cash', 'succeeded',
       COALESCE(f.payment_date::timestamptz, f.created_at, now())
  FROM invoices n JOIN tuition_fee f ON f.id = n._legacy_fee
 WHERE f.paid_amount > 0;
--> statement-breakpoint
ALTER TABLE invoices DROP COLUMN _legacy_fee;
--> statement-breakpoint
-- one series per exam name, one paper per course found in the section
INSERT INTO exam_series (institution_id, name, kind, status)
SELECT DISTINCT institution_id, exam_name, 'other', 'scheduled' FROM exam_schedule;
--> statement-breakpoint
INSERT INTO exam_sessions (institution_id, series_id, offering_id, date, starts_at, ends_at, total_marks, pass_marks)
SELECT DISTINCT ON (s.id, o.id) e.institution_id, s.id, o.id, e.exam_date,
       CASE WHEN e.time_slot ~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$' THEN split_part(e.time_slot, '-', 1)::time ELSE '09:00'::time END,
       CASE WHEN e.time_slot ~ '^\d{1,2}:\d{2}-\d{1,2}:\d{2}$' THEN split_part(e.time_slot, '-', 2)::time ELSE '12:00'::time END,
       COALESCE(e.total_marks, 100), round(COALESCE(e.total_marks, 100) * 0.33)
  FROM exam_schedule e
  JOIN exam_series s ON s.institution_id = e.institution_id AND s.name = e.exam_name
  JOIN course_offerings o ON o.section_id = e.section_id
  JOIN courses c ON c.id = o.course_id AND lower(c.name) = lower(e.subject)
 ORDER BY s.id, o.id, e.id;
--> statement-breakpoint
DROP TABLE "exam_schedule" CASCADE;--> statement-breakpoint
DROP TABLE "tuition_fee" CASCADE;--> statement-breakpoint
-- ---------- Row-level security, audit ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fee_structures', 'fee_structure_items', 'fee_installments', 'discounts', 'student_discounts', 'invoices',
    'invoice_items', 'payments', 'refunds', 'checkout_sessions', 'reconciliations', 'expenses',
    'exam_series', 'exam_sessions', 'exam_seats', 'invigilator_duties', 'exam_marks', 'exam_moderations',
    'admit_cards', 'learning_outcomes', 'outcome_mappings', 'outcome_alignments',
    'admission_forms', 'applications', 'application_documents', 'enquiries', 'enquiry_followups'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR institution_id = app_institution_id()) '
      'WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id())', t);
  END LOOP;
  -- provider events arrive before the institution is known: platform work only
  ALTER TABLE payment_provider_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE payment_provider_events FORCE ROW LEVEL SECURITY;
  CREATE POLICY system_only ON payment_provider_events USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
  FOREACH t IN ARRAY ARRAY[
    'fee_structures', 'discounts', 'student_discounts', 'invoices', 'invoice_items', 'payments', 'refunds', 'expenses',
    'exam_series', 'exam_sessions', 'exam_marks', 'admit_cards', 'learning_outcomes', 'admission_forms', 'applications', 'enquiries'
  ] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acadex_audit()', t);
  END LOOP;
END $$;

// Fee summaries that other screens show (dashboards, directories, portals), computed from
// invoices. Drafts and cancelled invoices don't count.

/** Invoices that count: issued, partly or fully paid. */
export const LIVE_INVOICE = `status IN ('issued', 'partially_paid', 'paid')`;

/** The old-style label of an invoice's status (Paid / Partial / Pending). */
export const invoiceLabel = (alias: string) =>
  `CASE ${alias}.status WHEN 'paid' THEN 'Paid' WHEN 'partially_paid' THEN 'Partial' ELSE 'Pending' END`;

/** One student's fee standing as a label ('—' when they have no invoices). `student` is a SQL expression. */
export const feeStatusSql = (student: string) =>
  `COALESCE((SELECT CASE WHEN sum(f.total - f.paid) <= 0 THEN 'Paid' WHEN bool_or(f.due_date < CURRENT_DATE AND f.total > f.paid) THEN 'Overdue'
                         WHEN sum(f.paid) > 0 THEN 'Partial' ELSE 'Pending' END
               FROM invoices f WHERE f.student_id = ${student} AND f.${LIVE_INVOICE}), '—')`;

/** A student's totals: what was billed, paid, still owed, the next due date and whether anything is overdue. */
export const FEE_TOTALS_SQL = `
  SELECT COALESCE(sum(f.total), 0) AS total_fee, COALESCE(sum(f.paid), 0) AS paid_amount, COALESCE(sum(f.total - f.paid), 0) AS remaining_balance,
         CASE WHEN count(*) = 0 THEN NULL WHEN sum(f.total - f.paid) <= 0 THEN 'Paid'
              WHEN bool_or(f.due_date < CURRENT_DATE AND f.total > f.paid) THEN 'Overdue' WHEN sum(f.paid) > 0 THEN 'Partial' ELSE 'Pending' END AS payment_status,
         min(f.due_date) FILTER (WHERE f.total > f.paid) AS next_due_date,
         (SELECT p.receipt_no FROM payments p WHERE p.student_id = $1 ORDER BY p.received_at DESC, p.id DESC LIMIT 1) AS receipt_id,
         count(*)::int AS invoices
    FROM invoices f WHERE f.student_id = $1 AND f.institution_id = $2 AND f.${LIVE_INVOICE}`;

/** Whether this institution shows fees to students themselves (guardians are governed by their link). */
export const SHOW_TO_STUDENTS_SQL = `SELECT COALESCE((settings->'fees'->>'show_to_students')::boolean, true) AS show FROM institutions WHERE id = $1`;

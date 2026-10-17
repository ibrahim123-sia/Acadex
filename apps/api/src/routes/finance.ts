// Fees and finance under /api/finance: fee structures (heads, instalments, late fines),
// discounts and scholarships, invoices (generated from a structure, or one-off), payments at
// the counter and online, refunds and waivers, statements, defaulters and reminders,
// reconciliation with providers and bank statements, expenses, reports and accounting exports.
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  adhocInvoiceBody,
  cancelInvoiceBody,
  checkoutBody,
  discountBody,
  expenseBody,
  feeSettingsBody,
  feeStructureBody,
  generateInvoicesBody,
  id,
  invoiceLineBody,
  invoiceQuery,
  isoDate,
  optionalId,
  patchSchema,
  paymentAccountBody,
  paymentBody,
  periodQuery,
  reconcileBody,
  refundBody,
  reminderBody,
  studentDiscountBody,
  waiverBody,
  PAYMENT_PROVIDERS,
} from '@acadex/shared';
import { getConfig } from '../config';
import { db, withTransaction } from '../db/context';
import { assertCanViewStudent, assertInInstitution } from '../lib/access';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { sendTable } from '../lib/export';
import { balanceOf, createAdhocInvoice, createInvoices, loadAccount, loadInvoice, planInvoices, recalcInvoice, reconcile, recordPayment, refundPayment, round2, sealSecrets } from '../lib/finance/ledger';
import { startCheckout } from '../lib/finance/checkout';
import { sendReceiptPdf, sendVoucherPdf } from '../lib/finance/pdf';
import { PROVIDERS, PROVIDER_SECRETS, type ProviderName, type Settlement } from '../lib/finance/providers';
import { feeSettings, remindNow } from '../lib/finance/reminders';
import { mapHeaders, parseDate, readRows, rowObject } from '../lib/import-parse';
import { institutionTimeZone } from '../lib/institution';
import { todayIn } from '../lib/locale';
import { parsePage, sendPage } from '../lib/pagination';
import { isUniqueViolation } from '../lib/structure';
import { oneFile, requireFile } from '../lib/upload';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';
import { decryptSecret } from '../auth/crypto';

const router = Router();
const setup = requirePermission('fees.setup');
const reports = requirePermission('finance.reports');
const readFees = requireAny('fees.read', 'finance.reports');

const auditAs = (req: Request, action: string, entity: string, detail: string) =>
  audit({ institutionId: institutionId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity, detail });
const today = async (req: Request) => todayIn(await institutionTimeZone(institutionId(req)));

/**
 * Who may see a student's fees: finance staff; the student (unless the institution hides fees
 * from students); a guardian whose link allows fees. Teachers never.
 */
export async function assertCanSeeFees(req: Request, studentId: number) {
  if (userCan(req, 'fees.read')) return;
  const u = currentUser(req);
  await assertCanViewStudent(u, studentId, { allowTeachers: false, guardian: 'fees' });
  if (u.role === 'student') {
    const { rows } = await db.query<{ show: boolean }>(`SELECT COALESCE((settings->'fees'->>'show_to_students')::boolean, true) AS show FROM institutions WHERE id = $1`, [institutionId(req)]);
    if (!rows[0]?.show) throw forbidden('Fees are shared with your guardians');
  }
}

async function invoiceFor(req: Request, invoiceId: number) {
  const inv = await loadInvoice(invoiceId, institutionId(req));
  if (inv.student_id) await assertCanSeeFees(req, inv.student_id);
  else if (!userCan(req, 'fees.read')) throw notFound('Invoice not found');
  return inv;
}

// ---------------------------------------------------------------- fee structures

router.get('/finance/structures', readFees, async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, ay.name AS academic_year, c.name AS campus, p.name AS program, pl.name AS level,
            (SELECT COALESCE(sum(amount), 0) FROM fee_structure_items i WHERE i.structure_id = s.id AND i.frequency = 'per_installment') AS per_installment,
            (SELECT COALESCE(sum(amount), 0) FROM fee_structure_items i WHERE i.structure_id = s.id AND i.frequency = 'once') AS one_time,
            (SELECT count(*)::int FROM fee_installments i WHERE i.structure_id = s.id) AS installments,
            (SELECT count(*)::int FROM invoices v WHERE v.structure_id = s.id AND v.status <> 'cancelled') AS invoices
       FROM fee_structures s LEFT JOIN academic_years ay ON ay.id = s.academic_year_id LEFT JOIN campuses c ON c.id = s.campus_id
       LEFT JOIN programs p ON p.id = s.program_id LEFT JOIN program_levels pl ON pl.id = s.program_level_id
      WHERE s.institution_id = $1 ORDER BY s.active DESC, s.created_at DESC`,
    [institutionId(req)]
  );
  res.json(rows);
});

async function structureDetail(structureId: number, inst: number) {
  const { rows } = await db.query(`SELECT * FROM fee_structures WHERE id = $1 AND institution_id = $2`, [structureId, inst]);
  if (!rows[0]) throw notFound('Fee structure not found');
  const [items, insts] = await Promise.all([
    db.query(`SELECT id, head, amount, frequency, position FROM fee_structure_items WHERE structure_id = $1 ORDER BY position, id`, [structureId]),
    db.query(
      `SELECT f.id, f.label, f.due_date, f.issue_date, f.position, (SELECT count(*)::int FROM invoices v WHERE v.installment_id = f.id AND v.status <> 'cancelled') AS invoices
         FROM fee_installments f WHERE f.structure_id = $1 ORDER BY f.position, f.due_date`,
      [structureId]
    ),
  ]);
  return { ...rows[0], items: items.rows, installments: insts.rows };
}

router.get('/finance/structures/:id', readFees, async (req, res) => {
  res.json(await structureDetail(id.parse(req.params.id), institutionId(req)));
});

async function saveStructure(req: Request, structureId: number | null) {
  const b = feeStructureBody.parse(req.body);
  const s = institutionId(req);
  if (b.academic_year_id) await assertInInstitution('academic_years', b.academic_year_id, s);
  if (b.campus_id) await assertInInstitution('campuses', b.campus_id, s);
  if (b.program_id) await assertInInstitution('programs', b.program_id, s);
  if (b.program_level_id) await assertInInstitution('program_levels', b.program_level_id, s);
  return withTransaction(async () => {
    const params = [s, b.name, b.academic_year_id, b.campus_id, b.program_id, b.program_level_id, JSON.stringify(b.late_fine), b.active];
    let sid = structureId;
    if (sid == null) {
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO fee_structures (institution_id, name, academic_year_id, campus_id, program_id, program_level_id, late_fine, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        params
      );
      sid = rows[0]!.id;
    } else {
      const { rowCount } = await db.query(
        `UPDATE fee_structures SET name = $2, academic_year_id = $3, campus_id = $4, program_id = $5, program_level_id = $6, late_fine = $7, active = $8 WHERE id = $9 AND institution_id = $1`,
        [...params, sid]
      );
      if (!rowCount) throw notFound('Fee structure not found');
    }
    // heads are replaced (invoices keep their own copies of the lines)
    await db.query(`DELETE FROM fee_structure_items WHERE structure_id = $1`, [sid]);
    for (const [i, it] of b.items.entries()) {
      await db.query(`INSERT INTO fee_structure_items (institution_id, structure_id, head, amount, frequency, position) VALUES ($1,$2,$3,$4,$5,$6)`, [s, sid, it.head, it.amount, it.frequency, i]);
    }
    // instalments are kept by id (invoices point at them); ones left out are removed if unused
    const keep: number[] = [];
    for (const [i, inst] of b.installments.entries()) {
      if (inst.id) {
        const { rowCount } = await db.query(`UPDATE fee_installments SET label = $3, due_date = $4, issue_date = $5, position = $6 WHERE id = $1 AND structure_id = $2`, [
          inst.id, sid, inst.label, inst.due_date, inst.issue_date, i,
        ]);
        if (!rowCount) throw badRequest('Unknown instalment', { installments: inst.id });
        keep.push(inst.id);
      } else {
        const { rows } = await db.query<{ id: number }>(`INSERT INTO fee_installments (institution_id, structure_id, label, due_date, issue_date, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [
          s, sid, inst.label, inst.due_date, inst.issue_date, i,
        ]);
        keep.push(rows[0]!.id);
      }
    }
    const { rows: used } = await db.query(
      `SELECT f.label FROM fee_installments f WHERE f.structure_id = $1 AND NOT (f.id = ANY($2::int[])) AND EXISTS (SELECT 1 FROM invoices v WHERE v.installment_id = f.id AND v.status <> 'cancelled')`,
      [sid, keep]
    );
    if (used.length) throw conflict(`Instalments with invoices can't be removed: ${used.map((u) => u.label).join(', ')}`, 'IN_USE');
    await db.query(`DELETE FROM fee_installments WHERE structure_id = $1 AND NOT (id = ANY($2::int[]))`, [sid, keep]);
    return structureDetail(sid, s);
  });
}

router.post('/finance/structures', setup, async (req, res) => {
  const out = await saveStructure(req, null);
  await auditAs(req, 'create', 'FeeStructure', out.name);
  res.status(201).json(out);
});

router.put('/finance/structures/:id', setup, async (req, res) => {
  const out = await saveStructure(req, id.parse(req.params.id));
  await auditAs(req, 'update', 'FeeStructure', out.name);
  res.json(out);
});

router.delete('/finance/structures/:id', setup, async (req, res) => {
  const sid = id.parse(req.params.id);
  const { rows } = await db.query(`SELECT count(*)::int n FROM invoices WHERE structure_id = $1 AND institution_id = $2 AND status <> 'cancelled'`, [sid, institutionId(req)]);
  if (rows[0].n) throw conflict('This structure has invoices; turn it off instead', 'IN_USE');
  const { rowCount } = await db.query(`DELETE FROM fee_structures WHERE id = $1 AND institution_id = $2`, [sid, institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

/** Preview (commit: false) or create the invoices of a structure for its students. */
router.post('/finance/structures/:id/generate', setup, async (req, res) => {
  const sid = id.parse(req.params.id);
  const b = generateInvoicesBody.parse(req.body);
  const s = institutionId(req);
  const plans = await planInvoices(sid, s, { installmentIds: b.installment_ids, studentIds: b.student_ids });
  const fresh = plans.filter((p) => !p.exists);
  const summary = { students: new Set(plans.map((p) => p.student_id)).size, invoices: fresh.length, already: plans.length - fresh.length, total: round2(fresh.reduce((n, p) => n + p.total, 0)) };
  if (!b.commit) return void res.json({ ...summary, preview: fresh.slice(0, 50) });
  const { rows } = await db.query<{ name: string; currency: string }>(`SELECT s.name, i.currency FROM fee_structures s JOIN institutions i ON i.id = s.institution_id WHERE s.id = $1`, [sid]);
  const issueDate = b.issue_date ?? (await today(req));
  const created = await withTransaction(() => createInvoices(fresh, { id: sid, name: rows[0]!.name }, s, rows[0]!.currency, currentUser(req).id, issueDate));
  await auditAs(req, 'generate_invoices', 'FeeStructure', `${rows[0]!.name}: ${created.length}`);
  res.status(201).json({ ...summary, created: created.length });
});

// ---------------------------------------------------------------- discounts and scholarships

router.get('/finance/discounts', readFees, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*, (SELECT count(*)::int FROM student_discounts sd WHERE sd.discount_id = d.id) AS students FROM discounts d WHERE d.institution_id = $1 ORDER BY d.active DESC, d.name`,
    [institutionId(req)]
  );
  res.json(rows);
});

router.post('/finance/discounts', setup, async (req, res) => {
  const b = discountBody.parse(req.body);
  const { rows } = await db.query(`INSERT INTO discounts (institution_id, name, kind, method, value, heads, sibling_from, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
    institutionId(req), b.name, b.kind, b.method, b.value, b.heads, b.kind === 'sibling' ? b.sibling_from : null, b.active,
  ]);
  await auditAs(req, 'create', 'Discount', b.name);
  res.status(201).json(rows[0]);
});

router.put('/finance/discounts/:id', setup, async (req, res) => {
  const b = discountBody.parse(req.body);
  const { rows } = await db.query(
    `UPDATE discounts SET name = $3, kind = $4, method = $5, value = $6, heads = $7, sibling_from = $8, active = $9 WHERE id = $1 AND institution_id = $2 RETURNING *`,
    [id.parse(req.params.id), institutionId(req), b.name, b.kind, b.method, b.value, b.heads, b.kind === 'sibling' ? b.sibling_from : null, b.active]
  );
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

router.delete('/finance/discounts/:id', setup, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM discounts WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

router.get('/finance/student-discounts', readFees, async (req, res) => {
  const q = z.object({ student_id: optionalId, discount_id: optionalId }).parse(req.query);
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT sd.*, d.name AS discount, d.kind, d.method, d.value, st.first_name || ' ' || st.last_name AS student, st.roll_no, count(*) OVER() _total
       FROM student_discounts sd JOIN discounts d ON d.id = sd.discount_id JOIN students st ON st.id = sd.student_id
      WHERE sd.institution_id = $1 AND ($2::int IS NULL OR sd.student_id = $2) AND ($3::int IS NULL OR sd.discount_id = $3)
      ORDER BY sd.created_at DESC LIMIT $4 OFFSET $5`,
    [institutionId(req), q.student_id, q.discount_id, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.post('/finance/student-discounts', setup, async (req, res) => {
  const b = studentDiscountBody.parse(req.body);
  const s = institutionId(req);
  await assertInInstitution('students', b.student_id, s);
  await assertInInstitution('discounts', b.discount_id, s);
  try {
    const { rows } = await db.query(
      `INSERT INTO student_discounts (institution_id, student_id, discount_id, reason, valid_from, valid_until, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [s, b.student_id, b.discount_id, b.reason, b.valid_from, b.valid_until, currentUser(req).id]
    );
    await auditAs(req, 'grant_discount', 'Student', `${b.student_id}: discount ${b.discount_id}`);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('The student already has this discount', 'DUPLICATE');
    throw e;
  }
});

router.delete('/finance/student-discounts/:id', setup, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM student_discounts WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- invoices

router.get('/finance/invoices', readFees, async (req, res) => {
  const q = invoiceQuery.parse(req.query);
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT i.id, i.number, i.title, i.issue_date, i.due_date, i.status, i.currency, i.total, i.paid, i.total - i.paid AS balance,
            (i.status IN ('issued', 'partially_paid') AND i.due_date < $9::date) AS overdue,
            i.student_id, st.first_name || ' ' || st.last_name AS student, st.roll_no, sec.name AS section_name,
            i.application_id, a.first_name || ' ' || a.last_name AS applicant, count(*) OVER() _total
       FROM invoices i LEFT JOIN students st ON st.id = i.student_id LEFT JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN applications a ON a.id = i.application_id
      WHERE i.institution_id = $1
        AND ($2::text IS NULL OR ($2 = 'unpaid' AND i.status IN ('issued', 'partially_paid')) OR ($2 = 'overdue' AND i.status IN ('issued', 'partially_paid') AND i.due_date < $9::date) OR i.status = $2)
        AND ($3::int IS NULL OR i.student_id = $3) AND ($4::int IS NULL OR st.section_id = $4) AND ($5::int IS NULL OR sec.campus_id = $5)
        AND ($6::int IS NULL OR i.structure_id = $6)
        AND ($7::text IS NULL OR i.number ILIKE '%' || $7 || '%' OR st.first_name || ' ' || st.last_name ILIKE '%' || $7 || '%' OR st.roll_no ILIKE '%' || $7 || '%')
        AND ($8::date IS NULL OR i.due_date >= $8) AND ($10::date IS NULL OR i.due_date <= $10)
      ORDER BY i.due_date DESC, i.id DESC LIMIT $11 OFFSET $12`,
    [institutionId(req), q.status ?? null, q.student_id, q.section_id, q.campus_id, q.structure_id, q.q || null, q.from, await today(req), q.to, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/finance/invoices/:id', async (req, res) => {
  const inv = await invoiceFor(req, id.parse(req.params.id));
  const [lines, pays, refunds] = await Promise.all([
    db.query(`SELECT id, kind, head, label, amount, created_at FROM invoice_items WHERE invoice_id = $1 ORDER BY (kind = 'fee') DESC, id`, [inv.id]),
    db.query(`SELECT id, receipt_no, amount, method, provider, provider_ref, status, received_at, reconciled_at, notes FROM payments WHERE invoice_id = $1 ORDER BY received_at`, [inv.id]),
    db.query(`SELECT r.id, r.payment_id, r.amount, r.reason, r.status, r.created_at FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.invoice_id = $1 ORDER BY r.created_at`, [inv.id]),
  ]);
  const { rows: st } = await db.query(`SELECT st.first_name || ' ' || st.last_name AS student, st.roll_no FROM students st WHERE st.id = $1`, [inv.student_id]);
  const staff = userCan(req, 'fees.read');
  res.json({ ...inv, pay_token: staff ? inv.pay_token : undefined, balance: balanceOf(inv), ...(st[0] ?? {}), lines: lines.rows, payments: pays.rows, refunds: refunds.rows });
});

/** One-off invoices for one or more students (exam fee, trip, a correction). */
router.post('/finance/invoices', setup, async (req, res) => {
  const b = adhocInvoiceBody.parse(req.body);
  const s = institutionId(req);
  const { rows: found } = await db.query<{ id: number }>(`SELECT id FROM students WHERE institution_id = $1 AND id = ANY($2::int[])`, [s, b.student_ids]);
  if (found.length !== new Set(b.student_ids).size) throw badRequest('Some students are not in this institution');
  const issued = await today(req);
  if (b.lines.reduce((n, l) => n + l.amount, 0) <= 0) throw badRequest('The invoice total must be more than zero', { lines: 'total' });
  const created = await withTransaction(async () => {
    const out: Awaited<ReturnType<typeof createAdhocInvoice>>[] = [];
    for (const sid of b.student_ids) out.push(await createAdhocInvoice(s, { studentId: sid, title: b.title, lines: b.lines, issueDate: issued, dueDate: b.due_date, userId: currentUser(req).id, notes: b.notes }));
    return out;
  });
  await auditAs(req, 'create_invoices', 'Invoice', `${b.title}: ${created.length}`);
  res.status(201).json({ created: created.length, ids: created.map((c) => c.id) });
});

async function lockedInvoice(req: Request) {
  const { rows } = await db.query<{ id: number; institution_id: number; student_id: number | null; number: string; total: string; paid: string; status: string }>(
    `SELECT id, institution_id, student_id, number, total, paid, status FROM invoices WHERE id = $1 AND institution_id = $2 FOR UPDATE`,
    [id.parse(req.params.id), institutionId(req)]
  );
  if (!rows[0]) throw notFound('Invoice not found');
  return rows[0];
}

router.post('/finance/invoices/:id/lines', setup, async (req, res) => {
  const b = invoiceLineBody.parse(req.body);
  const inv = await lockedInvoice(req);
  if (inv.status === 'cancelled') throw conflict('This invoice was cancelled', 'CANCELLED');
  if (['discount', 'scholarship', 'waiver'].includes(b.kind) && b.amount > 0) throw badRequest('Discounts are negative amounts', { amount: 'sign' });
  if (Number(inv.total) + b.amount < Number(inv.paid) - 0.001) throw badRequest('The total would fall below what has been paid; refund first');
  await db.query(`INSERT INTO invoice_items (institution_id, invoice_id, kind, head, label, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    inv.institution_id, inv.id, b.kind, b.head, b.label, round2(b.amount), currentUser(req).id,
  ]);
  const t = await recalcInvoice(inv.id);
  await auditAs(req, 'adjust_invoice', 'Invoice', `${inv.number}: ${b.label} ${b.amount}`);
  res.status(201).json(t);
});

router.post('/finance/invoices/:id/waive', requirePermission('fees.refund'), async (req, res) => {
  const b = waiverBody.parse(req.body);
  const inv = await lockedInvoice(req);
  if (inv.status === 'cancelled') throw conflict('This invoice was cancelled', 'CANCELLED');
  if (b.amount > balanceOf(inv) + 0.001) throw badRequest(`At most the balance due (${balanceOf(inv).toFixed(2)}) can be waived`);
  await db.query(`INSERT INTO invoice_items (institution_id, invoice_id, kind, head, label, amount, created_by) VALUES ($1,$2,'waiver','Waiver',$3,$4,$5)`, [
    inv.institution_id, inv.id, `Waiver: ${b.reason}`, -round2(b.amount), currentUser(req).id,
  ]);
  const t = await recalcInvoice(inv.id);
  await auditAs(req, 'waive', 'Invoice', `${inv.number}: ${b.amount} (${b.reason})`);
  res.status(201).json(t);
});

router.post('/finance/invoices/:id/cancel', setup, async (req, res) => {
  const b = cancelInvoiceBody.parse(req.body);
  const inv = await lockedInvoice(req);
  if (Number(inv.paid) > 0) throw conflict('Payments were received on this invoice; refund them first', 'HAS_PAYMENTS');
  await db.query(`UPDATE invoices SET status = 'cancelled', notes = trim(notes || ' ' || $2), updated_at = now() WHERE id = $1`, [inv.id, `Cancelled: ${b.reason}`]);
  await auditAs(req, 'cancel', 'Invoice', `${inv.number}: ${b.reason}`);
  res.json({ ok: true });
});

/** Money received at the counter or by bank / cheque. */
router.post('/finance/invoices/:id/payments', requirePermission('fees.manage'), async (req, res) => {
  const b = paymentBody.parse(req.body);
  const inv = await lockedInvoice(req);
  const pay = await recordPayment(inv, {
    amount: b.amount,
    method: b.method,
    provider: b.method === 'bank' ? 'bank' : null,
    providerRef: b.reference || null,
    receivedBy: currentUser(req).id,
    notes: b.notes,
    receivedAt: b.received_at ? new Date(`${b.received_at}T12:00:00Z`) : undefined,
  }).catch((e) => {
    if (isUniqueViolation(e)) throw conflict('A payment with this bank reference is already recorded', 'DUPLICATE');
    throw e;
  });
  await auditAs(req, 'record_payment', 'Invoice', `${inv.number}: ${pay.receipt_no} ${b.amount}`);
  res.status(201).json({ ...pay, invoice: await recalcInvoice(inv.id) });
});

router.get('/finance/invoices/:id/voucher.pdf', async (req, res) => {
  const inv = await invoiceFor(req, id.parse(req.params.id));
  await sendVoucherPdf(res, inv.id, institutionId(req));
});

/** Start an online payment (the payer, or staff on their behalf). */
router.post('/finance/invoices/:id/checkout', async (req, res) => {
  const inv = await invoiceFor(req, id.parse(req.params.id));
  const b = checkoutBody.parse(req.body);
  res.status(201).json(await startCheckout(inv, b.provider, b.amount, { email: currentUser(req).email }));
});

router.get('/finance/payment-options', async (req, res) => {
  const { rows } = await db.query<{ provider: ProviderName; public_config: Record<string, string> }>(
    `SELECT provider, public_config FROM payment_accounts WHERE institution_id = $1 AND enabled ORDER BY provider`,
    [institutionId(req)]
  );
  res.json(
    rows
      .filter((r) => r.provider !== 'fake' || getConfig().env !== 'production')
      .map((r) => ({ provider: r.provider, label: PROVIDERS[r.provider].label, online: PROVIDERS[r.provider].online, details: r.provider === 'bank' ? r.public_config : undefined }))
  );
});

// ---------------------------------------------------------------- payments, receipts, refunds

router.get('/finance/payments', readFees, async (req, res) => {
  const q = z.object({ from: isoDate.optional(), to: isoDate.optional(), method: z.string().max(20).optional(), student_id: optionalId, unreconciled: z.coerce.boolean().optional() }).parse(req.query);
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT p.id, p.receipt_no, p.amount, p.method, p.provider, p.provider_ref, p.status, p.received_at, p.reconciled_at,
            i.id AS invoice_id, i.number AS invoice_number, i.title, st.first_name || ' ' || st.last_name AS student, st.roll_no, u.full_name AS received_by, count(*) OVER() _total
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN students st ON st.id = i.student_id LEFT JOIN users u ON u.id = p.received_by
      WHERE p.institution_id = $1 AND ($2::date IS NULL OR p.received_at::date >= $2) AND ($3::date IS NULL OR p.received_at::date <= $3)
        AND ($4::text IS NULL OR p.method = $4) AND ($5::int IS NULL OR i.student_id = $5) AND (NOT $6::boolean OR p.reconciled_at IS NULL)
      ORDER BY p.received_at DESC, p.id DESC LIMIT $7 OFFSET $8`,
    [institutionId(req), q.from ?? null, q.to ?? null, q.method ?? null, q.student_id, q.unreconciled ?? false, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/finance/payments/:id/receipt.pdf', async (req, res) => {
  const { rows } = await db.query<{ invoice_id: number }>(`SELECT invoice_id FROM payments WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rows[0]) throw notFound('Payment not found');
  await invoiceFor(req, rows[0].invoice_id);
  await sendReceiptPdf(res, id.parse(req.params.id), institutionId(req));
});

router.post('/finance/payments/:id/refund', requirePermission('fees.refund'), async (req, res) => {
  const b = refundBody.parse(req.body);
  const r = await withTransaction(() => refundPayment(id.parse(req.params.id), institutionId(req), b.amount, b.reason, currentUser(req).id));
  await auditAs(req, 'refund', 'Payment', `${req.params.id}: ${b.amount} (${b.reason})`);
  res.status(201).json(r);
});

// ---------------------------------------------------------------- statements

/** A student's ledger: invoices (debits), payments (credits) and refunds, with a running balance. */
router.get('/finance/students/:id/statement', async (req, res) => {
  const sid = id.parse(req.params.id);
  await assertCanSeeFees(req, sid);
  const { rows } = await db.query<{ date: string; kind: string; ref: string; description: string; debit: string; credit: string; invoice_id: number; payment_id: number | null }>(
    `SELECT * FROM (
       SELECT i.issue_date::text AS date, 'invoice' AS kind, i.number AS ref, i.title AS description, i.total AS debit, 0::numeric AS credit, i.id AS invoice_id, NULL::int AS payment_id, i.created_at AS at
         FROM invoices i WHERE i.student_id = $1 AND i.institution_id = $2 AND i.status IN ('issued', 'partially_paid', 'paid')
       UNION ALL
       SELECT p.received_at::date::text, 'payment', p.receipt_no, 'Payment (' || p.method || ') — ' || i.number, 0, p.amount, i.id, p.id, p.received_at
         FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.student_id = $1 AND p.institution_id = $2
       UNION ALL
       SELECT r.created_at::date::text, 'refund', p.receipt_no, 'Refund: ' || r.reason, r.amount, 0, i.id, p.id, r.created_at
         FROM refunds r JOIN payments p ON p.id = r.payment_id JOIN invoices i ON i.id = p.invoice_id WHERE i.student_id = $1 AND r.institution_id = $2 AND r.status = 'completed'
     ) x ORDER BY date, at`,
    [sid, institutionId(req)]
  );
  let balance = 0;
  const lines = rows.map((r) => {
    balance = round2(balance + Number(r.debit) - Number(r.credit));
    return { ...r, balance };
  });
  const { rows: inv } = await db.query(
    `SELECT id, number, title, due_date, status, total, paid, total - paid AS balance, (due_date < CURRENT_DATE AND total > paid) AS overdue
       FROM invoices WHERE student_id = $1 AND institution_id = $2 AND status IN ('issued', 'partially_paid', 'paid') ORDER BY due_date DESC LIMIT 100`,
    [sid, institutionId(req)]
  );
  res.json({ balance, lines, invoices: inv });
});

/** The signed-in student's or guardian's fees, per child. */
router.get('/finance/my', async (req, res) => {
  const u = currentUser(req);
  let students: { id: number; name: string }[] = [];
  if (u.role === 'student' && u.ref_id) {
    const { rows } = await db.query(`SELECT id, first_name || ' ' || last_name AS name FROM students WHERE id = $1`, [u.ref_id]);
    students = rows;
  } else if (u.role === 'parent') {
    const { rows } = await db.query(
      `SELECT st.id, st.first_name || ' ' || st.last_name AS name FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id
        WHERE g.user_id = $1 AND gs.institution_id = $2 AND gs.can_view_fees ORDER BY st.first_name`,
      [u.id, institutionId(req)]
    );
    students = rows;
  }
  const out: Record<string, unknown>[] = [];
  for (const st of students) {
    try {
      await assertCanSeeFees(req, st.id);
    } catch {
      continue;
    }
    const { rows } = await db.query(
      `SELECT id, number, title, issue_date, due_date, status, currency, total, paid, total - paid AS balance, (due_date < CURRENT_DATE AND total > paid) AS overdue
         FROM invoices WHERE student_id = $1 AND status IN ('issued', 'partially_paid', 'paid') ORDER BY (total > paid) DESC, due_date DESC LIMIT 50`,
      [st.id]
    );
    out.push({ student_id: st.id, name: st.name, invoices: rows, balance: round2(rows.reduce((n: number, r: { balance: string }) => n + Number(r.balance), 0)) });
  }
  res.json({ students: out, hidden: u.role === 'student' && !out.length });
});

// ---------------------------------------------------------------- defaulters and reminders

router.get('/finance/defaulters', requireAny('fees.read', 'finance.reports'), async (req, res) => {
  const q = z.object({ section_id: optionalId, campus_id: optionalId, min_days: z.coerce.number().int().min(0).max(365).default(1), format: z.enum(['json', 'csv', 'xlsx']).default('json') }).parse(req.query);
  const day = await today(req);
  const { rows } = await db.query(
    `SELECT st.id AS student_id, st.first_name || ' ' || st.last_name AS student, st.roll_no, sec.name AS section_name,
            count(i.id)::int AS invoices, sum(i.total - i.paid) AS overdue, min(i.due_date) AS oldest_due, ($2::date - min(i.due_date))::int AS days_overdue,
            (SELECT string_agg(g.first_name || ' ' || g.last_name || CASE WHEN g.phone <> '' THEN ' (' || g.phone || ')' ELSE '' END, '; ')
               FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE gs.student_id = st.id AND gs.can_view_fees) AS guardians,
            array_agg(i.id) AS invoice_ids
       FROM invoices i JOIN students st ON st.id = i.student_id LEFT JOIN sections sec ON sec.id = st.section_id
      WHERE i.institution_id = $1 AND i.status IN ('issued', 'partially_paid') AND i.total > i.paid AND i.due_date <= $2::date - $3::int
        AND ($4::int IS NULL OR st.section_id = $4) AND ($5::int IS NULL OR sec.campus_id = $5)
      GROUP BY st.id, sec.name ORDER BY overdue DESC LIMIT 2000`,
    [institutionId(req), day, q.min_days, q.section_id, q.campus_id]
  );
  if (q.format === 'json') return void res.json(rows);
  await sendTable(
    res,
    `defaulters-${day}`,
    ['Roll no', 'Student', 'Class', 'Invoices', 'Overdue', 'Oldest due', 'Days overdue', 'Guardians'],
    rows.map((r) => [r.roll_no, r.student, r.section_name, r.invoices, Number(r.overdue), r.oldest_due, r.days_overdue, r.guardians]),
    q.format
  );
});

router.post('/finance/reminders', requirePermission('fees.manage'), async (req, res) => {
  const b = reminderBody.parse(req.body);
  const out = await remindNow(institutionId(req), b.invoice_ids, b.channels);
  await auditAs(req, 'send_reminders', 'Invoice', `${out.reminded} of ${out.invoices}`);
  res.json(out);
});

// ---------------------------------------------------------------- settings and payment accounts

router.get('/finance/settings', readFees, async (req, res) => {
  const { rows } = await db.query<{ fees: unknown }>(`SELECT settings->'fees' AS fees FROM institutions WHERE id = $1`, [institutionId(req)]);
  res.json(feeSettings(rows[0]?.fees));
});

router.put('/finance/settings', setup, async (req, res) => {
  const b = feeSettingsBody.parse(req.body);
  await db.query(`UPDATE institutions SET settings = jsonb_set(settings, '{fees}', $2::jsonb) WHERE id = $1`, [institutionId(req), JSON.stringify(b)]);
  await auditAs(req, 'update', 'FeeSettings', JSON.stringify(b));
  res.json(b);
});

const configure = requirePermission('payments.configure');

router.get('/finance/accounts', configure, async (req, res) => {
  const { rows } = await db.query<{ provider: ProviderName; enabled: boolean; mode: string; public_config: object; secret_sealed: string | null; updated_at: Date }>(
    `SELECT provider, enabled, mode, public_config, secret_sealed, updated_at FROM payment_accounts WHERE institution_id = $1`,
    [institutionId(req)]
  );
  const base = getConfig().apiPublicUrl;
  const { rows: ids } = await db.query<{ id: number; provider: string }>(`SELECT id, provider FROM payment_accounts WHERE institution_id = $1`, [institutionId(req)]);
  res.json(
    PAYMENT_PROVIDERS.filter((p) => p !== 'fake' || getConfig().env !== 'production').map((p) => {
      const r = rows.find((x) => x.provider === p);
      const set = r?.secret_sealed ? Object.keys(JSON.parse(decryptSecret(r.secret_sealed)) as object) : [];
      const accountId = ids.find((x) => x.provider === p)?.id;
      return {
        provider: p,
        label: PROVIDERS[p].label,
        connected: !!r,
        enabled: r?.enabled ?? false,
        mode: r?.mode ?? 'sandbox',
        public_config: r?.public_config ?? {},
        secrets: PROVIDER_SECRETS[p].map((k) => ({ key: k, set: set.includes(k) })),
        webhook_url: accountId && p !== 'bank' ? `${base}/payments/webhook/${p}/${accountId}` : null,
      };
    })
  );
});

router.put('/finance/accounts/:provider', configure, async (req, res) => {
  const provider = z.enum(PAYMENT_PROVIDERS).parse(req.params.provider);
  if (provider === 'fake' && getConfig().env === 'production') throw badRequest('The test provider is not available in production');
  const b = paymentAccountBody.parse(req.body);
  const s = institutionId(req);
  const allowed = PROVIDER_SECRETS[provider];
  const bad = Object.keys(b.secrets).filter((k) => !allowed.includes(k));
  if (bad.length) throw badRequest(`Unknown keys for ${provider}: ${bad.join(', ')}`);
  const { rows: existing } = await db.query<{ secret_sealed: string | null }>(`SELECT secret_sealed FROM payment_accounts WHERE institution_id = $1 AND provider = $2`, [s, provider]);
  const secrets: Record<string, string> = existing[0]?.secret_sealed ? (JSON.parse(decryptSecret(existing[0].secret_sealed)) as Record<string, string>) : {};
  for (const [k, v] of Object.entries(b.secrets)) {
    if (v === '') delete secrets[k];
    else secrets[k] = v;
  }
  await db.query(
    `INSERT INTO payment_accounts (institution_id, provider, enabled, mode, public_config, secret_sealed, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT ON CONSTRAINT payment_accounts_institution_id_provider_key DO UPDATE
       SET enabled = EXCLUDED.enabled, mode = EXCLUDED.mode, public_config = EXCLUDED.public_config, secret_sealed = EXCLUDED.secret_sealed, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [s, provider, b.enabled, b.mode, JSON.stringify(b.public_config), Object.keys(secrets).length ? sealSecrets(secrets) : null, currentUser(req).id]
  );
  await auditAs(req, 'configure_payments', 'PaymentAccount', `${provider} (${b.mode}, ${b.enabled ? 'on' : 'off'})`);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- reconciliation

const STATEMENT_COLUMNS = {
  date: ['date', 'transaction date', 'value date', 'posting date'],
  description: ['description', 'narration', 'details', 'particulars', 'remarks'],
  reference: ['reference', 'ref', 'ref no', 'transaction id', 'cheque no', 'tran id'],
  amount: ['amount', 'credit', 'credit amount', 'deposit', 'cr'],
};

/** Compare with what the provider settled (online), or with an uploaded bank statement (bank). */
router.post('/finance/reconcile', reports, oneFile(5), async (req, res) => {
  const b = reconcileBody.parse(req.body);
  if (b.from > b.to) throw badRequest('From must be before to');
  const s = institutionId(req);
  let settled: Settlement[];
  if (b.provider === 'bank') {
    const file = requireFile(req);
    const { headers, rows } = await readRows(file.buffer, file.mimetype);
    const { map } = mapHeaders(headers, STATEMENT_COLUMNS);
    if (map.amount === undefined || map.date === undefined) throw badRequest('The statement needs date and amount (or credit) columns');
    settled = rows
      .map((r) => rowObject(r, map))
      .map((o) => ({ at: parseDate(o.date) ?? '', amount: Number(String(o.amount ?? '').replace(/[^\d.-]/g, '')), providerRef: o.reference || `${o.date}:${o.amount}:${o.description ?? ''}`, reference: `${o.description ?? ''} ${o.reference ?? ''}` }))
      .filter((x) => x.amount > 0 && x.at >= b.from && x.at <= b.to);
  } else {
    const acct = await loadAccount(s, b.provider);
    const drv = PROVIDERS[b.provider];
    if (!acct || !drv.settlements) throw badRequest(`Reconciliation with ${drv.label} needs a connected account that reports settlements; upload a statement as a bank reconciliation instead`);
    settled = await drv.settlements(acct, b.from, b.to);
  }
  const result = await reconcile(s, b.provider, b.from, b.to, settled);
  const counts = { matched: result.matched.length, missing_in_acadex: result.missing_in_acadex.length, missing_at_provider: result.missing_at_provider.length, amount_mismatch: result.amount_mismatch.length };
  const { rows } = await db.query(`INSERT INTO reconciliations (institution_id, provider, from_date, to_date, summary, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`, [
    s, b.provider, b.from, b.to, JSON.stringify({ counts, ...result }), currentUser(req).id,
  ]);
  await auditAs(req, 'reconcile', 'Reconciliation', `${b.provider} ${b.from}..${b.to}: ${JSON.stringify(counts)}`);
  res.status(201).json({ id: rows[0].id, counts, ...result });
});

router.get('/finance/reconciliations', reports, async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.provider, r.from_date, r.to_date, r.summary->'counts' AS counts, r.created_at, u.full_name AS created_by
       FROM reconciliations r LEFT JOIN users u ON u.id = r.created_by WHERE r.institution_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
    [institutionId(req)]
  );
  res.json(rows);
});

router.get('/finance/reconciliations/:id', reports, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM reconciliations WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

// ---------------------------------------------------------------- expenses

const expenses = requireAny('finance.expenses', 'finance.reports');

router.get('/finance/expenses', expenses, async (req, res) => {
  const q = z.object({ from: isoDate.optional(), to: isoDate.optional(), category: z.string().max(60).optional(), campus_id: optionalId }).parse(req.query);
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT e.*, c.name AS campus, u.full_name AS created_by_name, count(*) OVER() _total FROM expenses e LEFT JOIN campuses c ON c.id = e.campus_id LEFT JOIN users u ON u.id = e.created_by
      WHERE e.institution_id = $1 AND ($2::date IS NULL OR e.date >= $2) AND ($3::date IS NULL OR e.date <= $3) AND ($4::text IS NULL OR e.category = $4) AND ($5::int IS NULL OR e.campus_id = $5)
      ORDER BY e.date DESC, e.id DESC LIMIT $6 OFFSET $7`,
    [institutionId(req), q.from ?? null, q.to ?? null, q.category ?? null, q.campus_id, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

router.get('/finance/expense-categories', expenses, async (req, res) => {
  const { rows } = await db.query(`SELECT category, count(*)::int n FROM expenses WHERE institution_id = $1 GROUP BY 1 ORDER BY 2 DESC`, [institutionId(req)]);
  const defaults = ['Salaries', 'Utilities', 'Rent', 'Maintenance', 'Supplies', 'Transport', 'Events', 'Marketing', 'Other'];
  res.json([...new Set([...rows.map((r) => r.category as string), ...defaults])]);
});

async function checkExpenseRefs(req: Request, b: { campus_id: number | null; receipt_file_id: number | null }) {
  if (b.campus_id) await assertInInstitution('campuses', b.campus_id, institutionId(req));
  if (b.receipt_file_id) await assertInInstitution('files', b.receipt_file_id, institutionId(req));
}

router.post('/finance/expenses', requirePermission('finance.expenses'), async (req, res) => {
  const b = expenseBody.parse(req.body);
  await checkExpenseRefs(req, b);
  const { rows } = await db.query(
    `INSERT INTO expenses (institution_id, campus_id, date, category, description, vendor, amount, method, reference, receipt_file_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [institutionId(req), b.campus_id, b.date, b.category, b.description, b.vendor, round2(b.amount), b.method, b.reference, b.receipt_file_id, currentUser(req).id]
  );
  res.status(201).json(rows[0]);
});

router.patch('/finance/expenses/:id', requirePermission('finance.expenses'), async (req, res) => {
  const b = patchSchema(expenseBody.shape).parse(req.body);
  if (b.campus_id !== undefined || b.receipt_file_id !== undefined) await checkExpenseRefs(req, { campus_id: b.campus_id ?? null, receipt_file_id: b.receipt_file_id ?? null });
  const entries = Object.entries(b).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to change');
  const params: unknown[] = [id.parse(req.params.id), institutionId(req)];
  const sets = entries.map(([k, v]) => {
    params.push(v);
    return `${k} = $${params.length}`;
  });
  const { rows } = await db.query(`UPDATE expenses SET ${sets.join(', ')} WHERE id = $1 AND institution_id = $2 RETURNING *`, params);
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

router.delete('/finance/expenses/:id', requirePermission('finance.expenses'), async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM expenses WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- reports and exports

router.get('/finance/summary', reports, async (req, res) => {
  const q = periodQuery.parse(req.query);
  const day = await today(req);
  const s = institutionId(req);
  const { rows } = await db.query(
    `WITH pay AS (SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN students st ON st.id = i.student_id LEFT JOIN sections sec ON sec.id = st.section_id
                   WHERE p.institution_id = $1 AND p.received_at::date BETWEEN $2 AND $3 AND ($5::int IS NULL OR sec.campus_id = $5)),
          ref AS (SELECT r.* FROM refunds r WHERE r.institution_id = $1 AND r.status = 'completed' AND r.created_at::date BETWEEN $2 AND $3),
          inv AS (SELECT i.* FROM invoices i LEFT JOIN students st ON st.id = i.student_id LEFT JOIN sections sec ON sec.id = st.section_id
                   WHERE i.institution_id = $1 AND i.status IN ('issued', 'partially_paid', 'paid') AND ($5::int IS NULL OR sec.campus_id = $5)),
          exp AS (SELECT * FROM expenses WHERE institution_id = $1 AND date BETWEEN $2 AND $3 AND ($5::int IS NULL OR campus_id = $5))
     SELECT json_build_object(
       'collected', (SELECT COALESCE(sum(amount), 0) FROM pay),
       'refunded', (SELECT COALESCE(sum(amount), 0) FROM ref),
       'billed', (SELECT COALESCE(sum(total), 0) FROM inv WHERE issue_date BETWEEN $2 AND $3),
       'outstanding', (SELECT COALESCE(sum(total - paid), 0) FROM inv),
       'overdue', (SELECT COALESCE(sum(total - paid), 0) FROM inv WHERE due_date < $4::date),
       'defaulters', (SELECT count(DISTINCT student_id)::int FROM inv WHERE due_date < $4::date AND total > paid),
       'expenses', (SELECT COALESCE(sum(amount), 0) FROM exp),
       'by_method', (SELECT COALESCE(json_agg(x), '[]') FROM (SELECT COALESCE(provider, method) AS method, sum(amount) AS amount, count(*)::int n FROM pay GROUP BY 1 ORDER BY 2 DESC) x),
       'by_head', (SELECT COALESCE(json_agg(x), '[]') FROM (SELECT it.head, sum(it.amount) AS amount FROM invoice_items it JOIN inv ON inv.id = it.invoice_id WHERE inv.issue_date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC) x),
       'by_category', (SELECT COALESCE(json_agg(x), '[]') FROM (SELECT category, sum(amount) AS amount FROM exp GROUP BY 1 ORDER BY 2 DESC) x),
       'by_month', (SELECT COALESCE(json_agg(x ORDER BY x.month), '[]') FROM (
           SELECT m.month, COALESCE((SELECT sum(amount) FROM pay WHERE to_char(received_at, 'YYYY-MM') = m.month), 0) AS income,
                  COALESCE((SELECT sum(amount) FROM exp WHERE to_char(date, 'YYYY-MM') = m.month), 0) AS expenses
             FROM (SELECT to_char(generate_series(date_trunc('month', $2::date), $3::date, '1 month'), 'YYYY-MM') AS month) m) x),
       'unreconciled_online', (SELECT count(*)::int FROM pay WHERE method = 'online' AND reconciled_at IS NULL)
     ) AS d`,
    [s, q.from, q.to, day, q.campus_id]
  );
  res.json(rows[0].d);
});

router.get('/finance/reports/income-expense', reports, async (req, res) => {
  const q = periodQuery.parse(req.query);
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT p.received_at::date AS date, 'Income' AS type, 'Fees: ' || COALESCE(it.head, 'Fee') AS category, i.number || ' ' || p.receipt_no AS reference,
              COALESCE(st.first_name || ' ' || st.last_name, a.first_name || ' ' || a.last_name, '') AS party, p.amount, COALESCE(p.provider, p.method) AS method
         FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN students st ON st.id = i.student_id LEFT JOIN applications a ON a.id = i.application_id
         LEFT JOIN LATERAL (SELECT head FROM invoice_items x WHERE x.invoice_id = i.id AND x.kind = 'fee' ORDER BY x.amount DESC LIMIT 1) it ON true
        WHERE p.institution_id = $1 AND p.received_at::date BETWEEN $2 AND $3
       UNION ALL
       SELECT r.created_at::date, 'Refund', 'Refunds', p.receipt_no, '', -r.amount, COALESCE(p.provider, p.method)
         FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.institution_id = $1 AND r.status = 'completed' AND r.created_at::date BETWEEN $2 AND $3
       UNION ALL
       SELECT e.date, 'Expense', e.category, e.reference, e.vendor, -e.amount, e.method FROM expenses e WHERE e.institution_id = $1 AND e.date BETWEEN $2 AND $3
     ) x ORDER BY date, type`,
    [institutionId(req), q.from, q.to]
  );
  await sendTable(
    res,
    `income-expense-${q.from}-${q.to}`,
    ['Date', 'Type', 'Category', 'Reference', 'Party', 'Amount', 'Method'],
    rows.map((r) => [String(r.date).slice(0, 10), r.type, r.category, r.reference, r.party, Number(r.amount), r.method]),
    req.query.format
  );
});

async function receiptsFor(req: Request, q: { from: string; to: string }) {
  const { rows } = await db.query(
    `SELECT p.receipt_no, p.received_at, p.amount, COALESCE(p.provider, p.method) AS method, i.number AS invoice_number, i.title,
            COALESCE(st.first_name || ' ' || st.last_name, a.first_name || ' ' || a.last_name, 'Walk-in') AS party, st.roll_no
       FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN students st ON st.id = i.student_id LEFT JOIN applications a ON a.id = i.application_id
      WHERE p.institution_id = $1 AND p.received_at::date BETWEEN $2 AND $3 ORDER BY p.received_at`,
    [institutionId(req), q.from, q.to]
  );
  return rows as { receipt_no: string; received_at: Date; amount: string; method: string; invoice_number: string; title: string; party: string; roll_no: string | null }[];
}

const xml = (s: unknown) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** Tally: receipt vouchers as Tally XML (Gateway of Tally → Import → Vouchers). */
router.get('/finance/export/tally', reports, async (req, res) => {
  const q = periodQuery.parse(req.query);
  const ledgers = z.object({ fee_ledger: z.string().max(60).default('Fee Income'), cash_ledger: z.string().max(60).default('Cash'), bank_ledger: z.string().max(60).default('Bank') }).parse(req.query);
  const rows = await receiptsFor(req, q);
  const vouchers = rows
    .map((r) => {
      const date = new Date(r.received_at).toISOString().slice(0, 10).replace(/-/g, '');
      const debit = r.method === 'cash' ? ledgers.cash_ledger : ledgers.bank_ledger;
      const amt = Number(r.amount).toFixed(2);
      return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>${date}</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(r.receipt_no)}</VOUCHERNUMBER><NARRATION>${xml(`${r.title} — ${r.party}${r.roll_no ? ` (${r.roll_no})` : ''} — ${r.invoice_number}`)}</NARRATION><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledgers.fee_ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt}</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(debit)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>`;
    })
    .join('');
  res.set({ 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="tally-receipts-${q.from}-${q.to}.xml"` });
  res.send(`<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${vouchers}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`);
});

/** QuickBooks Online: sales receipts CSV (Settings → Import data → Sales receipts). */
router.get('/finance/export/quickbooks', reports, async (req, res) => {
  const q = periodQuery.parse(req.query);
  const rows = await receiptsFor(req, q);
  await sendTable(
    res,
    `quickbooks-sales-receipts-${q.from}-${q.to}`,
    ['SalesReceiptNo', 'Customer', 'SalesReceiptDate', 'PaymentMethod', 'DepositToAccountName', 'ItemProduct', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount'],
    rows.map((r) => [r.receipt_no, r.party, new Date(r.received_at).toISOString().slice(0, 10), r.method, r.method === 'cash' ? 'Cash on hand' : 'Bank', 'Fees', `${r.title} (${r.invoice_number})`, 1, Number(r.amount), Number(r.amount)]),
    'csv'
  );
});

router.get('/finance/export/collections', reports, async (req, res) => {
  const q = periodQuery.parse(req.query);
  const rows = await receiptsFor(req, q);
  await sendTable(
    res,
    `collections-${q.from}-${q.to}`,
    ['Receipt', 'Date', 'Payer', 'Roll no', 'Invoice', 'For', 'Method', 'Amount'],
    rows.map((r) => [r.receipt_no, new Date(r.received_at).toISOString().slice(0, 10), r.party, r.roll_no, r.invoice_number, r.title, r.method, Number(r.amount)]),
    req.query.format
  );
});

export default router;

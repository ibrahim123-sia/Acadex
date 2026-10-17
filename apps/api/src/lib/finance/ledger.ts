// Money that moves: invoice totals, generating invoices from a fee structure (with discounts,
// sibling discounts and scholarships), payments and refunds, provider webhooks applied once,
// late fines, and reconciliation against what a provider or bank settled.
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret } from '../../auth/crypto';
import { db } from '../../db/context';
import { badRequest, conflict, notFound } from '../errors';
import { emitWebhook } from '../webhooks';
import { notify } from '../notify';
import { PROVIDERS, type ProviderAccount, type ProviderEvent, type ProviderName, type Settlement } from './providers';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** The next number in a per-institution series, e.g. INV-2026-00042 (locked per prefix). */
export async function nextNumber(institutionId: number, table: 'invoices' | 'payments', prefix: string): Promise<string> {
  const col = table === 'invoices' ? 'number' : 'receipt_no';
  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${institutionId}:${table}:${prefix}`]);
  const { rows } = await db.query<{ n: number }>(
    `SELECT COALESCE(max(NULLIF(regexp_replace(${col}, '^.*-', ''), '')::int), 0) + 1 AS n FROM ${table} WHERE institution_id = $1 AND ${col} LIKE $2 AND ${col} ~ '-[0-9]+$'`,
    [institutionId, `${prefix}-%`]
  );
  return `${prefix}-${String(rows[0]!.n).padStart(5, '0')}`;
}

/** Total of the lines, paid of the payments less refunds, and the status that follows. */
export async function recalcInvoice(invoiceId: number) {
  const { rows } = await db.query<{ total: string; paid: string; status: string }>(
    `UPDATE invoices i SET
        total = GREATEST(0, (SELECT COALESCE(sum(amount), 0) FROM invoice_items WHERE invoice_id = i.id)),
        paid = (SELECT COALESCE(sum(p.amount), 0) FROM payments p WHERE p.invoice_id = i.id)
             - (SELECT COALESCE(sum(r.amount), 0) FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE p.invoice_id = i.id AND r.status = 'completed'),
        updated_at = now()
      WHERE i.id = $1 RETURNING total, paid, status`,
    [invoiceId]
  );
  const r = rows[0];
  if (!r) return null;
  if (r.status === 'cancelled' || r.status === 'draft') return r;
  const total = Number(r.total);
  const paid = Number(r.paid);
  const status = paid >= total && total > 0 ? 'paid' : paid > 0 ? 'partially_paid' : total === 0 ? 'paid' : 'issued';
  if (status !== r.status) await db.query(`UPDATE invoices SET status = $2 WHERE id = $1`, [invoiceId, status]);
  return { ...r, status };
}

export async function loadInvoice(id: number, institutionId: number) {
  const { rows } = await db.query<{ id: number; institution_id: number; number: string; student_id: number | null; application_id: number | null; title: string; due_date: string; status: string; currency: string; total: string; paid: string; pay_token: string | null }>(
    `SELECT id, institution_id, number, student_id, application_id, title, due_date, status, currency, total, paid, pay_token FROM invoices WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  );
  if (!rows[0]) throw notFound('Invoice not found');
  return rows[0];
}

export const balanceOf = (inv: { total: string; paid: string }) => round2(Number(inv.total) - Number(inv.paid));

// ---------------------------------------------------------------- generating invoices

interface StructureRow {
  id: number;
  institution_id: number;
  name: string;
  academic_year_id: number | null;
  campus_id: number | null;
  program_id: number | null;
  program_level_id: number | null;
}

/** Students a structure applies to: active, in a section matching its year / campus / program / level. */
export async function studentsFor(s: StructureRow, onlyIds?: number[]) {
  const { rows } = await db.query<{ id: number; name: string }>(
    `SELECT st.id, st.first_name || ' ' || st.last_name AS name FROM students st
       JOIN sections sec ON sec.id = st.section_id
       LEFT JOIN program_levels pl ON pl.id = sec.program_level_id
      WHERE st.institution_id = $1 AND COALESCE(st.status, 'active') = 'active'
        AND ($2::int IS NULL OR sec.academic_year_id = $2) AND ($3::int IS NULL OR sec.campus_id = $3)
        AND ($4::int IS NULL OR pl.program_id = $4) AND ($5::int IS NULL OR sec.program_level_id = $5)
        AND ($6::int[] IS NULL OR st.id = ANY($6::int[]))
      ORDER BY st.id`,
    [s.institution_id, s.academic_year_id, s.campus_id, s.program_id, s.program_level_id, onlyIds ?? null]
  );
  return rows;
}

interface Discount {
  id: number;
  name: string;
  kind: string;
  method: 'percent' | 'amount';
  value: string;
  heads: string[];
  sibling_from: number | null;
}

/** The discounts a student gets on a date: assigned ones, plus sibling rules that fit. */
async function discountsFor(institutionId: number, studentId: number, onDate: string): Promise<Discount[]> {
  const { rows: assigned } = await db.query<Discount>(
    `SELECT d.id, d.name, d.kind, d.method, d.value, d.heads, d.sibling_from FROM student_discounts sd JOIN discounts d ON d.id = sd.discount_id
      WHERE sd.student_id = $1 AND d.active AND (sd.valid_from IS NULL OR sd.valid_from <= $2) AND (sd.valid_until IS NULL OR sd.valid_until >= $2)`,
    [studentId, onDate]
  );
  const { rows: sibling } = await db.query<Discount>(
    `SELECT id, name, kind, method, value, heads, sibling_from FROM discounts WHERE institution_id = $1 AND active AND kind = 'sibling' AND sibling_from IS NOT NULL`,
    [institutionId]
  );
  const out = [...assigned];
  if (sibling.length) {
    // the student's place among active siblings (children sharing a guardian), by admission
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(DISTINCT st2.id)::int AS n FROM guardianships g1
         JOIN guardianships g2 ON g2.guardian_id = g1.guardian_id
         JOIN students st2 ON st2.id = g2.student_id AND COALESCE(st2.status, 'active') = 'active'
         JOIN students me ON me.id = g1.student_id
        WHERE g1.student_id = $1 AND (st2.admission_date, st2.id) <= (me.admission_date, me.id)`,
      [studentId]
    );
    const place = rows[0]?.n ?? 1;
    for (const d of sibling) if (place >= d.sibling_from! && !out.some((x) => x.id === d.id)) out.push(d);
  }
  return out;
}

export interface InvoicePlan {
  student_id: number;
  name: string;
  installment_id: number;
  label: string;
  due_date: string;
  lines: { kind: string; head: string; label: string; amount: number; discount_id?: number }[];
  total: number;
  exists: boolean;
}

/** What invoices a structure would create (for some instalments and students). */
export async function planInvoices(structureId: number, institutionId: number, opts: { installmentIds?: number[]; studentIds?: number[] } = {}): Promise<InvoicePlan[]> {
  const { rows: st } = await db.query<StructureRow>(`SELECT * FROM fee_structures WHERE id = $1 AND institution_id = $2`, [structureId, institutionId]);
  const structure = st[0];
  if (!structure) throw notFound('Fee structure not found');
  const { rows: items } = await db.query<{ head: string; amount: string; frequency: string }>(`SELECT head, amount, frequency FROM fee_structure_items WHERE structure_id = $1 ORDER BY position, id`, [structureId]);
  const { rows: insts } = await db.query<{ id: number; label: string; due_date: string; position: number }>(
    `SELECT id, label, due_date, position FROM fee_installments WHERE structure_id = $1 AND ($2::int[] IS NULL OR id = ANY($2::int[])) ORDER BY position, due_date`,
    [structureId, opts.installmentIds ?? null]
  );
  const { rows: allInsts } = await db.query<{ id: number }>(`SELECT id FROM fee_installments WHERE structure_id = $1 ORDER BY position, due_date LIMIT 1`, [structureId]);
  const firstId = allInsts[0]?.id;
  const students = await studentsFor(structure, opts.studentIds);
  const { rows: existing } = await db.query<{ student_id: number; installment_id: number }>(
    `SELECT student_id, installment_id FROM invoices WHERE structure_id = $1 AND status <> 'cancelled'`,
    [structureId]
  );
  const plans: InvoicePlan[] = [];
  for (const s of students) {
    for (const inst of insts) {
      const fees = items.filter((i) => i.frequency === 'per_installment' || inst.id === firstId).map((i) => ({ kind: 'fee', head: i.head, label: i.head, amount: Number(i.amount) }));
      const lines: InvoicePlan['lines'] = [...fees];
      for (const d of await discountsFor(institutionId, s.id, inst.due_date)) {
        const base = fees.filter((f) => !d.heads.length || d.heads.includes(f.head)).reduce((n, f) => n + f.amount, 0);
        const value = d.method === 'percent' ? round2((base * Number(d.value)) / 100) : Math.min(base, Number(d.value));
        if (value > 0) lines.push({ kind: d.kind === 'scholarship' ? 'scholarship' : d.kind === 'waiver' ? 'waiver' : 'discount', head: d.heads[0] ?? 'All', label: d.name, amount: -value, discount_id: d.id });
      }
      plans.push({
        student_id: s.id,
        name: s.name,
        installment_id: inst.id,
        label: inst.label,
        due_date: inst.due_date,
        lines,
        total: Math.max(0, round2(lines.reduce((n, l) => n + l.amount, 0))),
        exists: existing.some((e) => e.student_id === s.id && e.installment_id === inst.id),
      });
    }
  }
  return plans;
}

export async function createInvoices(plans: InvoicePlan[], structure: { id: number; name: string }, institutionId: number, currency: string, userId: number | null, issueDate: string) {
  const created: number[] = [];
  const year = issueDate.slice(0, 4);
  for (const p of plans.filter((x) => !x.exists)) {
    const number = await nextNumber(institutionId, 'invoices', `INV-${year}`);
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO invoices (institution_id, number, student_id, structure_id, installment_id, title, issue_date, due_date, status, currency, pay_token, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'issued',$9,$10,$11) ON CONFLICT ON CONSTRAINT invoices_student_id_installment_id_key DO NOTHING RETURNING id`,
      [institutionId, number, p.student_id, structure.id, p.installment_id, `${structure.name} — ${p.label}`, issueDate, p.due_date, currency, crypto.randomBytes(18).toString('base64url'), userId]
    );
    if (!rows[0]) continue;
    for (const l of p.lines) {
      await db.query(`INSERT INTO invoice_items (institution_id, invoice_id, kind, head, label, amount, discount_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        institutionId, rows[0].id, l.kind, l.head, l.label, l.amount, l.discount_id ?? null, userId,
      ]);
    }
    await recalcInvoice(rows[0].id);
    created.push(rows[0].id);
  }
  if (created.length) await emitWebhook(institutionId, 'invoice.issued', { invoice_ids: created, structure_id: structure.id });
  return created;
}

// ---------------------------------------------------------------- payments

/** Record money received against an invoice (never more than what is owed). */
export async function recordPayment(
  inv: { id: number; institution_id: number; student_id: number | null; total: string; paid: string; status: string },
  p: { amount: number; method: string; provider?: string | null; providerRef?: string | null; receivedBy?: number | null; notes?: string; receivedAt?: Date }
) {
  if (inv.status === 'cancelled') throw conflict('This invoice was cancelled', 'CANCELLED');
  const balance = balanceOf(inv);
  if (p.amount > balance + 0.001) throw badRequest(`More than the balance due (${balance.toFixed(2)})`, { amount: 'too_much' });
  const receipt = await nextNumber(inv.institution_id, 'payments', `RCT-${new Date().getUTCFullYear()}`);
  const { rows } = await db.query<{ id: number; receipt_no: string }>(
    `INSERT INTO payments (institution_id, invoice_id, student_id, receipt_no, amount, method, provider, provider_ref, received_by, notes, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, receipt_no`,
    [inv.institution_id, inv.id, inv.student_id, receipt, round2(p.amount), p.method, p.provider ?? null, p.providerRef ?? null, p.receivedBy ?? null, p.notes ?? '', p.receivedAt ?? new Date()]
  );
  await recalcInvoice(inv.id);
  await tellPayer(inv.id, `Payment received: ${receipt}`, `${round2(p.amount).toFixed(2)} received. Thank you.`);
  await emitWebhook(inv.institution_id, 'payment.received', { payment_id: rows[0]!.id, receipt_no: receipt, invoice_id: inv.id, student_id: inv.student_id, amount: round2(p.amount), method: p.method });
  return rows[0]!;
}

/** The student (when fees are shown to students) and guardians who may see fees. */
export async function payerUserIds(invoiceId: number): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT u.id FROM invoices i JOIN users u ON u.role = 'student' AND u.ref_id = i.student_id AND u.institution_id = i.institution_id
       JOIN institutions ins ON ins.id = i.institution_id
      WHERE i.id = $1 AND u.is_active AND COALESCE((ins.settings->'fees'->>'show_to_students')::boolean, true)
     UNION
     SELECT g.user_id FROM invoices i JOIN guardianships gs ON gs.student_id = i.student_id JOIN guardians g ON g.id = gs.guardian_id
      WHERE i.id = $1 AND g.user_id IS NOT NULL AND gs.can_view_fees`,
    [invoiceId]
  );
  return rows.map((r) => r.id);
}

async function tellPayer(invoiceId: number, title: string, message: string) {
  const { rows } = await db.query<{ institution_id: number }>(`SELECT institution_id FROM invoices WHERE id = $1`, [invoiceId]);
  await notify({ institutionId: rows[0]!.institution_id, userIds: await payerUserIds(invoiceId), type: 'payment_received', title, message, link: '/fees' });
}

/** Refund part or all of a payment (online payments are refunded at the provider too). */
export async function refundPayment(paymentId: number, institutionId: number, amount: number, reason: string, userId: number) {
  const { rows } = await db.query<{ id: number; invoice_id: number; amount: string; provider: string | null; provider_ref: string | null; refunded: string }>(
    `SELECT p.id, p.invoice_id, p.amount, p.provider, p.provider_ref,
            (SELECT COALESCE(sum(r.amount), 0) FROM refunds r WHERE r.payment_id = p.id AND r.status <> 'failed') AS refunded
       FROM payments p WHERE p.id = $1 AND p.institution_id = $2 FOR UPDATE`,
    [paymentId, institutionId]
  );
  const p = rows[0];
  if (!p) throw notFound('Payment not found');
  const left = round2(Number(p.amount) - Number(p.refunded));
  if (amount > left + 0.001) throw badRequest(`At most ${left.toFixed(2)} can still be refunded`);
  let providerRef: string | null = null;
  if (p.provider && p.provider_ref && p.provider !== 'bank') {
    const acct = await loadAccount(institutionId, p.provider as ProviderName);
    const drv = PROVIDERS[p.provider as ProviderName];
    if (drv.refund && acct) providerRef = (await drv.refund(acct, p.provider_ref, amount)).providerRef;
  }
  const { rows: r } = await db.query(`INSERT INTO refunds (institution_id, payment_id, amount, reason, status, provider_ref, created_by) VALUES ($1,$2,$3,$4,'completed',$5,$6) RETURNING *`, [
    institutionId, paymentId, round2(amount), reason, providerRef, userId,
  ]);
  await db.query(`UPDATE payments SET status = CASE WHEN $2 >= amount THEN 'refunded' ELSE 'partially_refunded' END WHERE id = $1`, [paymentId, round2(Number(p.refunded) + amount)]);
  await recalcInvoice(p.invoice_id);
  return r[0];
}

// ---------------------------------------------------------------- provider accounts

export async function loadAccount(institutionId: number, provider: ProviderName): Promise<ProviderAccount | null> {
  const { rows } = await db.query<{ id: number; provider: ProviderName; mode: 'sandbox' | 'live'; public_config: Record<string, string>; secret_sealed: string | null; enabled: boolean }>(
    `SELECT id, provider, mode, public_config, secret_sealed, enabled FROM payment_accounts WHERE institution_id = $1 AND provider = $2`,
    [institutionId, provider]
  );
  const r = rows[0];
  if (!r || !r.enabled) return null;
  return { id: r.id, provider: r.provider, mode: r.mode, publicConfig: r.public_config, secrets: r.secret_sealed ? (JSON.parse(decryptSecret(r.secret_sealed)) as Record<string, string>) : {} };
}

export async function loadAccountById(accountId: number) {
  const { rows } = await db.query<{ institution_id: number; provider: ProviderName }>(`SELECT institution_id, provider FROM payment_accounts WHERE id = $1`, [accountId]);
  if (!rows[0]) return null;
  return { institutionId: rows[0].institution_id, account: await loadAccount(rows[0].institution_id, rows[0].provider) };
}

export const sealSecrets = (secrets: Record<string, string>) => encryptSecret(JSON.stringify(secrets));

// ---------------------------------------------------------------- webhooks

/**
 * Apply a provider event exactly once. Duplicate deliveries (same provider event id) and
 * repeat results for an already-paid checkout are acknowledged without doing anything.
 */
export async function applyProviderEvent(provider: ProviderName, institutionId: number, ev: ProviderEvent, payload: unknown): Promise<'processed' | 'duplicate' | 'ignored' | 'amount_mismatch' | 'unknown_reference'> {
  const { rows: rec } = await db.query<{ id: number }>(
    `INSERT INTO payment_provider_events (institution_id, provider, event_id, type, payload, signature_valid) VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT ON CONSTRAINT payment_provider_events_provider_event_id_key DO NOTHING RETURNING id`,
    [institutionId, provider, ev.eventId, ev.type, JSON.stringify(payload ?? {})]
  );
  if (!rec[0]) return 'duplicate';
  const done = async (result: Awaited<ReturnType<typeof applyProviderEvent>>, error: string | null = null) => {
    await db.query(`UPDATE payment_provider_events SET result = $2, error = $3, processed_at = now() WHERE id = $1`, [rec[0]!.id, result, error]);
    return result;
  };
  if (ev.type === 'ignored') return done('ignored');
  if (ev.type === 'refund.succeeded') {
    const { rows } = await db.query<{ id: number }>(`SELECT id FROM payments WHERE provider = $1 AND provider_ref = $2 AND institution_id = $3`, [provider, ev.providerRef, institutionId]);
    return done(rows[0] ? 'processed' : 'unknown_reference');
  }
  const { rows: cs } = await db.query<{ id: number; invoice_id: number; amount: string; status: string }>(
    `SELECT id, invoice_id, amount, status FROM checkout_sessions WHERE reference = $1 AND institution_id = $2 AND provider = $3 FOR UPDATE`,
    [ev.reference, institutionId, provider]
  );
  const session = cs[0];
  if (!session) return done('unknown_reference', `no checkout ${ev.reference}`);
  if (session.status === 'succeeded') return done('duplicate');
  if (ev.type === 'payment.failed') {
    await db.query(`UPDATE checkout_sessions SET status = 'failed', completed_at = now() WHERE id = $1`, [session.id]);
    return done('processed');
  }
  if (ev.amount != null && Math.abs(Number(ev.amount) - Number(session.amount)) > 0.009) {
    return done('amount_mismatch', `paid ${ev.amount}, expected ${session.amount}`);
  }
  const inv = await loadInvoice(session.invoice_id, institutionId);
  const { rows: inv2 } = await db.query<{ id: number; institution_id: number; student_id: number | null; total: string; paid: string; status: string }>(
    `SELECT id, institution_id, student_id, total, paid, status FROM invoices WHERE id = $1 FOR UPDATE`,
    [inv.id]
  );
  const pay = await recordPayment(inv2[0]!, { amount: Math.min(Number(session.amount), balanceOf(inv2[0]!)), method: 'online', provider, providerRef: ev.providerRef ?? ev.eventId });
  await db.query(`UPDATE checkout_sessions SET status = 'succeeded', completed_at = now(), payment_id = $2 WHERE id = $1`, [session.id, pay.id]);
  return done('processed');
}

// ---------------------------------------------------------------- late fines

/** Charge late fines that are due today (idempotent: one line per invoice and day). */
export async function chargeLateFines(institutionId: number, today: string) {
  const { rows } = await db.query<{ id: number; due_date: string; total: string; paid: string; late_fine: { kind: string; amount?: number; grace_days?: number; max?: number }; fines: string }>(
    `SELECT i.id, i.due_date, i.total, i.paid, s.late_fine,
            (SELECT COALESCE(sum(amount), 0) FROM invoice_items x WHERE x.invoice_id = i.id AND x.kind = 'fine') AS fines
       FROM invoices i JOIN fee_structures s ON s.id = i.structure_id
      WHERE i.institution_id = $1 AND i.status IN ('issued', 'partially_paid') AND s.late_fine->>'kind' IN ('per_day', 'flat')
        AND i.due_date + COALESCE((s.late_fine->>'grace_days')::int, 0) < $2::date`,
    [institutionId, today]
  );
  let charged = 0;
  for (const r of rows) {
    const rule = r.late_fine;
    const amount = Number(rule.amount ?? 0);
    if (amount <= 0) continue;
    const max = rule.max ? Number(rule.max) : Infinity;
    const already = Number(r.fines);
    if (already >= max) continue;
    const add = Math.min(amount, max - already);
    // flat: once, dated on the due date; per day: one line for today
    const fineDate = rule.kind === 'flat' ? r.due_date : today;
    const res = await db.query(
      `INSERT INTO invoice_items (institution_id, invoice_id, kind, head, label, amount, fine_date) VALUES ($1,$2,'fine','Late fine',$3,$4,$5)
       ON CONFLICT ON CONSTRAINT invoice_items_invoice_id_fine_date_key DO NOTHING`,
      [institutionId, r.id, rule.kind === 'flat' ? 'Late fine' : `Late fine (${today})`, add, fineDate]
    );
    if (res.rowCount) {
      charged++;
      await recalcInvoice(r.id);
    }
  }
  return charged;
}

// ---------------------------------------------------------------- reconciliation

export interface ReconcileResult {
  matched: { receipt_no: string; provider_ref: string; amount: number }[];
  missing_in_acadex: Settlement[];
  missing_at_provider: { receipt_no: string; provider_ref: string | null; amount: number; received_at: string }[];
  amount_mismatch: { receipt_no: string; provider_ref: string; ours: number; theirs: number }[];
}

/** Compare our payments for a provider and period with what it settled; mark matched ones reconciled. */
export async function reconcile(institutionId: number, provider: string, from: string, to: string, settled: Settlement[]): Promise<ReconcileResult> {
  const { rows: ours } = await db.query<{ id: number; receipt_no: string; provider_ref: string | null; amount: string; received_at: Date; invoice_number: string }>(
    `SELECT p.id, p.receipt_no, p.provider_ref, p.amount, p.received_at, i.number AS invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.institution_id = $1 AND COALESCE(p.provider, p.method) = $2 AND p.received_at::date BETWEEN $3 AND $4`,
    [institutionId, provider, from, to]
  );
  const out: ReconcileResult = { matched: [], missing_in_acadex: [], missing_at_provider: [], amount_mismatch: [] };
  const used = new Set<number>();
  for (const s of settled) {
    // online: by the provider's reference; bank statements: by the invoice number in the narration
    const p = ours.find((o) => !used.has(o.id) && ((o.provider_ref && o.provider_ref === s.providerRef) || (s.reference && (s.reference.includes(o.invoice_number) || s.reference.includes(o.receipt_no)))));
    if (!p) {
      out.missing_in_acadex.push(s);
      continue;
    }
    used.add(p.id);
    if (Math.abs(Number(p.amount) - s.amount) > 0.009) out.amount_mismatch.push({ receipt_no: p.receipt_no, provider_ref: s.providerRef, ours: Number(p.amount), theirs: s.amount });
    else {
      out.matched.push({ receipt_no: p.receipt_no, provider_ref: s.providerRef, amount: s.amount });
      await db.query(`UPDATE payments SET reconciled_at = COALESCE(reconciled_at, now()) WHERE id = $1`, [p.id]);
    }
  }
  for (const o of ours) if (!used.has(o.id)) out.missing_at_provider.push({ receipt_no: o.receipt_no, provider_ref: o.provider_ref, amount: Number(o.amount), received_at: o.received_at.toISOString() });
  return out;
}

/** A one-off invoice (counter collection, application fee, a charge outside any fee structure). */
export async function createAdhocInvoice(
  institutionId: number,
  o: { studentId?: number | null; applicationId?: number | null; title: string; lines: { head: string; label: string; amount: number; kind?: string }[]; issueDate: string; dueDate: string; userId: number | null; notes?: string }
) {
  const { rows: inst } = await db.query<{ currency: string }>(`SELECT currency FROM institutions WHERE id = $1`, [institutionId]);
  const number = await nextNumber(institutionId, 'invoices', `INV-${o.issueDate.slice(0, 4)}`);
  const { rows } = await db.query<{ id: number; institution_id: number; student_id: number | null; total: string; paid: string; status: string }>(
    `INSERT INTO invoices (institution_id, number, student_id, application_id, title, issue_date, due_date, status, currency, pay_token, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'issued',$8,$9,$10,$11) RETURNING id, institution_id, student_id, total, paid, status`,
    [institutionId, number, o.studentId ?? null, o.applicationId ?? null, o.title, o.issueDate, o.dueDate, inst[0]!.currency, crypto.randomBytes(18).toString('base64url'), o.notes ?? '', o.userId]
  );
  for (const l of o.lines) {
    await db.query(`INSERT INTO invoice_items (institution_id, invoice_id, kind, head, label, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      institutionId, rows[0]!.id, l.kind ?? 'fee', l.head, l.label, round2(l.amount), o.userId,
    ]);
  }
  const t = await recalcInvoice(rows[0]!.id);
  return { ...rows[0]!, total: t!.total, paid: t!.paid, status: t!.status };
}

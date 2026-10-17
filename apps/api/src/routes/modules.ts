// Optional institute modules, each available when the plan includes it and the institution
// switches it on (Settings → Modules): Library, HR & payroll, Transport, Hostel, Inventory &
// assets, and Visitors. Mounted under /api.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import PDFDocument from 'pdfkit';
import { z } from 'zod';
import {
  MODULES,
  allocationBody,
  billModuleBody,
  bookBody,
  hrSettingsBody,
  id,
  inventoryItemBody,
  issueBody,
  librarySettingsBody,
  modulesBody,
  payrollRunBody,
  returnBody,
  hostelRoomBody,
  routeBody,
  salaryStructureBody,
  staffLeaveBody,
  staffSalaryBody,
  stockMoveBody,
  transportAssignBody,
  vehicleBody,
  visitorBody,
  type ModuleKey,
} from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { createAdhocInvoice } from '../lib/finance/ledger';
import { institutionTimeZone } from '../lib/institution';
import { todayIn } from '../lib/locale';
import { notify } from '../lib/notify';
import { parsePage, sendPage } from '../lib/pagination';
import { assertModule, entitlements } from '../lib/platform';
import { defineJob } from '../jobs/queue';
import { runAsSystem } from '../db/context';
import { currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';

const router = Router();

/** The module must be available and switched on; staff actions also need the permission. */
const mod = (m: ModuleKey) => async (req: Request, _res: unknown, next: (e?: unknown) => void) => {
  try {
    await assertModule(institutionId(req), m);
    next();
  } catch (e) {
    next(e);
  }
};
const settingsOf = async <T>(req: Request, key: string, schema: z.ZodType<T>): Promise<T> => {
  const { rows } = await db.query<{ v: unknown }>(`SELECT settings->'module_settings'->$2 AS v FROM institutions WHERE id = $1`, [institutionId(req), key]);
  return schema.parse(rows[0]?.v ?? {});
};
const saveSettings = (req: Request, key: string, value: unknown) =>
  db.query(
    `UPDATE institutions SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{module_settings}', COALESCE(settings->'module_settings', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)) WHERE id = $1`,
    [institutionId(req), key, JSON.stringify(value)]
  );

// ---------------------------------------------------------------- the module switchboard

/** Which modules the plan allows and which are on. */
router.get('/modules', async (req, res) => {
  const e = await entitlements(institutionId(req));
  res.json({ plan: e.plan.name, allowed: e.allowedModules, enabled: e.modules, all: MODULES });
});

router.put('/modules', requirePermission('settings.manage'), async (req, res) => {
  const b = modulesBody.parse(req.body);
  const e = await entitlements(institutionId(req));
  for (const [m, on] of Object.entries(b.modules)) if (on && !e.allowedModules.includes(m as ModuleKey)) throw forbidden(`Your plan does not include ${m} — upgrade under Billing`, 'PLAN_MODULE');
  await db.query(`UPDATE institutions SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{modules}', COALESCE(settings->'modules', '{}'::jsonb) || $2::jsonb) WHERE id = $1`, [
    institutionId(req),
    JSON.stringify(b.modules),
  ]);
  const after = await entitlements(institutionId(req));
  res.json({ enabled: after.modules });
});

// ---------------------------------------------------------------- library

const lib = Router();
lib.use('/library', mod('library'));
const libManage = requirePermission('library.manage');

lib.get('/library/settings', async (req, res) => res.json(await settingsOf(req, 'library', librarySettingsBody)));
lib.put('/library/settings', libManage, async (req, res) => {
  const b = librarySettingsBody.parse(req.body);
  await saveSettings(req, 'library', b);
  res.json(b);
});

/** The catalogue (search by title, author, ISBN). */
lib.get('/library/books', async (req, res) => {
  const pg = parsePage(req.query);
  const q = `%${z.string().max(100).catch('').parse(req.query.q ?? '').trim()}%`;
  const { rows } = await db.query(
    `SELECT b.*, (SELECT count(*) FROM library_copies c WHERE c.book_id = b.id AND c.status <> 'withdrawn')::int AS copies,
            (SELECT count(*) FROM library_copies c WHERE c.book_id = b.id AND c.status = 'available')::int AS available, count(*) OVER () AS _total
       FROM library_books b WHERE b.institution_id = $1 AND (b.title ILIKE $2 OR b.authors ILIKE $2 OR b.isbn ILIKE $2 OR b.category ILIKE $2)
      ORDER BY b.title LIMIT $3 OFFSET $4`,
    [institutionId(req), q, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

lib.post('/library/books', libManage, async (req, res) => {
  const b = bookBody.parse(req.body);
  const inst = institutionId(req);
  try {
    const out = await withTransaction(async () => {
      const { rows } = await db.query(
        `INSERT INTO library_books (institution_id, title, authors, isbn, publisher, year, category, language, shelf) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [inst, b.title, b.authors, b.isbn, b.publisher, b.year, b.category, b.language, b.shelf]
      );
      if (b.copies.length) await db.query(`INSERT INTO library_copies (institution_id, book_id, barcode) SELECT $1, $2, x FROM unnest($3::text[]) x`, [inst, rows[0].id, b.copies]);
      return rows[0];
    });
    res.status(201).json(out);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('One of these barcodes is already in use', 'BARCODE_TAKEN');
    throw e;
  }
});

lib.post('/library/books/:id/copies', libManage, async (req, res) => {
  const b = z.object({ barcodes: z.array(z.string().trim().min(1).max(60)).min(1).max(200) }).parse(req.body);
  const bookId = id.parse(req.params.id);
  const { rows } = await db.query(`SELECT 1 FROM library_books WHERE id = $1 AND institution_id = $2`, [bookId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  try {
    await db.query(`INSERT INTO library_copies (institution_id, book_id, barcode) SELECT $1, $2, x FROM unnest($3::text[]) x`, [institutionId(req), bookId, b.barcodes]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('One of these barcodes is already in use', 'BARCODE_TAKEN');
    throw e;
  }
  res.status(201).json({ added: b.barcodes.length });
});

lib.delete('/library/books/:id', libManage, async (req, res) => {
  const bookId = id.parse(req.params.id);
  const { rows } = await db.query(`SELECT 1 FROM library_loans l JOIN library_copies c ON c.id = l.copy_id WHERE c.book_id = $1 AND l.returned_at IS NULL LIMIT 1`, [bookId]);
  if (rows[0]) throw conflict('Copies of this book are on loan', 'ON_LOAN');
  const { rowCount } = await db.query(`DELETE FROM library_books WHERE id = $1 AND institution_id = $2`, [bookId, institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

async function copyByBarcode(req: Request, barcode: string) {
  const { rows } = await db.query<{ id: number; status: string; book_id: number; title: string; price: string | null }>(
    `SELECT c.id, c.status, c.book_id, b.title, c.price FROM library_copies c JOIN library_books b ON b.id = c.book_id WHERE c.institution_id = $1 AND c.barcode = $2`,
    [institutionId(req), barcode]
  );
  if (!rows[0]) throw notFound('No copy with that barcode');
  return rows[0];
}

/** Lend a copy (scan its barcode) to a student or member of staff. */
lib.post('/library/issue', libManage, async (req, res) => {
  const b = issueBody.parse(req.body);
  const inst = institutionId(req);
  const s = await settingsOf(req, 'library', librarySettingsBody);
  const copy = await copyByBarcode(req, b.barcode);
  if (copy.status !== 'available') throw conflict(`This copy is ${copy.status}`, 'NOT_AVAILABLE');
  const { rows: who } = await db.query<{ id: number; full_name: string }>(`SELECT id, full_name FROM users WHERE id = $1 AND institution_id = $2 AND is_active AND role IN ('student', 'teacher', 'institution_admin')`, [b.borrower_id, inst]);
  if (!who[0]) throw badRequest('Choose a student or member of staff');
  const { rows: open } = await db.query<{ n: number; overdue: number }>(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE due_on < CURRENT_DATE)::int AS overdue FROM library_loans WHERE borrower_id = $1 AND returned_at IS NULL`,
    [b.borrower_id]
  );
  if ((open[0]?.overdue ?? 0) > 0) throw conflict(`${who[0].full_name} has an overdue book — return it first`, 'HAS_OVERDUE');
  if ((open[0]?.n ?? 0) >= s.max_loans) throw conflict(`${who[0].full_name} already has ${s.max_loans} books`, 'MAX_LOANS');
  const due = b.due_on ?? new Date(Date.now() + s.loan_days * 86_400_000).toISOString().slice(0, 10);
  const out = await withTransaction(async () => {
    const { rows } = await db.query(`INSERT INTO library_loans (institution_id, copy_id, borrower_id, due_on, issued_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [inst, copy.id, b.borrower_id, due, currentUser(req).id]);
    await db.query(`UPDATE library_copies SET status = 'issued' WHERE id = $1`, [copy.id]);
    return rows[0];
  });
  res.status(201).json({ ...out, title: copy.title, borrower: who[0].full_name });
});

/** Take a copy back (scan it); late returns get the daily fine, lost copies their price. */
lib.post('/library/return', libManage, async (req, res) => {
  const b = returnBody.parse(req.body);
  const s = await settingsOf(req, 'library', librarySettingsBody);
  const copy = await copyByBarcode(req, b.barcode);
  const { rows } = await db.query<{ id: number; due_on: string; borrower_id: number }>(`SELECT id, to_char(due_on, 'YYYY-MM-DD') AS due_on, borrower_id FROM library_loans WHERE copy_id = $1 AND returned_at IS NULL`, [copy.id]);
  const loan = rows[0];
  if (!loan) throw conflict('This copy is not on loan', 'NOT_ON_LOAN');
  const today = todayIn(await institutionTimeZone(institutionId(req)));
  const late = Math.max(0, Math.round((Date.parse(today) - Date.parse(loan.due_on)) / 86_400_000));
  const fine = late * s.fine_per_day + (b.lost ? Number(copy.price ?? 0) : 0);
  await withTransaction(async () => {
    await db.query(`UPDATE library_loans SET returned_at = now(), fine = $2::numeric, fine_paid = ($2::numeric = 0) WHERE id = $1`, [loan.id, fine]);
    await db.query(`UPDATE library_copies SET status = $2 WHERE id = $1`, [copy.id, b.lost ? 'lost' : 'available']);
  });
  res.json({ loan_id: loan.id, days_late: late, fine, title: copy.title });
});

lib.post('/library/loans/:id/renew', async (req, res) => {
  const loanId = id.parse(req.params.id);
  const s = await settingsOf(req, 'library', librarySettingsBody);
  const { rows } = await db.query<{ id: number; borrower_id: number; renewals: number; due_on: string }>(
    `SELECT id, borrower_id, renewals, to_char(due_on, 'YYYY-MM-DD') AS due_on FROM library_loans WHERE id = $1 AND institution_id = $2 AND returned_at IS NULL`,
    [loanId, institutionId(req)]
  );
  const l = rows[0];
  if (!l || (l.borrower_id !== currentUser(req).id && !userCan(req, 'library.manage'))) throw notFound();
  if (l.renewals >= 2) throw conflict('This loan was already renewed twice', 'MAX_RENEWALS');
  if (l.due_on < new Date().toISOString().slice(0, 10)) throw conflict('Overdue books cannot be renewed — please return it', 'OVERDUE');
  const { rows: out } = await db.query(`UPDATE library_loans SET due_on = due_on + $2::int, renewals = renewals + 1 WHERE id = $1 RETURNING id, due_on, renewals`, [l.id, s.loan_days]);
  res.json(out[0]);
});

lib.post('/library/loans/:id/pay-fine', libManage, async (req, res) => {
  const { rowCount } = await db.query(`UPDATE library_loans SET fine_paid = true WHERE id = $1 AND institution_id = $2 AND fine > 0`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.json({ ok: true });
});

/** Loans: open, overdue or with unpaid fines (the library desk). */
lib.get('/library/loans', libManage, async (req, res) => {
  const pg = parsePage(req.query);
  const f = z.enum(['open', 'overdue', 'fines', 'all']).catch('open').parse(req.query.status);
  const { rows } = await db.query(
    `SELECT l.id, b.title, c.barcode, u.full_name AS borrower, u.role, l.issued_at, l.due_on, l.returned_at, l.renewals, l.fine::float, l.fine_paid,
            (l.returned_at IS NULL AND l.due_on < CURRENT_DATE) AS overdue, count(*) OVER () AS _total
       FROM library_loans l JOIN library_copies c ON c.id = l.copy_id JOIN library_books b ON b.id = c.book_id JOIN users u ON u.id = l.borrower_id
      WHERE l.institution_id = $1 AND ($2 = 'all' OR ($2 = 'open' AND l.returned_at IS NULL) OR ($2 = 'overdue' AND l.returned_at IS NULL AND l.due_on < CURRENT_DATE) OR ($2 = 'fines' AND l.fine > 0 AND NOT l.fine_paid))
      ORDER BY l.due_on LIMIT $3 OFFSET $4`,
    [institutionId(req), f, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

/** My loans (and, for guardians, their children's). */
lib.get('/library/my-loans', async (req, res) => {
  const u = currentUser(req);
  const { rows } = await db.query(
    `SELECT l.id, b.title, b.authors, l.issued_at, l.due_on, l.returned_at, l.renewals, l.fine::float, l.fine_paid, bu.full_name AS borrower,
            (l.returned_at IS NULL AND l.due_on < CURRENT_DATE) AS overdue
       FROM library_loans l JOIN library_copies c ON c.id = l.copy_id JOIN library_books b ON b.id = c.book_id JOIN users bu ON bu.id = l.borrower_id
      WHERE l.institution_id = $1 AND (l.borrower_id = $2 OR ($3 = 'parent' AND bu.role = 'student' AND bu.ref_id IN
              (SELECT gs.student_id FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id WHERE g.user_id = $2)))
        AND (l.returned_at IS NULL OR l.returned_at > now() - interval '180 days')
      ORDER BY l.returned_at NULLS FIRST, l.due_on`,
    [institutionId(req), u.id, u.role]
  );
  res.json(rows);
});

// ---------------------------------------------------------------- HR and payroll

const hr = Router();
hr.use('/hr', mod('hr'));
const hrManage = requirePermission('hr.manage');

hr.get('/hr/settings', async (req, res) => res.json(await settingsOf(req, 'hr', hrSettingsBody)));
hr.put('/hr/settings', hrManage, async (req, res) => {
  const b = hrSettingsBody.parse(req.body);
  await saveSettings(req, 'hr', b);
  res.json(b);
});

hr.get('/hr/structures', hrManage, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM salary_structures WHERE institution_id = $1 ORDER BY name`, [institutionId(req)]);
  res.json(rows);
});
hr.post('/hr/structures', hrManage, async (req, res) => {
  const b = salaryStructureBody.parse(req.body);
  const { rows } = await db.query(`INSERT INTO salary_structures (institution_id, name, components) VALUES ($1,$2,$3) RETURNING *`, [institutionId(req), b.name, JSON.stringify(b.components)]);
  res.status(201).json(rows[0]);
});
hr.put('/hr/structures/:id', hrManage, async (req, res) => {
  const b = salaryStructureBody.parse(req.body);
  const { rows } = await db.query(`UPDATE salary_structures SET name = $3, components = $4 WHERE id = $1 AND institution_id = $2 RETURNING *`, [id.parse(req.params.id), institutionId(req), b.name, JSON.stringify(b.components)]);
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});

/** Staff with their current salary. */
hr.get('/hr/salaries', hrManage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.id AS teacher_id, t.first_name || ' ' || t.last_name AS name, t.designation, s.basic::float, s.structure_id, st.name AS structure, s.bank_account, s.effective_from
       FROM teachers t LEFT JOIN LATERAL (SELECT * FROM staff_salaries x WHERE x.teacher_id = t.id AND x.effective_from <= CURRENT_DATE ORDER BY x.effective_from DESC LIMIT 1) s ON true
       LEFT JOIN salary_structures st ON st.id = s.structure_id
      WHERE t.institution_id = $1 AND t.deleted_at IS NULL ORDER BY name`,
    [institutionId(req)]
  );
  res.json(rows);
});
hr.put('/hr/salaries', hrManage, async (req, res) => {
  const b = staffSalaryBody.parse(req.body);
  const inst = institutionId(req);
  const { rows: t } = await db.query(`SELECT 1 FROM teachers WHERE id = $1 AND institution_id = $2`, [b.teacher_id, inst]);
  if (!t[0]) throw badRequest('Choose a member of staff');
  if (b.structure_id) {
    const { rows: s } = await db.query(`SELECT 1 FROM salary_structures WHERE id = $1 AND institution_id = $2`, [b.structure_id, inst]);
    if (!s[0]) throw badRequest('Choose one of your salary structures');
  }
  const { rows } = await db.query(
    `INSERT INTO staff_salaries (institution_id, teacher_id, structure_id, basic, bank_account, effective_from) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT ON CONSTRAINT staff_salaries_teacher_id_effective_from_key DO UPDATE SET structure_id = EXCLUDED.structure_id, basic = EXCLUDED.basic, bank_account = EXCLUDED.bank_account RETURNING *`,
    [inst, b.teacher_id, b.structure_id ?? null, b.basic, b.bank_account, b.effective_from]
  );
  res.json(rows[0]);
});

interface Component {
  name: string;
  kind: 'earning' | 'deduction';
  calc: 'fixed' | 'percent_of_basic';
  value: number;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Payroll for a month: a payslip per member of staff with a salary; unpaid leave and absences are deducted pro rata. */
hr.post('/hr/payroll', hrManage, async (req, res) => {
  const b = payrollRunBody.parse(req.body);
  const inst = institutionId(req);
  const s = await settingsOf(req, 'hr', hrSettingsBody);
  const monthEnd = new Date(Date.UTC(Number(b.month.slice(0, 4)), Number(b.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const out = await withTransaction(async () => {
    const { rows: run } = await db.query<{ id: number }>(`INSERT INTO payroll_runs (institution_id, month, created_by) VALUES ($1,$2,$3) ON CONFLICT ON CONSTRAINT payroll_runs_institution_id_month_key DO NOTHING RETURNING id`, [inst, b.month, currentUser(req).id]);
    if (!run[0]) throw conflict('There is already a payroll for this month', 'EXISTS');
    const { rows: staff } = await db.query<{ teacher_id: number; basic: string; components: Component[] | null }>(
      `SELECT DISTINCT ON (x.teacher_id) x.teacher_id, x.basic, st.components FROM staff_salaries x JOIN teachers t ON t.id = x.teacher_id AND t.deleted_at IS NULL
         LEFT JOIN salary_structures st ON st.id = x.structure_id WHERE x.institution_id = $1 AND x.effective_from <= $2 ORDER BY x.teacher_id, x.effective_from DESC`,
      [inst, monthEnd]
    );
    let gross = 0;
    let net = 0;
    for (const p of staff) {
      const basic = Number(p.basic);
      // unpaid days: approved unpaid leave in the month, plus marked absences not covered by approved leave
      const { rows: d } = await db.query<{ unpaid: string }>(
        `SELECT (COALESCE((SELECT sum(LEAST(l.to_date, $3::date) - GREATEST(l.from_date, $2::date) + 1) FROM staff_leaves l
                   WHERE l.teacher_id = $1 AND l.status = 'approved' AND l.kind = 'unpaid' AND l.from_date <= $3 AND l.to_date >= $2), 0)
               + (SELECT count(*) FROM teacher_attendance a WHERE a.teacher_id = $1 AND a.status = 'Absent' AND a.att_date BETWEEN $2 AND $3
                   AND NOT EXISTS (SELECT 1 FROM staff_leaves l WHERE l.teacher_id = $1 AND l.status = 'approved' AND a.att_date BETWEEN l.from_date AND l.to_date)))::text AS unpaid`,
        [p.teacher_id, `${b.month}-01`, monthEnd]
      );
      const unpaid = Number(d[0]?.unpaid ?? 0);
      const earnings: { name: string; amount: number }[] = [];
      const deductions: { name: string; amount: number }[] = [];
      for (const c of p.components ?? []) {
        const amount = round2(c.calc === 'fixed' ? c.value : (basic * c.value) / 100);
        (c.kind === 'earning' ? earnings : deductions).push({ name: c.name, amount });
      }
      if (unpaid > 0) deductions.push({ name: `Unpaid days (${unpaid})`, amount: round2((basic / s.working_days_per_month) * unpaid) });
      const g = round2(basic + earnings.reduce((n, e) => n + e.amount, 0));
      const nt = round2(g - deductions.reduce((n, e) => n + e.amount, 0));
      gross += g;
      net += nt;
      await db.query(
        `INSERT INTO payslips (institution_id, run_id, teacher_id, basic, earnings, deductions, unpaid_days, gross, net) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [inst, run[0].id, p.teacher_id, basic, JSON.stringify(earnings), JSON.stringify(deductions), unpaid, g, Math.max(0, nt)]
      );
    }
    await db.query(`UPDATE payroll_runs SET total_gross = $2, total_net = $3 WHERE id = $1`, [run[0].id, round2(gross), round2(net)]);
    return { id: run[0].id, payslips: staff.length, total_gross: round2(gross), total_net: round2(net) };
  });
  res.status(201).json(out);
});

hr.get('/hr/payroll', hrManage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, r.total_gross::float AS total_gross, r.total_net::float AS total_net, (SELECT count(*) FROM payslips p WHERE p.run_id = r.id)::int AS payslips
       FROM payroll_runs r WHERE r.institution_id = $1 ORDER BY r.month DESC`,
    [institutionId(req)]
  );
  res.json(rows);
});

hr.get('/hr/payroll/:id', hrManage, async (req, res) => {
  const runId = id.parse(req.params.id);
  const { rows: run } = await db.query(`SELECT * FROM payroll_runs WHERE id = $1 AND institution_id = $2`, [runId, institutionId(req)]);
  if (!run[0]) throw notFound();
  const { rows } = await db.query(
    `SELECT p.id, p.teacher_id, t.first_name || ' ' || t.last_name AS name, p.basic::float, p.earnings, p.deductions, p.unpaid_days::float, p.gross::float, p.net::float
       FROM payslips p JOIN teachers t ON t.id = p.teacher_id WHERE p.run_id = $1 ORDER BY name`,
    [runId]
  );
  res.json({ ...run[0], payslips: rows });
});

/** Approve (locks the numbers and tells staff their payslip is ready), then mark paid. */
hr.post('/hr/payroll/:id/:action', hrManage, async (req, res) => {
  const action = z.enum(['approve', 'paid']).parse(req.params.action);
  const runId = id.parse(req.params.id);
  const u = currentUser(req);
  const { rows } = await db.query<{ id: number; month: string }>(
    action === 'approve'
      ? `UPDATE payroll_runs SET status = 'approved', approved_by = $3, approved_at = now() WHERE id = $1 AND institution_id = $2 AND status = 'draft' RETURNING id, month`
      : `UPDATE payroll_runs SET status = 'paid', paid_at = now() WHERE id = $1 AND institution_id = $2 AND status = 'approved' AND $3::int IS NOT NULL RETURNING id, month`,
    [runId, institutionId(req), u.id]
  );
  if (!rows[0]) throw conflict(action === 'approve' ? 'Only a draft payroll can be approved' : 'Approve the payroll first', 'BAD_STATE');
  if (action === 'approve') {
    const { rows: staff } = await db.query<{ id: number }>(`SELECT u.id FROM payslips p JOIN users u ON u.ref_id = p.teacher_id AND u.role = 'teacher' WHERE p.run_id = $1`, [runId]);
    await notify({ institutionId: institutionId(req), userIds: staff.map((s) => s.id), type: 'system', title: `Your payslip for ${rows[0].month} is ready`, link: '/hr/me' });
  }
  res.json({ ok: true });
});

hr.delete('/hr/payroll/:id', hrManage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM payroll_runs WHERE id = $1 AND institution_id = $2 AND status = 'draft'`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw conflict('Only a draft payroll can be deleted', 'BAD_STATE');
  res.status(204).end();
});

/** My payslips (staff), once the payroll is approved. */
hr.get('/hr/payslips/mine', async (req, res) => {
  const u = currentUser(req);
  if (u.role !== 'teacher' || !u.ref_id) return res.json([]);
  const { rows } = await db.query(
    `SELECT p.id, r.month, r.status, p.basic::float, p.earnings, p.deductions, p.unpaid_days::float, p.gross::float, p.net::float
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.teacher_id = $1 AND r.status IN ('approved', 'paid') ORDER BY r.month DESC`,
    [u.ref_id]
  );
  res.json(rows);
});

/** A payslip as PDF (the member of staff, or HR). */
hr.get('/hr/payslips/:id/pdf', async (req, res) => {
  const slipId = id.parse(req.params.id);
  const { rows } = await db.query<{ teacher_id: number; month: string; status: string; name: string; basic: string; earnings: { name: string; amount: number }[]; deductions: { name: string; amount: number }[]; gross: string; net: string; institution: string; currency: string; bank_account: string | null }>(
    `SELECT p.teacher_id, r.month, r.status, t.first_name || ' ' || t.last_name AS name, p.basic, p.earnings, p.deductions, p.gross, p.net, i.name AS institution, i.currency,
            (SELECT bank_account FROM staff_salaries x WHERE x.teacher_id = p.teacher_id ORDER BY effective_from DESC LIMIT 1) AS bank_account
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id JOIN teachers t ON t.id = p.teacher_id JOIN institutions i ON i.id = p.institution_id
      WHERE p.id = $1 AND p.institution_id = $2`,
    [slipId, institutionId(req)]
  );
  const s = rows[0];
  const u = currentUser(req);
  if (!s || (!userCan(req, 'hr.manage') && !(u.role === 'teacher' && u.ref_id === s.teacher_id && s.status !== 'draft'))) throw notFound();
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="payslip-${s.month}.pdf"` });
  doc.pipe(res);
  const money = (n: number | string) => `${s.currency} ${Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  doc.fontSize(16).text(s.institution).fontSize(12).text(`Payslip — ${s.month}`).moveDown();
  doc.fontSize(10).text(`Name: ${s.name}`).text(`Bank account: ${s.bank_account || '—'}`).moveDown();
  doc.font('Helvetica-Bold').text('Earnings').font('Helvetica').text(`Basic salary: ${money(s.basic)}`);
  for (const e of s.earnings) doc.text(`${e.name}: ${money(e.amount)}`);
  doc.moveDown().font('Helvetica-Bold').text('Deductions').font('Helvetica');
  for (const d of s.deductions) doc.text(`${d.name}: ${money(d.amount)}`);
  if (!s.deductions.length) doc.text('None');
  doc.moveDown().font('Helvetica-Bold').text(`Gross: ${money(s.gross)}`).text(`Net pay: ${money(s.net)}`);
  doc.end();
});

// staff leave
hr.get('/hr/leaves', async (req, res) => {
  const u = currentUser(req);
  const all = userCan(req, 'hr.manage');
  if (!all && u.role !== 'teacher') return res.json([]);
  const { rows } = await db.query(
    `SELECT l.*, l.days::float AS days, t.first_name || ' ' || t.last_name AS name FROM staff_leaves l JOIN teachers t ON t.id = l.teacher_id
      WHERE l.institution_id = $1 AND ($2::boolean OR l.teacher_id = $3) ORDER BY l.from_date DESC LIMIT 200`,
    [institutionId(req), all, u.ref_id ?? 0]
  );
  res.json(rows);
});

hr.post('/hr/leaves', async (req, res) => {
  const b = staffLeaveBody.parse(req.body);
  const u = currentUser(req);
  const teacherId = b.teacher_id && userCan(req, 'hr.manage') ? b.teacher_id : u.role === 'teacher' ? u.ref_id : null;
  if (!teacherId) throw forbidden();
  const { rows: t } = await db.query(`SELECT 1 FROM teachers WHERE id = $1 AND institution_id = $2`, [teacherId, institutionId(req)]);
  if (!t[0]) throw badRequest('Choose a member of staff');
  const days = Math.round((Date.parse(b.to_date) - Date.parse(b.from_date)) / 86_400_000) + 1;
  const { rows } = await db.query(
    `INSERT INTO staff_leaves (institution_id, teacher_id, kind, from_date, to_date, days, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *, days::float AS days`,
    [institutionId(req), teacherId, b.kind, b.from_date, b.to_date, days, b.reason]
  );
  res.status(201).json(rows[0]);
});

hr.patch('/hr/leaves/:id', async (req, res) => {
  const b = z.object({ status: z.enum(['approved', 'rejected', 'cancelled']) }).parse(req.body);
  const u = currentUser(req);
  const { rows } = await db.query<{ id: number; teacher_id: number; status: string; kind: string; days: string }>(`SELECT id, teacher_id, status, kind, days FROM staff_leaves WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  const l = rows[0];
  if (!l) throw notFound();
  const own = u.role === 'teacher' && u.ref_id === l.teacher_id;
  if (b.status === 'cancelled' ? !own && !userCan(req, 'hr.manage') : !userCan(req, 'hr.manage')) throw forbidden();
  if (l.status !== 'pending' && b.status !== 'cancelled') throw conflict('This request was already decided', 'DECIDED');
  if (b.status === 'approved' && l.kind !== 'unpaid') {
    const bal = await balances(req, l.teacher_id);
    const left = bal.find((x) => x.kind === l.kind)?.left;
    if (left != null && left < Number(l.days)) throw conflict(`Only ${left} ${l.kind} days left this year`, 'NO_BALANCE');
  }
  await db.query(`UPDATE staff_leaves SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [l.id, b.status, u.id]);
  if (!own) {
    const { rows: who } = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'teacher' AND ref_id = $1`, [l.teacher_id]);
    await notify({ institutionId: institutionId(req), userIds: who.map((w) => w.id), type: 'leave_decision', title: `Your leave request was ${b.status}`, link: '/hr/me' });
  }
  res.json({ ok: true });
});

async function balances(req: Request, teacherId: number) {
  const s = await settingsOf(req, 'hr', hrSettingsBody);
  const { rows } = await db.query<{ kind: string; used: string }>(
    `SELECT kind, sum(days)::text AS used FROM staff_leaves WHERE teacher_id = $1 AND status = 'approved' AND date_part('year', from_date) = date_part('year', CURRENT_DATE) GROUP BY kind`,
    [teacherId]
  );
  return Object.entries(s.leave_entitlements).map(([kind, entitled]) => {
    const used = Number(rows.find((r) => r.kind === kind)?.used ?? 0);
    return { kind, entitled, used, left: Math.max(0, (entitled ?? 0) - used) };
  });
}

hr.get('/hr/leave-balances', async (req, res) => {
  const u = currentUser(req);
  const teacherId = req.query.teacher_id && userCan(req, 'hr.manage') ? id.parse(req.query.teacher_id) : u.role === 'teacher' ? u.ref_id : null;
  if (!teacherId) return res.json([]);
  const { rows: t } = await db.query(`SELECT 1 FROM teachers WHERE id = $1 AND institution_id = $2`, [teacherId, institutionId(req)]);
  if (!t[0]) throw notFound();
  res.json(await balances(req, teacherId));
});

// ---------------------------------------------------------------- transport and hostel

const tr = Router();
tr.use('/transport', mod('transport'));
const trManage = requirePermission('transport.manage');

tr.get('/transport/vehicles', trManage, async (req, res) => res.json((await db.query(`SELECT * FROM vehicles WHERE institution_id = $1 ORDER BY registration`, [institutionId(req)])).rows));
tr.post('/transport/vehicles', trManage, async (req, res) => {
  const b = vehicleBody.parse(req.body);
  try {
    const { rows } = await db.query(`INSERT INTO vehicles (institution_id, registration, capacity, driver_name, driver_phone) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [institutionId(req), b.registration, b.capacity, b.driver_name, b.driver_phone]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('That vehicle is already listed', 'EXISTS');
    throw e;
  }
});
tr.delete('/transport/vehicles/:id', trManage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM vehicles WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

tr.get('/transport/routes', trManage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, r.fee::float AS fee, v.registration, v.capacity, (SELECT count(*) FROM transport_assignments a WHERE a.route_id = r.id)::int AS riders
       FROM transport_routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id WHERE r.institution_id = $1 ORDER BY r.name`,
    [institutionId(req)]
  );
  res.json(rows);
});
tr.post('/transport/routes', trManage, async (req, res) => {
  const b = routeBody.parse(req.body);
  if (b.vehicle_id) {
    const { rows: v } = await db.query(`SELECT 1 FROM vehicles WHERE id = $1 AND institution_id = $2`, [b.vehicle_id, institutionId(req)]);
    if (!v[0]) throw badRequest('Choose one of your vehicles');
  }
  const { rows } = await db.query(`INSERT INTO transport_routes (institution_id, name, vehicle_id, fee, stops) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [institutionId(req), b.name, b.vehicle_id ?? null, b.fee, JSON.stringify(b.stops)]);
  res.status(201).json(rows[0]);
});
tr.put('/transport/routes/:id', trManage, async (req, res) => {
  const b = routeBody.parse(req.body);
  if (b.vehicle_id) {
    const { rows: v } = await db.query(`SELECT 1 FROM vehicles WHERE id = $1 AND institution_id = $2`, [b.vehicle_id, institutionId(req)]);
    if (!v[0]) throw badRequest('Choose one of your vehicles');
  }
  const { rows } = await db.query(`UPDATE transport_routes SET name = $3, vehicle_id = $4, fee = $5, stops = $6 WHERE id = $1 AND institution_id = $2 RETURNING *`, [id.parse(req.params.id), institutionId(req), b.name, b.vehicle_id ?? null, b.fee, JSON.stringify(b.stops)]);
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});
tr.delete('/transport/routes/:id', trManage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM transport_routes WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

tr.get('/transport/assignments', trManage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.*, st.first_name || ' ' || st.last_name AS student, st.roll_no, sec.name AS section, r.name AS route
       FROM transport_assignments a JOIN students st ON st.id = a.student_id LEFT JOIN sections sec ON sec.id = st.section_id JOIN transport_routes r ON r.id = a.route_id
      WHERE a.institution_id = $1 AND ($2::int IS NULL OR a.route_id = $2) ORDER BY r.name, student`,
    [institutionId(req), req.query.route_id ? id.parse(req.query.route_id) : null]
  );
  res.json(rows);
});
tr.post('/transport/assignments', trManage, async (req, res) => {
  const b = transportAssignBody.parse(req.body);
  const inst = institutionId(req);
  const { rows: ok } = await db.query(
    `SELECT (SELECT count(*) FROM students WHERE id = $1 AND institution_id = $3)::int AS s, (SELECT count(*) FROM transport_routes WHERE id = $2 AND institution_id = $3)::int AS r,
            (SELECT v.capacity FROM transport_routes r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = $2) AS cap,
            (SELECT count(*) FROM transport_assignments WHERE route_id = $2 AND student_id <> $1)::int AS riders`,
    [b.student_id, b.route_id, inst]
  );
  if (!ok[0]?.s || !ok[0]?.r) throw badRequest('Choose one of your students and routes');
  if (ok[0].cap != null && ok[0].riders >= ok[0].cap) throw conflict('That vehicle is full', 'FULL');
  const { rows } = await db.query(
    `INSERT INTO transport_assignments (institution_id, student_id, route_id, stop, from_date) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT ON CONSTRAINT transport_assignments_student_id_key DO UPDATE SET route_id = EXCLUDED.route_id, stop = EXCLUDED.stop, from_date = EXCLUDED.from_date RETURNING *`,
    [inst, b.student_id, b.route_id, b.stop, b.from_date]
  );
  res.status(201).json(rows[0]);
});
tr.delete('/transport/assignments/:id', trManage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM transport_assignments WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

/** A student's bus (the student, or their guardian). */
tr.get('/transport/mine', async (req, res) => {
  const u = currentUser(req);
  const { rows } = await db.query(
    `SELECT st.first_name || ' ' || st.last_name AS student, r.name AS route, a.stop, r.stops, v.registration, v.driver_name, v.driver_phone
       FROM transport_assignments a JOIN students st ON st.id = a.student_id JOIN transport_routes r ON r.id = a.route_id LEFT JOIN vehicles v ON v.id = r.vehicle_id
      WHERE a.institution_id = $1 AND ((($2 = 'student') AND a.student_id = $3) OR ($2 = 'parent' AND a.student_id IN
            (SELECT gs.student_id FROM guardians g JOIN guardianships gs ON gs.guardian_id = g.id WHERE g.user_id = $4)))`,
    [institutionId(req), u.role, u.ref_id ?? 0, u.id]
  );
  res.json(rows);
});

const hs = Router();
hs.use('/hostel', mod('hostel'));
const hsManage = requirePermission('hostel.manage');
hs.get('/hostel/rooms', hsManage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, r.fee::float AS fee, (SELECT count(*) FROM hostel_allocations a WHERE a.room_id = r.id AND a.to_date IS NULL)::int AS occupied,
            (SELECT json_agg(json_build_object('id', a.id, 'student', st.first_name || ' ' || st.last_name, 'from_date', a.from_date)) FROM hostel_allocations a JOIN students st ON st.id = a.student_id WHERE a.room_id = r.id AND a.to_date IS NULL) AS residents
       FROM hostel_rooms r WHERE r.institution_id = $1 ORDER BY r.hostel, r.name`,
    [institutionId(req)]
  );
  res.json(rows);
});
hs.post('/hostel/rooms', hsManage, async (req, res) => {
  const b = hostelRoomBody.parse(req.body);
  try {
    const { rows } = await db.query(`INSERT INTO hostel_rooms (institution_id, hostel, name, capacity, fee) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [institutionId(req), b.hostel, b.name, b.capacity, b.fee]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('That room already exists', 'EXISTS');
    throw e;
  }
});
hs.delete('/hostel/rooms/:id', hsManage, async (req, res) => {
  const { rows } = await db.query(`SELECT 1 FROM hostel_allocations WHERE room_id = $1 AND to_date IS NULL LIMIT 1`, [id.parse(req.params.id)]);
  if (rows[0]) throw conflict('Students live in this room', 'OCCUPIED');
  const { rowCount } = await db.query(`DELETE FROM hostel_rooms WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});
hs.post('/hostel/allocations', hsManage, async (req, res) => {
  const b = allocationBody.parse(req.body);
  const inst = institutionId(req);
  const { rows: r } = await db.query<{ capacity: number; occupied: number; s: number }>(
    `SELECT capacity, (SELECT count(*) FROM hostel_allocations a WHERE a.room_id = r.id AND a.to_date IS NULL)::int AS occupied,
            (SELECT count(*) FROM students WHERE id = $2 AND institution_id = $3)::int AS s FROM hostel_rooms r WHERE r.id = $1 AND r.institution_id = $3`,
    [b.room_id, b.student_id, inst]
  );
  if (!r[0] || !r[0].s) throw badRequest('Choose one of your rooms and students');
  if (r[0].occupied >= r[0].capacity) throw conflict('That room is full', 'FULL');
  try {
    const { rows } = await db.query(`INSERT INTO hostel_allocations (institution_id, room_id, student_id, from_date) VALUES ($1,$2,$3,$4) RETURNING *`, [inst, b.room_id, b.student_id, b.from_date]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('This student already has a room — end that first', 'HAS_ROOM');
    throw e;
  }
});
hs.post('/hostel/allocations/:id/end', hsManage, async (req, res) => {
  const { rowCount } = await db.query(`UPDATE hostel_allocations SET to_date = CURRENT_DATE WHERE id = $1 AND institution_id = $2 AND to_date IS NULL`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.json({ ok: true });
});

/** Invoices for a month's transport or hostel charges (once per student and month). */
router.post('/modules/bill', requirePermission('fees.manage'), async (req, res) => {
  const b = billModuleBody.parse(req.body);
  const inst = institutionId(req);
  await assertModule(inst, b.kind);
  const monthEnd = new Date(Date.UTC(Number(b.month.slice(0, 4)), Number(b.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { rows: who } = await db.query<{ student_id: number; amount: string; label: string }>(
    b.kind === 'transport'
      ? `SELECT a.student_id, r.fee AS amount, 'Transport — ' || r.name AS label FROM transport_assignments a JOIN transport_routes r ON r.id = a.route_id
          WHERE a.institution_id = $1 AND a.from_date <= $2 AND r.fee > 0`
      : `SELECT a.student_id, r.fee AS amount, 'Hostel — ' || r.hostel || ' ' || r.name AS label FROM hostel_allocations a JOIN hostel_rooms r ON r.id = a.room_id
          WHERE a.institution_id = $1 AND a.from_date <= $2 AND (a.to_date IS NULL OR a.to_date >= $3::date) AND r.fee > 0`,
    b.kind === 'transport' ? [inst, monthEnd] : [inst, monthEnd, `${b.month}-01`]
  );
  const today = todayIn(await institutionTimeZone(inst));
  let created = 0;
  for (const w of who) {
    const done = await withTransaction(async () => {
      const { rows: c } = await db.query<{ id: number }>(
        `INSERT INTO module_charges (institution_id, student_id, kind, month, amount) VALUES ($1,$2,$3,$4,$5) ON CONFLICT ON CONSTRAINT module_charges_student_id_kind_month_key DO NOTHING RETURNING id`,
        [inst, w.student_id, b.kind, b.month, w.amount]
      );
      if (!c[0]) return false;
      const inv = await createAdhocInvoice(inst, { studentId: w.student_id, title: `${b.kind === 'transport' ? 'Transport' : 'Hostel'} fee — ${b.month}`, lines: [{ head: b.kind === 'transport' ? 'Transport' : 'Hostel', label: w.label, amount: Number(w.amount) }], issueDate: today, dueDate: b.due_date, userId: currentUser(req).id });
      await db.query(`UPDATE module_charges SET invoice_id = $2 WHERE id = $1`, [c[0].id, inv.id]);
      return true;
    });
    if (done) created++;
  }
  res.status(201).json({ invoices: created, skipped: who.length - created });
});

// ---------------------------------------------------------------- inventory and assets

const inv = Router();
inv.use('/inventory', mod('inventory'));
const invManage = requirePermission('inventory.manage');
inv.get('/inventory/items', invManage, async (req, res) => {
  const pg = parsePage(req.query);
  const q = `%${z.string().max(100).catch('').parse(req.query.q ?? '').trim()}%`;
  const low = req.query.low === 'true';
  const { rows } = await db.query(
    `SELECT i.*, i.quantity::float AS quantity, i.reorder_level::float AS reorder_level, u.full_name AS assigned_name, count(*) OVER () AS _total
       FROM inventory_items i LEFT JOIN users u ON u.id = i.assigned_to
      WHERE i.institution_id = $1 AND (i.name ILIKE $2 OR i.sku ILIKE $2 OR COALESCE(i.asset_tag, '') ILIKE $2 OR i.category ILIKE $2)
        AND (NOT $3::boolean OR (NOT i.is_asset AND i.quantity <= i.reorder_level))
      ORDER BY i.name LIMIT $4 OFFSET $5`,
    [institutionId(req), q, low, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});
inv.post('/inventory/items', invManage, async (req, res) => {
  const b = inventoryItemBody.parse(req.body);
  if (b.assigned_to) {
    const { rows: u } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND institution_id = $2`, [b.assigned_to, institutionId(req)]);
    if (!u[0]) throw badRequest('Choose a person in your institution');
  }
  const { rows } = await db.query(
    `INSERT INTO inventory_items (institution_id, name, sku, category, unit, quantity, reorder_level, location, is_asset, asset_tag, assigned_to, condition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [institutionId(req), b.name, b.sku, b.category, b.unit, b.is_asset ? 1 : b.quantity, b.reorder_level, b.location, b.is_asset, b.asset_tag, b.assigned_to ?? null, b.condition]
  );
  res.status(201).json(rows[0]);
});
inv.put('/inventory/items/:id', invManage, async (req, res) => {
  const b = inventoryItemBody.parse(req.body);
  if (b.assigned_to) {
    const { rows: u } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND institution_id = $2`, [b.assigned_to, institutionId(req)]);
    if (!u[0]) throw badRequest('Choose a person in your institution');
  }
  const { rows } = await db.query(
    `UPDATE inventory_items SET name = $3, sku = $4, category = $5, unit = $6, reorder_level = $7, location = $8, asset_tag = $9, assigned_to = $10, condition = $11
      WHERE id = $1 AND institution_id = $2 RETURNING *`,
    [id.parse(req.params.id), institutionId(req), b.name, b.sku, b.category, b.unit, b.reorder_level, b.location, b.asset_tag, b.assigned_to ?? null, b.condition]
  );
  if (!rows[0]) throw notFound();
  res.json(rows[0]);
});
inv.post('/inventory/items/:id/move', invManage, async (req, res) => {
  const b = stockMoveBody.parse(req.body);
  const itemId = id.parse(req.params.id);
  const out = await withTransaction(async () => {
    const { rows } = await db.query<{ quantity: string; is_asset: boolean }>(`SELECT quantity, is_asset FROM inventory_items WHERE id = $1 AND institution_id = $2 FOR UPDATE`, [itemId, institutionId(req)]);
    if (!rows[0]) throw notFound();
    if (rows[0].is_asset) throw badRequest('Assets are tracked one by one, not by quantity');
    const next = Number(rows[0].quantity) + b.change;
    if (next < 0) throw conflict('Not enough in stock', 'NOT_ENOUGH');
    await db.query(`UPDATE inventory_items SET quantity = $2 WHERE id = $1`, [itemId, next]);
    await db.query(`INSERT INTO stock_movements (institution_id, item_id, change, reason, by_user) VALUES ($1,$2,$3,$4,$5)`, [institutionId(req), itemId, b.change, b.reason, currentUser(req).id]);
    return { quantity: next };
  });
  res.json(out);
});
inv.get('/inventory/items/:id/movements', invManage, async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.id, m.change::float AS change, m.reason, m.created_at, u.full_name AS by FROM stock_movements m LEFT JOIN users u ON u.id = m.by_user
      WHERE m.item_id = $1 AND m.institution_id = $2 ORDER BY m.id DESC LIMIT 100`,
    [id.parse(req.params.id), institutionId(req)]
  );
  res.json(rows);
});
inv.delete('/inventory/items/:id', invManage, async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM inventory_items WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

// ---------------------------------------------------------------- visitors

const vis = Router();
vis.use('/visitors', mod('visitors'));
const visManage = requirePermission('visitors.manage');
vis.get('/visitors', visManage, async (req, res) => {
  const day = req.query.date ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date) : todayIn(await institutionTimeZone(institutionId(req)));
  const { rows } = await db.query(
    `SELECT v.*, h.full_name AS host, st.first_name || ' ' || st.last_name AS student FROM visitor_logs v LEFT JOIN users h ON h.id = v.host_user_id LEFT JOIN students st ON st.id = v.student_id
      WHERE v.institution_id = $1 AND (v.check_in AT TIME ZONE (SELECT timezone FROM institutions WHERE id = $1))::date = $2::date ORDER BY v.check_in DESC`,
    [institutionId(req), day]
  );
  res.json(rows);
});
vis.post('/visitors', visManage, async (req, res) => {
  const b = visitorBody.parse(req.body);
  const inst = institutionId(req);
  if (b.host_user_id) {
    const { rows } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND institution_id = $2`, [b.host_user_id, inst]);
    if (!rows[0]) throw badRequest('Choose a person in your institution');
  }
  if (b.student_id) {
    const { rows } = await db.query(`SELECT 1 FROM students WHERE id = $1 AND institution_id = $2`, [b.student_id, inst]);
    if (!rows[0]) throw badRequest('Choose one of your students');
  }
  const pass = crypto.randomInt(100000, 999999).toString();
  const { rows } = await db.query(
    `INSERT INTO visitor_logs (institution_id, campus_id, name, phone, purpose, host_user_id, student_id, pass_code, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [inst, b.campus_id ?? null, b.name, b.phone, b.purpose, b.host_user_id ?? null, b.student_id ?? null, pass, currentUser(req).id]
  );
  if (b.host_user_id) await notify({ institutionId: inst, userIds: [b.host_user_id], type: 'system', title: `Visitor at the gate: ${b.name}`, message: b.purpose });
  res.status(201).json(rows[0]);
});
vis.post('/visitors/:id/checkout', visManage, async (req, res) => {
  const { rowCount } = await db.query(`UPDATE visitor_logs SET check_out = now() WHERE id = $1 AND institution_id = $2 AND check_out IS NULL`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.json({ ok: true });
});

for (const r of [lib, hr, tr, hs, inv, vis]) router.use(r);

/** Daily: borrowers with overdue books are reminded (once per loan per week). */
export const libraryOverdueJob = defineJob<{ today?: string }>({
  name: 'library.overdue',
  cron: '0 6 * * *',
  async run({ today }) {
    const d = today ?? new Date().toISOString().slice(0, 10);
    const rows = await runAsSystem(
      async () =>
        (
          await db.query<{ id: number; institution_id: number; borrower_id: number; title: string; due_on: string }>(
            `SELECT l.id, l.institution_id, l.borrower_id, b.title, to_char(l.due_on, 'YYYY-MM-DD') AS due_on FROM library_loans l
               JOIN library_copies c ON c.id = l.copy_id JOIN library_books b ON b.id = c.book_id WHERE l.returned_at IS NULL AND l.due_on < $1::date`,
            [d]
          )
        ).rows
    );
    const week = Math.floor(Date.parse(d) / (7 * 86_400_000));
    for (const r of rows) {
      await runAsSystem(() =>
        notify({ institutionId: r.institution_id, userIds: [r.borrower_id], type: 'due_soon', title: `Library book overdue: ${r.title}`, message: `It was due on ${r.due_on}. Please return it.`, link: '/library/mine', dedupeKey: `lib:${r.id}:${week}` })
      );
    }
  },
});

export default router;

// The SaaS side of Acadex: what each institution's plan allows (limits, features, modules),
// daily usage metering with the platform's cost, monthly invoices with tax and an AI add-on,
// dunning (reminders, then suspension), full data exports (ZIP) and tenant deletion after a
// grace period.
import crypto from 'node:crypto';
import { MODULES, type ModuleKey } from '@acadex/shared';
import { getConfig } from '../config';
import { asSystem, db, inContext, runAsSystem } from '../db/context';
import { defineJob } from '../jobs/queue';
import { storage } from '../storage';
import { toCsv } from './export';
import { forbidden } from './errors';
import { logger } from './logger';
import { sendEmail } from './mailer';
import { ZipWriter } from './zip';

export interface PlanRow {
  key: string;
  name: string;
  prices: Record<string, number>;
  limits: { students?: number | null; staff?: number | null; storage_mb?: number | null; ai_usd?: number | null; messages?: number | null };
  features: { modules?: ModuleKey[]; api?: boolean; sso?: boolean; white_label?: boolean; custom_domain?: boolean; lti?: boolean };
  overage: Record<string, number>;
  trial_days: number;
}

export interface Entitlements {
  plan: PlanRow;
  /** in a trial of the plan until this date */
  trialEndsAt: Date | null;
  features: Required<Omit<PlanRow['features'], 'modules'>>;
  /** modules the plan (or an override) allows */
  allowedModules: ModuleKey[];
  /** modules the institution has switched on */
  modules: ModuleKey[];
}

/** In the caller's transaction when there is one (it sees its own uncommitted rows), else a system transaction. */
const query = async <R extends Record<string, unknown>>(sql: string, params: unknown[]) =>
  inContext() ? asSystem(() => db.query<R>(sql, params)) : runAsSystem(() => db.query<R>(sql, params));

export async function entitlements(institutionId: number): Promise<Entitlements> {
  const { rows } = await query<{ plan: string; trial_ends_at: Date | null; feature_overrides: Record<string, boolean>; modules: Record<string, boolean> | null }>(
    `SELECT plan, trial_ends_at, feature_overrides, settings->'modules' AS modules FROM institutions WHERE id = $1`,
    [institutionId]
  );
  const inst = rows[0];
  const { rows: p } = await query<PlanRow & Record<string, unknown>>(`SELECT key, name, prices, limits, features, overage, trial_days FROM plans WHERE key = $1`, [inst?.plan ?? 'free']);
  const plan: PlanRow = p[0] ?? { key: 'free', name: 'Free', prices: {}, limits: {}, features: {}, overage: {}, trial_days: 0 };
  const o = inst?.feature_overrides ?? {};
  const flag = (k: keyof Entitlements['features']) => (o[k] !== undefined ? !!o[k] : !!plan.features[k]);
  const allowed = MODULES.filter((m) => (o[m] !== undefined ? !!o[m] : (plan.features.modules ?? []).includes(m)));
  return {
    plan,
    trialEndsAt: inst?.trial_ends_at ?? null,
    features: { api: flag('api'), sso: flag('sso'), white_label: flag('white_label'), custom_domain: flag('custom_domain'), lti: flag('lti') },
    allowedModules: allowed,
    modules: allowed.filter((m) => inst?.modules?.[m] === true),
  };
}

export async function assertFeature(institutionId: number, feature: keyof Entitlements['features']): Promise<void> {
  const e = await entitlements(institutionId);
  if (!e.features[feature]) throw forbidden(`Your plan (${e.plan.name}) does not include this — upgrade under Billing`, 'PLAN_FEATURE');
}

export async function assertModule(institutionId: number, module: ModuleKey): Promise<void> {
  const e = await entitlements(institutionId);
  if (!e.allowedModules.includes(module)) throw forbidden(`Your plan (${e.plan.name}) does not include this module — upgrade under Billing`, 'PLAN_MODULE');
  if (!e.modules.includes(module)) throw forbidden('This module is switched off — turn it on under Settings → Modules', 'MODULE_OFF');
}

/** Refuses adding students beyond the plan's limit. */
export async function assertStudentCapacity(institutionId: number, adding = 1): Promise<void> {
  const e = await entitlements(institutionId);
  const limit = e.plan.limits.students;
  if (limit == null) return;
  const { rows } = await query<{ n: number }>(`SELECT count(*)::int AS n FROM students WHERE institution_id = $1 AND COALESCE(status, 'active') = 'active' AND deleted_at IS NULL`, [institutionId]);
  if ((rows[0]?.n ?? 0) + adding > limit) throw forbidden(`Your plan (${e.plan.name}) allows ${limit} active students — upgrade under Billing to add more`, 'PLAN_LIMIT');
}

/** Text messages this month against the plan's allowance (null: unlimited). */
export async function messagesLeft(institutionId: number): Promise<number | null> {
  const e = await entitlements(institutionId);
  const limit = e.plan.limits.messages;
  if (limit == null) return null;
  const { rows } = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM delivery_logs WHERE institution_id = $1 AND channel IN ('sms', 'whatsapp') AND status = 'sent' AND created_at >= date_trunc('month', now())`,
    [institutionId]
  );
  return Math.max(0, limit - (rows[0]?.n ?? 0));
}

// ---------------------------------------------------------------- usage metering

export async function platformSetting<T>(key: string, fallback: T): Promise<T> {
  const { rows } = await query<{ value: T }>(`SELECT value FROM platform_settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? fallback;
}

/** What one unit costs the platform (USD), for margins. */
export const DEFAULT_UNIT_COSTS = { storage_gb_month: 0.023, sms: 0.012, whatsapp: 0.03, email: 0.0004, student_month: 0.02 };

export async function snapshotUsage(day: string, institutionId?: number): Promise<number> {
  const { rowCount } = await query(
    `INSERT INTO usage_snapshots (institution_id, day, students, staff, storage_bytes, ai_usd, ai_tokens, sms, whatsapp, emails, active_users)
     SELECT i.id, $1::date,
            (SELECT count(*) FROM students s WHERE s.institution_id = i.id AND COALESCE(s.status, 'active') = 'active' AND s.deleted_at IS NULL),
            (SELECT count(*) FROM teachers t WHERE t.institution_id = i.id AND t.deleted_at IS NULL),
            (SELECT COALESCE(sum(f.size_bytes), 0) FROM files f WHERE f.institution_id = i.id AND f.deleted_at IS NULL),
            (SELECT COALESCE(sum(u.cost_usd), 0) FROM ai_usage u WHERE u.institution_id = i.id AND u.created_at >= $1::date AND u.created_at < $1::date + 1),
            (SELECT COALESCE(sum(u.input_tokens + u.output_tokens), 0) FROM ai_usage u WHERE u.institution_id = i.id AND u.created_at >= $1::date AND u.created_at < $1::date + 1),
            (SELECT count(*) FROM delivery_logs d WHERE d.institution_id = i.id AND d.channel = 'sms' AND d.status = 'sent' AND d.created_at >= $1::date AND d.created_at < $1::date + 1),
            (SELECT count(*) FROM delivery_logs d WHERE d.institution_id = i.id AND d.channel = 'whatsapp' AND d.status = 'sent' AND d.created_at >= $1::date AND d.created_at < $1::date + 1),
            (SELECT count(*) FROM email_outbox e WHERE e.institution_id = i.id AND e.created_at >= $1::date AND e.created_at < $1::date + 1),
            (SELECT count(*) FROM users u WHERE u.institution_id = i.id AND u.last_login_at >= $1::date AND u.last_login_at < $1::date + 1)
       FROM institutions i WHERE ($2::int IS NULL OR i.id = $2)
     ON CONFLICT ON CONSTRAINT usage_snapshots_pkey DO UPDATE SET students = EXCLUDED.students, staff = EXCLUDED.staff, storage_bytes = EXCLUDED.storage_bytes,
       ai_usd = EXCLUDED.ai_usd, ai_tokens = EXCLUDED.ai_tokens, sms = EXCLUDED.sms, whatsapp = EXCLUDED.whatsapp, emails = EXCLUDED.emails, active_users = EXCLUDED.active_users`,
    [day, institutionId ?? null]
  );
  return rowCount ?? 0;
}

export const usageJob = defineJob<{ day?: string }>({
  name: 'usage.daily',
  cron: '20 0 * * *',
  async run({ day }) {
    const d = day ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const n = await snapshotUsage(d);
    logger.info({ day: d, institutions: n }, 'usage recorded');
  },
});

/** Usage, cost to the platform and revenue per institution over a month (YYYY-MM). */
export async function costReport(month: string) {
  const unit = await platformSetting('unit_costs', DEFAULT_UNIT_COSTS);
  const { rows } = await query<{
    id: number;
    name: string;
    plan: string;
    students: number;
    storage_gb: number;
    ai_usd: number;
    sms: number;
    whatsapp: number;
    emails: number;
    revenue: Record<string, number> | null;
  }>(
    `SELECT i.id, i.name, i.plan,
            COALESCE(max(u.students), 0)::int AS students,
            COALESCE(max(u.storage_bytes), 0)::float / 1e9 AS storage_gb,
            COALESCE(sum(u.ai_usd), 0)::float AS ai_usd,
            COALESCE(sum(u.sms), 0)::int AS sms, COALESCE(sum(u.whatsapp), 0)::int AS whatsapp, COALESCE(sum(u.emails), 0)::int AS emails,
            (SELECT jsonb_object_agg(currency, total) FROM (SELECT currency, sum(total)::float AS total FROM platform_invoices pi
                WHERE pi.institution_id = i.id AND pi.status = 'paid' AND to_char(pi.period_start, 'YYYY-MM') = $1 GROUP BY currency) r) AS revenue
       FROM institutions i LEFT JOIN usage_snapshots u ON u.institution_id = i.id AND to_char(u.day, 'YYYY-MM') = $1
      GROUP BY i.id ORDER BY i.name`,
    [month]
  );
  return rows.map((r) => {
    const cost = r.storage_gb * unit.storage_gb_month + r.sms * unit.sms + r.whatsapp * unit.whatsapp + r.emails * unit.email + r.students * unit.student_month + r.ai_usd;
    const usd = r.revenue?.USD ?? 0;
    return { ...r, cost_usd: Math.round(cost * 100) / 100, revenue: r.revenue ?? {}, margin_usd: r.revenue && Object.keys(r.revenue).every((c) => c === 'USD') ? Math.round((usd - cost) * 100) / 100 : null };
  });
}

// ---------------------------------------------------------------- invoices and dunning

const TAX_DEFAULT: Record<string, { label: string; rate: number }> = { PK: { label: 'Sales tax on services', rate: 16 } };

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

/** The invoice for one institution and month (idempotent). Returns null when nothing is due. */
export async function invoiceInstitution(institutionId: number, month: string): Promise<number | null> {
  const { rows: i } = await query<{ id: number; plan: string; currency: string; country: string; billing_currency: string | null; trial_ends_at: Date | null; status: string }>(
    `SELECT id, plan, currency, country, billing->>'billing_currency' AS billing_currency, trial_ends_at, status FROM institutions WHERE id = $1`,
    [institutionId]
  );
  const inst = i[0];
  if (!inst) return null;
  const { start, end } = monthBounds(month);
  if (inst.trial_ends_at && inst.trial_ends_at.toISOString().slice(0, 10) >= end) return null;
  const e = await entitlements(institutionId);
  let currency = inst.billing_currency ?? inst.currency;
  if (e.plan.prices[currency] == null) currency = 'USD';
  const base = Number(e.plan.prices[currency] ?? 0);
  const lines: { label: string; quantity: number; unit: number; amount: number }[] = [];
  if (base > 0) lines.push({ label: `${e.plan.name} plan — ${month}`, quantity: 1, unit: base, amount: base });
  // students above the plan's limit last month, and AI beyond the included budget
  const prev = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const { rows: u } = await query<{ students: number; ai: number }>(
    `SELECT COALESCE(max(students), 0)::int AS students, COALESCE(sum(ai_usd), 0)::float AS ai FROM usage_snapshots WHERE institution_id = $1 AND to_char(day, 'YYYY-MM') = $2`,
    [institutionId, prev]
  );
  const extra = e.plan.limits.students != null ? Math.max(0, (u[0]?.students ?? 0) - e.plan.limits.students) : 0;
  const rate = Number(e.plan.overage[currency] ?? 0);
  if (extra > 0 && rate > 0) lines.push({ label: `Extra students (${prev})`, quantity: extra, unit: rate, amount: Math.round(extra * rate * 100) / 100 });
  const aiOver = e.plan.limits.ai_usd != null ? Math.max(0, (u[0]?.ai ?? 0) - e.plan.limits.ai_usd) : 0;
  if (aiOver > 0.01 && currency === 'USD') {
    const markup = await platformSetting('ai_markup', 1.25);
    lines.push({ label: `AI add-on usage (${prev})`, quantity: 1, unit: Math.round(aiOver * markup * 100) / 100, amount: Math.round(aiOver * markup * 100) / 100 });
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  if (subtotal <= 0) return null;
  const taxes = await platformSetting('tax_rates', TAX_DEFAULT);
  const tax = taxes[inst.country] ?? { label: '', rate: 0 };
  const taxAmount = Math.round(subtotal * tax.rate) / 100;
  const due = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 10)).toISOString().slice(0, 10);
  const { rows } = await query<{ id: number }>(
    `INSERT INTO platform_invoices (institution_id, number, plan, period_start, period_end, currency, lines, subtotal, tax_label, tax_rate, tax, total, due_date)
     VALUES ($1, $4, $2, $3::date, $5::date, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT ON CONSTRAINT platform_invoices_institution_id_period_start_key DO NOTHING RETURNING id`,
    [institutionId, e.plan.key, start, `ACX-${month.replace('-', '')}-${String(institutionId).padStart(5, '0')}`, end, currency, JSON.stringify(lines), subtotal, tax.label, tax.rate, taxAmount, subtotal + taxAmount, due]
  );
  const id = rows[0]?.id ?? null;
  if (id) await billingEmail(institutionId, `Your Acadex invoice for ${month}`, `Your invoice for ${month} is ready: ${currency} ${(subtotal + taxAmount).toFixed(2)}, due ${due}. Pay it under Settings → Billing: ${getConfig().appUrl}/billing`);
  return id;
}

async function billingEmail(institutionId: number, subject: string, text: string) {
  const { rows } = await query<{ to: string }>(
    `SELECT COALESCE(NULLIF(billing->>'billing_email', ''), NULLIF(contact_email, ''), (SELECT email FROM users WHERE institution_id = i.id AND role = 'institution_admin' AND is_active ORDER BY id LIMIT 1)) AS to
       FROM institutions i WHERE id = $1`,
    [institutionId]
  );
  if (rows[0]?.to) await sendEmail({ to: rows[0].to, subject, text, template: 'billing', institutionId });
}

export const billingJob = defineJob<{ month?: string }>({
  name: 'billing.monthly',
  cron: '0 4 1 * *',
  async run({ month }) {
    const m = month ?? new Date().toISOString().slice(0, 7);
    const { rows } = await query<{ id: number }>(`SELECT id FROM institutions WHERE status = 'active' AND deletion_due_at IS NULL`, []);
    let n = 0;
    for (const r of rows) if (await invoiceInstitution(r.id, m)) n++;
    logger.info({ month: m, invoices: n }, 'platform invoices issued');
  },
});

/** Overdue invoices: reminders on day 1 and 7, suspension after the grace period (21 days). */
export const dunningJob = defineJob<{ today?: string }>({
  name: 'billing.dunning',
  cron: '30 4 * * *',
  async run({ today }) {
    const d = today ?? new Date().toISOString().slice(0, 10);
    const grace = await platformSetting('suspend_after_days', 21);
    const { rows } = await query<{ id: number; institution_id: number; number: string; total: string; currency: string; due_date: string; days: number; reminders_sent: number }>(
      `UPDATE platform_invoices SET status = 'overdue' WHERE status IN ('open', 'overdue') AND due_date < $1::date
       RETURNING id, institution_id, number, total, currency, to_char(due_date, 'YYYY-MM-DD') AS due_date, ($1::date - due_date) AS days, reminders_sent`,
      [d]
    );
    for (const inv of rows) {
      const step = inv.days >= 7 ? 2 : 1;
      if (inv.reminders_sent < step) {
        await billingEmail(inv.institution_id, `Reminder: Acadex invoice ${inv.number} is overdue`, `Invoice ${inv.number} (${inv.currency} ${inv.total}) was due on ${inv.due_date}. Please pay it under Settings → Billing to avoid interruption: ${getConfig().appUrl}/billing`);
        await query(`UPDATE platform_invoices SET reminders_sent = $2 WHERE id = $1`, [inv.id, step]);
      }
      if (grace > 0 && inv.days >= grace) {
        const { rowCount } = await query(`UPDATE institutions SET status = 'suspended', suspended_reason = 'billing' WHERE id = $1 AND status = 'active'`, [inv.institution_id]);
        if (rowCount) await billingEmail(inv.institution_id, 'Your Acadex workspace is paused', `Invoice ${inv.number} is ${inv.days} days overdue, so your workspace is paused. Pay it and it reopens at once.`);
      }
    }
  },
});

/** Marks an invoice paid and reopens a workspace paused for billing. */
export async function markInvoicePaid(invoiceId: number, method: 'stripe' | 'bank' | 'manual' | 'free', reference = ''): Promise<boolean> {
  const { rows } = await query<{ institution_id: number }>(
    `UPDATE platform_invoices SET status = 'paid', paid_at = now(), method = $2, reference = $3 WHERE id = $1 AND status IN ('open', 'overdue') RETURNING institution_id`,
    [invoiceId, method, reference]
  );
  if (!rows[0]) return false;
  const { rows: open } = await query(`SELECT 1 FROM platform_invoices WHERE institution_id = $1 AND status = 'overdue' LIMIT 1`, [rows[0].institution_id]);
  if (!open[0]) await query(`UPDATE institutions SET status = 'active', suspended_reason = NULL WHERE id = $1 AND status = 'suspended' AND suspended_reason = 'billing'`, [rows[0].institution_id]);
  return true;
}

/** A Stripe Checkout page for a platform invoice (the platform's own Stripe account). */
export async function stripeCheckout(invoiceId: number): Promise<string> {
  const key = getConfig().billing.stripeSecretKey;
  if (!key) throw forbidden('Card payments are not set up — pay by bank transfer', 'NO_STRIPE');
  const { rows } = await query<{ id: number; number: string; total: string; currency: string; status: string }>(`SELECT id, number, total, currency, status FROM platform_invoices WHERE id = $1`, [invoiceId]);
  const inv = rows[0];
  if (!inv || !['open', 'overdue'].includes(inv.status)) throw forbidden('This invoice is not open');
  const app = getConfig().appUrl;
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': inv.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(Math.round(Number(inv.total) * 100)),
    'line_items[0][price_data][product_data][name]': `Acadex invoice ${inv.number}`,
    'metadata[platform_invoice_id]': String(inv.id),
    success_url: `${app}/billing?paid=1`,
    cancel_url: `${app}/billing`,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = (await res.json()) as { id?: string; url?: string; error?: { message: string } };
  if (!res.ok || !j.url) throw forbidden(j.error?.message ?? 'Stripe refused the payment');
  await query(`UPDATE platform_invoices SET checkout_id = $2 WHERE id = $1`, [inv.id, j.id]);
  return j.url;
}

// ---------------------------------------------------------------- exports and deletion

/** Tables holding an institution's rows (every table with institution_id). */
async function tenantTables(): Promise<string[]> {
  const { rows } = await query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'institution_id' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name`,
    []
  );
  return rows.map((r) => r.table_name);
}

const SECRET_COLUMNS = /^(password_hash|secret_sealed|key_hash|token_hash|secret|totp_secret|code_hash|refresh_hash)$/;

function csvOf(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!).filter((c) => !SECRET_COLUMNS.test(c));
  return toCsv(cols, rows.map((r) => cols.map((c) => { const v = r[c]; return v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : (v as string | number); })));
}

export async function buildExport(exportId: number): Promise<void> {
  const { rows } = await query<{ id: number; institution_id: number; scope: string; subject_user_id: number | null }>(`SELECT id, institution_id, scope, subject_user_id FROM data_exports WHERE id = $1`, [exportId]);
  const ex = rows[0];
  if (!ex) return;
  await query(`UPDATE data_exports SET status = 'running' WHERE id = $1`, [ex.id]);
  try {
    const zip = new ZipWriter();
    const inst = ex.institution_id;
    if (ex.scope === 'institution') {
      for (const t of await tenantTables()) {
        const { rows: data } = await query<Record<string, unknown>>(`SELECT * FROM ${t} WHERE institution_id = $1`, [inst]);
        if (data.length) zip.add(`data/${t}.csv`, csvOf(data));
      }
      const { rows: inst_ } = await query<Record<string, unknown>>(`SELECT * FROM institutions WHERE id = $1`, [inst]);
      zip.add('data/institution.csv', csvOf(inst_));
      const { rows: files } = await query<{ id: number; storage_key: string; original_name: string }>(`SELECT id, storage_key, original_name FROM files WHERE institution_id = $1 AND deleted_at IS NULL`, [inst]);
      for (const f of files) {
        try {
          zip.add(`files/${f.id}-${f.original_name.replace(/[\\/:*?"<>|]+/g, '_')}`, await storage().get(f.storage_key));
        } catch (e) {
          logger.warn({ err: e, file: f.id }, 'export: file missing');
        }
      }
    } else {
      // one person: their account and every row that points at them or their student record
      const uid = ex.subject_user_id!;
      const { rows: u } = await query<{ role: string; ref_id: number | null }>(`SELECT role, ref_id FROM users WHERE id = $1 AND institution_id = $2`, [uid, inst]);
      const { rows: me } = await query<Record<string, unknown>>(`SELECT * FROM users WHERE id = $1`, [uid]);
      zip.add('data/account.csv', csvOf(me));
      const studentId = u[0]?.role === 'student' ? u[0].ref_id : null;
      const { rows: cols } = await query<{ table_name: string; column_name: string }>(
        `SELECT c.table_name, c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
          WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name IN ('user_id', 'student_id', 'sender_id', 'author_id', 'raised_by', 'borrower_id') ORDER BY 1, 2`,
        []
      );
      for (const c of cols) {
        const value = c.column_name === 'student_id' ? studentId : uid;
        if (value == null) continue;
        const { rows: data } = await query<Record<string, unknown>>(`SELECT * FROM ${c.table_name} WHERE ${c.column_name} = $1 LIMIT 50000`, [value]);
        if (data.length) zip.add(`data/${c.table_name}.${c.column_name}.csv`, csvOf(data));
      }
      if (studentId) {
        const { rows: s } = await query<Record<string, unknown>>(`SELECT * FROM students WHERE id = $1`, [studentId]);
        zip.add('data/student.csv', csvOf(s));
      }
    }
    zip.add('README.txt', `Acadex data export ${ex.scope === 'institution' ? 'of your institution' : 'of one person'}\nCreated ${new Date().toISOString()}\nEach CSV holds the rows of one table (UTF-8). Secrets such as password hashes are left out.\n`);
    const buf = zip.finish();
    const key = `exports/${inst}/${ex.id}-${crypto.randomBytes(8).toString('hex')}.zip`;
    await storage().put(key, buf, 'application/zip');
    await query(`UPDATE data_exports SET status = 'done', storage_key = $2, size_bytes = $3, completed_at = now(), expires_at = now() + interval '7 days' WHERE id = $1`, [ex.id, key, buf.length]);
  } catch (e) {
    logger.error({ err: e, exportId }, 'export failed');
    await query(`UPDATE data_exports SET status = 'failed', error = $2 WHERE id = $1`, [ex.id, (e as Error).message.slice(0, 500)]);
  }
}

export const exportJob = defineJob<{ id: number }>({
  name: 'export.build',
  retryLimit: 1,
  async run({ id }) {
    await buildExport(id);
  },
});

/** Daily: expired exports are removed; institutions past their deletion date are erased. */
export const tenantCleanupJob = defineJob<{ now?: string }>({
  name: 'tenants.cleanup',
  cron: '45 3 * * *',
  async run({ now }) {
    const at = now ? new Date(now) : new Date();
    const { rows: old } = await query<{ id: number; storage_key: string | null }>(`UPDATE data_exports SET status = 'expired' WHERE status = 'done' AND expires_at < $1 RETURNING id, storage_key`, [at]);
    for (const e of old) if (e.storage_key) await storage().delete(e.storage_key).catch(() => {});
    const { rows: due } = await query<{ id: number; name: string }>(`SELECT id, name FROM institutions WHERE deletion_due_at IS NOT NULL AND deletion_due_at < $1`, [at]);
    for (const inst of due) {
      const { rows: files } = await query<{ storage_key: string }>(`SELECT storage_key FROM files WHERE institution_id = $1`, [inst.id]);
      for (const f of files) await storage().delete(f.storage_key).catch(() => {});
      // the institution's own audit trail goes with it; nothing is audited while it is erased
      await runAsSystem(async () => {
        await db.query(`SELECT set_config('app.audit', 'off', true)`);
        await db.query(`DELETE FROM institutions WHERE id = $1`, [inst.id]);
      });
      await query(`INSERT INTO audit_log (institution_id, actor, action, entity, detail) VALUES (NULL, 'system', 'tenant_deleted', 'Institution', $1)`, [`${inst.name} (#${inst.id})`]);
      logger.warn({ institution: inst.id }, 'institution erased after its grace period');
    }
  },
});

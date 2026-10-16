// Fee reminders (before and after the due date) over in-app / email notifications, SMS and
// WhatsApp, each sent once per invoice, step and channel; and the daily fee job (late fines,
// then reminders) for every institution.
import { feeSettingsBody, type FeeSettings } from '@acadex/shared';
import { getConfig } from '../../config';
import { db, runAsSystem } from '../../db/context';
import { defineJob } from '../../jobs/queue';
import { formatMoney, todayIn } from '../locale';
import { logger } from '../logger';
import { sendAndLog } from '../messaging';
import { notify } from '../notify';
import { chargeLateFines, payerUserIds } from './ledger';

type Channel = FeeSettings['reminder_channels'][number];

export function feeSettings(raw: unknown): FeeSettings {
  return feeSettingsBody.parse(raw ?? {});
}

export const payLink = (token: string) => `${getConfig().appUrl}/pay/${token}`;

interface DueInvoice {
  id: number;
  institution_id: number;
  number: string;
  title: string;
  due_date: string;
  balance: string;
  pay_token: string | null;
  currency: string;
  locale: string;
  institution: string;
  student: string;
}

const DUE_SQL = `
  SELECT i.id, i.institution_id, i.number, i.title, i.due_date, i.total - i.paid AS balance, i.pay_token,
         i.currency, ins.locale, ins.name AS institution, st.first_name AS student
    FROM invoices i JOIN institutions ins ON ins.id = i.institution_id JOIN students st ON st.id = i.student_id
   WHERE i.institution_id = $1 AND i.status IN ('issued', 'partially_paid') AND i.total > i.paid`;

/** Guardians who may see fees, with their phones (for SMS / WhatsApp). */
async function guardianPhones(invoiceId: number) {
  const { rows } = await db.query<{ phone: string; user_id: number | null }>(
    `SELECT g.phone, g.user_id FROM invoices i JOIN guardianships gs ON gs.student_id = i.student_id JOIN guardians g ON g.id = gs.guardian_id
      WHERE i.id = $1 AND gs.can_view_fees AND g.phone <> '' AND g.deleted_at IS NULL`,
    [invoiceId]
  );
  return rows;
}

/** Send one reminder step for an invoice on the given channels. Returns the channels used. */
export async function remindInvoice(inv: DueInvoice, step: string, channels: Channel[], force = false): Promise<string[]> {
  const sent: string[] = [];
  const amount = formatMoney(inv.balance, inv.currency, inv.locale);
  const overdue = step.startsWith('after');
  const text = `${inv.institution}: ${inv.title} for ${inv.student} — ${amount} ${overdue ? `was due on ${inv.due_date}` : `is due on ${inv.due_date}`}. Invoice ${inv.number}.${inv.pay_token ? ` Pay: ${payLink(inv.pay_token)}` : ''}`;
  for (const ch of channels) {
    const key = `${step}:${ch}`;
    if (!force) {
      const r = await db.query(`INSERT INTO invoice_reminders (institution_id, invoice_id, key) VALUES ($1,$2,$3) ON CONFLICT ON CONSTRAINT invoice_reminders_invoice_id_key_key DO NOTHING`, [
        inv.institution_id, inv.id, key,
      ]);
      if (!r.rowCount) continue;
    }
    if (ch === 'in_app' || ch === 'email') {
      // in-app always; email follows each person's preferences for fee reminders
      if (ch === 'email' && channels.includes('in_app')) continue;
      const n = await notify({
        institutionId: inv.institution_id,
        userIds: await payerUserIds(inv.id),
        type: 'fee_due',
        title: overdue ? `Overdue: ${inv.title}` : `Fee due ${inv.due_date}: ${inv.title}`,
        message: `${amount} for ${inv.student}. Invoice ${inv.number}.`,
        link: '/fees',
        dedupeKey: force ? undefined : `fee:${inv.id}:${step}`,
      });
      if (n) sent.push(ch);
    } else {
      let any = false;
      for (const g of await guardianPhones(inv.id)) any = (await sendAndLog(inv.institution_id, { channel: ch, to: g.phone, text, userId: g.user_id })) || any;
      if (any) sent.push(ch);
    }
  }
  return sent;
}

/** Send reminders for chosen invoices now (from the defaulters screen). */
export async function remindNow(institutionId: number, invoiceIds: number[] | undefined, channels: Channel[]) {
  const { rows } = await db.query<DueInvoice>(`${DUE_SQL} AND ($2::int[] IS NULL OR i.id = ANY($2::int[])) AND ($2::int[] IS NOT NULL OR i.due_date < CURRENT_DATE)`, [
    institutionId, invoiceIds ?? null,
  ]);
  let reminded = 0;
  for (const inv of rows) if ((await remindInvoice(inv, `manual:${new Date().toISOString().slice(0, 10)}`, channels, true)).length) reminded++;
  return { invoices: rows.length, reminded };
}

/** Reminders that fall due today for one institution, by its settings. */
export async function scheduledReminders(institutionId: number, today: string, settings: FeeSettings) {
  let n = 0;
  for (const d of settings.remind_before_days) {
    const { rows } = await db.query<DueInvoice>(`${DUE_SQL} AND i.due_date = $2::date + $3::int`, [institutionId, today, d]);
    for (const inv of rows) if ((await remindInvoice(inv, `before:${d}`, settings.reminder_channels)).length) n++;
  }
  for (const d of settings.remind_after_days) {
    const { rows } = await db.query<DueInvoice>(`${DUE_SQL} AND i.due_date = $2::date - $3::int`, [institutionId, today, d]);
    for (const inv of rows) if ((await remindInvoice(inv, `after:${d}`, settings.reminder_channels)).length) n++;
  }
  return n;
}

/** Every morning: charge late fines, then send the day's reminders. */
export const feesDailyJob = defineJob<{ today?: string; institutionId?: number }>({
  name: 'fees.daily',
  cron: '0 3 * * *',
  async run({ today, institutionId }) {
    const insts = await runAsSystem(async () =>
      (await db.query<{ id: number; timezone: string; settings: { fees?: unknown } }>(`SELECT id, timezone, settings FROM institutions WHERE status = 'active' AND ($1::int IS NULL OR id = $1)`, [institutionId ?? null])).rows
    );
    for (const i of insts) {
      try {
        const day = today ?? todayIn(i.timezone);
        const [fines, reminders] = await runAsSystem(async () => [await chargeLateFines(i.id, day), await scheduledReminders(i.id, day, feeSettings(i.settings?.fees))]);
        if (fines || reminders) logger.info({ institution: i.id, fines, reminders }, 'fees: daily run');
      } catch (err) {
        logger.error({ err, institution: i.id }, 'fees: daily run failed');
      }
    }
  },
});

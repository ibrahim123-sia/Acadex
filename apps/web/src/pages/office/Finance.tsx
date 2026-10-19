// The finance office: overview, invoices (with the invoice page: payments, waivers, refunds,
// voucher), payments received, and defaulters with reminders. Set-up screens are in
// FinanceSetup.tsx.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, Banknote, BellRing, Plus, Receipt, TrendingDown, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useChannels } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney, todayISO } from '@/lib/format';
import { useDebounced, usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, StatCard, Tabs, Textarea, useToast } from '@/components/ui';
import { DownloadButton, Info, InvoiceStatus, StudentSearch, thisMonth, useInvalidate } from './common';
import { DiscountsTab, ExpensesTab, ReconcileTab, ReportsTab, SettingsTab, StructuresTab } from './FinanceSetup';

interface InvoiceRow {
  id: number;
  number: string;
  title: string;
  issue_date: string;
  due_date: string;
  status: string;
  total: string;
  paid: string;
  balance: string;
  overdue: boolean;
  student_id: number | null;
  student: string | null;
  roll_no: string | null;
  section_name: string | null;
  applicant: string | null;
}

export function FinanceHome() {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title={t('nav.finance', 'Finance')} subtitle={t('fees.subtitle', 'Fees, payments, expenses and reports')} />
      <Tabs
        tabs={[
          { id: 'overview', label: t('fees.overview', 'Overview'), content: () => <Overview />, hidden: !can('finance.reports') },
          { id: 'invoices', label: t('fees.invoices', 'Invoices'), content: () => <InvoicesTab /> },
          { id: 'defaulters', label: t('fees.defaulters', 'Defaulters'), content: () => <DefaultersTab /> },
          { id: 'payments', label: t('fees.payments', 'Payments'), content: () => <PaymentsTab /> },
          { id: 'structures', label: t('fees.structures', 'Fee structures'), content: () => <StructuresTab /> },
          { id: 'discounts', label: t('fees.discounts', 'Discounts'), content: () => <DiscountsTab /> },
          { id: 'expenses', label: t('fees.expenses', 'Expenses'), content: () => <ExpensesTab />, hidden: !can('finance.expenses') && !can('finance.reports') },
          { id: 'reconcile', label: t('fees.reconcile', 'Reconciliation'), content: () => <ReconcileTab />, hidden: !can('finance.reports') },
          { id: 'reports', label: t('fees.reports', 'Reports'), content: () => <ReportsTab />, hidden: !can('finance.reports') },
          { id: 'settings', label: t('nav.settings', 'Settings'), content: () => <SettingsTab />, hidden: !can('fees.setup') && !can('payments.configure') },
        ]}
      />
    </>
  );
}

interface Summary {
  collected: string;
  refunded: string;
  billed: string;
  outstanding: string;
  overdue: string;
  defaulters: number;
  expenses: string;
  by_method: { method: string; amount: string; n: number }[];
  by_head: { head: string; amount: string }[];
  by_month: { month: string; income: string; expenses: string }[];
  unreconciled_online: number;
}

function Overview() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(thisMonth());
  const q = useQuery({ queryKey: ['/finance/summary', period], queryFn: () => api.get<Summary>('/finance/summary', period) });
  const s = q.data;
  const max = Math.max(1, ...(s?.by_month ?? []).flatMap((m) => [Number(m.income), Number(m.expenses)]));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.from', 'From')}>{(a) => <Input {...a} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />}</Field>
        <Field label={t('common.to', 'To')}>{(a) => <Input {...a} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />}</Field>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !s ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('fees.collected', 'Collected')} value={formatMoney(s.collected)} sub={Number(s.refunded) ? t('fees.refundedSub', '{{amount}} refunded', { amount: formatMoney(s.refunded) }) : undefined} icon={Wallet} tone="success" />
            <StatCard label={t('fees.outstanding', 'Outstanding')} value={formatMoney(s.outstanding)} sub={t('fees.billedSub', '{{amount}} billed in the period', { amount: formatMoney(s.billed) })} icon={Receipt} />
            <StatCard label={t('fees.overdue', 'Overdue')} value={formatMoney(s.overdue)} sub={t('fees.defaultersSub', '{{n}} students', { n: s.defaulters })} icon={AlertTriangle} tone="danger" />
            <StatCard label={t('fees.expenses', 'Expenses')} value={formatMoney(s.expenses)} sub={t('fees.net', 'Net {{amount}}', { amount: formatMoney(Number(s.collected) - Number(s.refunded) - Number(s.expenses)) })} icon={TrendingDown} tone="warning" />
          </div>
          {s.unreconciled_online > 0 && (
            <Alert tone="warning">{t('fees.unreconciled', '{{n}} online payments in this period are not reconciled with the provider yet.', { n: s.unreconciled_online })}</Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">{t('fees.incomeVsExpenses', 'Income and expenses by month')}</h2>
              {s.by_month.length === 0 ? (
                <EmptyState title={t('common.nothingYet', 'Nothing yet')} />
              ) : (
                <ul className="space-y-2">
                  {s.by_month.map((m) => (
                    <li key={m.month} className="text-sm">
                      <div className="mb-1 flex justify-between text-fg-muted">
                        <span>{m.month}</span>
                        <span className="tabular-nums">
                          {formatMoney(m.income)} / {formatMoney(m.expenses)}
                        </span>
                      </div>
                      <div className="h-2 rounded bg-surface-2">
                        <div className="h-2 rounded bg-success" style={{ width: `${(Number(m.income) / max) * 100}%` }} />
                      </div>
                      <div className="mt-0.5 h-2 rounded bg-surface-2">
                        <div className="h-2 rounded bg-warning" style={{ width: `${(Number(m.expenses) / max) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">{t('fees.byMethod', 'How people paid')}</h2>
              {s.by_method.length === 0 ? (
                <EmptyState title={t('fees.noPayments', 'No payments in this period')} />
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {s.by_method.map((m) => (
                    <li key={m.method} className="flex justify-between py-2">
                      <span className="capitalize">{m.method}</span>
                      <span className="tabular-nums">
                        {formatMoney(m.amount)} <span className="text-fg-muted">({m.n})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <h2 className="mb-3 mt-6 font-semibold">{t('fees.byHead', 'Billed by fee head')}</h2>
              <ul className="divide-y divide-border text-sm">
                {s.by_head.map((h) => (
                  <li key={h.head} className="flex justify-between py-2">
                    <span>{h.head}</span>
                    <span className="tabular-nums">{formatMoney(h.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function InvoicesTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const list = usePagedList<InvoiceRow>('/finance/invoices', { status: status || undefined, q: q || undefined });
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.search', 'Search')} className="min-w-52 flex-1">
          {(a) => <Input {...a} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('fees.searchInvoices', 'Invoice number, student or roll number')} />}
        </Field>
        <Field label={t('common.status', 'Status')}>
          {(a) => (
            <Select {...a} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('common.all', 'All')}</option>
              <option value="unpaid">{t('fees.unpaid', 'Unpaid')}</option>
              <option value="overdue">{t('fees.overdue', 'Overdue')}</option>
              <option value="paid">{t('fees.paid', 'Paid')}</option>
              <option value="partially_paid">{t('fees.partlyPaid', 'Part paid')}</option>
              <option value="cancelled">{t('fees.cancelled', 'Cancelled')}</option>
            </Select>
          )}
        </Field>
        {can('fees.setup') && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {t('fees.newInvoice', 'One-off invoice')}
          </Button>
        )}
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('fees.noInvoices', 'No invoices match')}
        columns={[
          {
            key: 'number',
            header: t('fees.invoice', 'Invoice'),
            cell: (r) => (
              <Link to={`/finance/invoices/${r.id}`} className="font-medium text-primary hover:underline">
                {r.number}
              </Link>
            ),
          },
          { key: 'who', header: t('common.student', 'Student'), cell: (r) => <span>{r.student ?? r.applicant}{r.roll_no && <span className="text-fg-muted"> · {r.roll_no}</span>}</span> },
          { key: 'title', header: t('fees.for', 'For'), cell: (r) => r.title, hideOnMobile: true },
          { key: 'due', header: t('fees.dueDate', 'Due'), cell: (r) => formatDate(r.due_date), hideOnMobile: true },
          { key: 'balance', header: t('fees.balance', 'Balance'), cell: (r) => <span className="tabular-nums">{formatMoney(r.balance)}</span> },
          { key: 'status', header: t('common.status', 'Status'), cell: (r) => <InvoiceStatus status={r.status} overdue={r.overdue} /> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {creating && <AdhocInvoiceDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/finance/invoices/${id}`)} />}
    </div>
  );
}

function AdhocInvoiceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [students, setStudents] = useState<number[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(todayISO());
  const [lines, setLines] = useState([{ head: 'Tuition', label: '', amount: '' }]);
  const m = useMutation({
    mutationFn: () => api.post<{ created: number; ids: number[] }>('/finance/invoices', { student_ids: students, title, due_date: due, lines: lines.map((l) => ({ ...l, label: l.label || l.head, amount: Number(l.amount) })) }),
    onSuccess: async (r) => {
      await invalidate('/finance');
      if (r.ids.length === 1) onCreated(r.ids[0]!);
      else onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t('fees.newInvoice', 'One-off invoice')} description={t('fees.newInvoiceHelp', 'For an exam fee, a trip or a correction. Pick one or more students.')}>
      <div className="space-y-4">
        <Field label={t('common.students', 'Students')}>{() => <StudentSearch value={students} onChange={setStudents} multiple />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('fees.for', 'For')}>{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('fees.titleExample', 'e.g. Science trip')} />}</Field>
          <Field label={t('fees.dueDate', 'Due')}>{(a) => <Input {...a} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_7rem] gap-2">
            <Input aria-label={t('fees.head', 'Fee head')} value={l.head} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, head: e.target.value } : x)))} />
            <Input aria-label={t('fees.description', 'Description')} placeholder={t('fees.description', 'Description')} value={l.label} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input aria-label={t('fees.amount', 'Amount')} type="number" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { head: 'Other', label: '', amount: '' }])}>
          <Plus className="size-4" /> {t('fees.addLine', 'Add a line')}
        </Button>
        <MutationError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button loading={m.isPending} disabled={!students.length || !title} onClick={() => m.mutate()}>
            {t('fees.createInvoices', 'Create')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface InvoiceDetail extends InvoiceRow {
  currency: string;
  pay_token?: string;
  lines: { id: number; kind: string; head: string; label: string; amount: string }[];
  payments: { id: number; receipt_no: string; amount: string; method: string; provider: string | null; provider_ref: string | null; status: string; received_at: string; reconciled_at: string | null }[];
  refunds: { id: number; payment_id: number; amount: string; reason: string; created_at: string }[];
}

export function InvoicePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const toast = useToast();
  const q = useQuery({ queryKey: [`/finance/invoices/${id}`], queryFn: () => api.get<InvoiceDetail>(`/finance/invoices/${id}`) });
  const [dialog, setDialog] = useState<null | 'pay' | 'waive' | 'line' | 'cancel' | { refund: number }>(null);
  const done = async (msg: string) => {
    await invalidate('/finance');
    setDialog(null);
    toast('success', msg);
  };
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner className="h-full" />;
  const inv = q.data;
  const open = inv.status !== 'cancelled' && Number(inv.balance) > 0;
  return (
    <>
      <Link to="/finance#invoices" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> {t('fees.invoices', 'Invoices')}
      </Link>
      <PageHeader
        title={`${inv.number} — ${inv.title}`}
        subtitle={inv.student ?? inv.applicant ?? ''}
        actions={
          <div className="flex flex-wrap gap-2">
            <DownloadButton path={`/finance/invoices/${inv.id}/voucher.pdf`} filename={`voucher-${inv.number}.pdf`}>
              {t('fees.voucher', 'Voucher')}
            </DownloadButton>
            {open && can('fees.manage') && (
              <Button size="sm" onClick={() => setDialog('pay')}>
                <Banknote className="size-4" /> {t('fees.recordPayment', 'Record payment')}
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-4 p-5 lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Info label={t('common.status', 'Status')}>
              <InvoiceStatus status={inv.status} overdue={Number(inv.balance) > 0 && inv.due_date < todayISO()} />
            </Info>
            <Info label={t('fees.issued', 'Issued')}>{formatDate(inv.issue_date)}</Info>
            <Info label={t('fees.dueDate', 'Due')}>{formatDate(inv.due_date)}</Info>
            <Info label={t('fees.balance', 'Balance')}>
              <span className="text-lg font-bold">{formatMoney(inv.balance, inv.currency)}</span>
            </Info>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">
                    {l.label} {l.kind !== 'fee' && <Badge className="ms-1">{l.kind}</Badge>}
                  </td>
                  <td className={`py-2 text-end tabular-nums ${Number(l.amount) < 0 ? 'text-success' : ''}`}>{formatMoney(l.amount, inv.currency)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2">{t('fees.total', 'Total')}</td>
                <td className="py-2 text-end tabular-nums">{formatMoney(inv.total, inv.currency)}</td>
              </tr>
              <tr>
                <td className="py-2">{t('fees.paidSoFar', 'Paid')}</td>
                <td className="py-2 text-end tabular-nums">{formatMoney(inv.paid, inv.currency)}</td>
              </tr>
            </tbody>
          </table>
          {inv.status !== 'cancelled' && (
            <div className="flex flex-wrap gap-2">
              {can('fees.setup') && (
                <Button variant="outline" size="sm" onClick={() => setDialog('line')}>
                  {t('fees.adjust', 'Add a charge or discount')}
                </Button>
              )}
              {open && can('fees.refund') && (
                <Button variant="outline" size="sm" onClick={() => setDialog('waive')}>
                  {t('fees.waive', 'Waive')}
                </Button>
              )}
              {Number(inv.paid) === 0 && can('fees.setup') && (
                <Button variant="ghost" size="sm" onClick={() => setDialog('cancel')}>
                  {t('fees.cancelInvoice', 'Cancel invoice')}
                </Button>
              )}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">{t('fees.payments', 'Payments')}</h2>
          {inv.payments.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('fees.noPaymentsYet', 'Nothing paid yet.')}</p>
          ) : (
            <ul className="space-y-3">
              {inv.payments.map((p) => (
                <li key={p.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex justify-between font-medium">
                    <span>{p.receipt_no}</span>
                    <span className="tabular-nums">{formatMoney(p.amount, inv.currency)}</span>
                  </div>
                  <div className="text-fg-muted">
                    {formatDateTime(p.received_at)} · {p.provider ?? p.method}
                    {p.reconciled_at && ` · ${t('fees.reconciled', 'reconciled')}`}
                  </div>
                  {inv.refunds.filter((r) => r.payment_id === p.id).map((r) => (
                    <div key={r.id} className="text-danger">
                      {t('fees.refundedAmount', 'Refunded {{amount}}: {{reason}}', { amount: formatMoney(r.amount, inv.currency), reason: r.reason })}
                    </div>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <DownloadButton variant="ghost" path={`/finance/payments/${p.id}/receipt.pdf`} filename={`receipt-${p.receipt_no}.pdf`}>
                      {t('fees.receipt', 'Receipt')}
                    </DownloadButton>
                    {can('fees.refund') && p.status !== 'refunded' && (
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ refund: p.id })}>
                        {t('fees.refund', 'Refund')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {dialog === 'pay' && <PaymentDialog inv={inv} onClose={() => setDialog(null)} onDone={() => done(t('fees.paymentRecorded', 'Payment recorded'))} />}
      {dialog === 'waive' && (
        <AmountReasonDialog title={t('fees.waive', 'Waive')} max={Number(inv.balance)} path={`/finance/invoices/${inv.id}/waive`} onClose={() => setDialog(null)} onDone={() => done(t('fees.waived', 'Waiver added'))} />
      )}
      {dialog === 'cancel' && <CancelDialog id={inv.id} onClose={() => setDialog(null)} onDone={() => done(t('fees.cancelledMsg', 'Invoice cancelled'))} />}
      {dialog === 'line' && <LineDialog id={inv.id} onClose={() => setDialog(null)} onDone={() => done(t('fees.adjusted', 'Invoice updated'))} />}
      {dialog && typeof dialog === 'object' && (
        <AmountReasonDialog title={t('fees.refund', 'Refund')} path={`/finance/payments/${dialog.refund}/refund`} onClose={() => setDialog(null)} onDone={() => done(t('fees.refundedMsg', 'Refund recorded'))} />
      )}
    </>
  );
}

function PaymentDialog({ inv, onClose, onDone }: { inv: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ amount: inv.balance, method: 'cash', reference: '', received_at: todayISO(), notes: '' });
  const m = useMutation({ mutationFn: () => api.post(`/finance/invoices/${inv.id}/payments`, { ...v, amount: Number(v.amount) }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} title={t('fees.recordPayment', 'Record payment')}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('fees.amount', 'Amount')} hint={t('fees.balanceHint', 'Balance {{amount}}', { amount: formatMoney(inv.balance, inv.currency) })}>
            {(a) => <Input {...a} type="number" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}
          </Field>
          <Field label={t('fees.method', 'Method')}>
            {(a) => (
              <Select {...a} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
                <option value="cash">{t('fees.cash', 'Cash')}</option>
                <option value="bank">{t('fees.bank', 'Bank deposit / transfer')}</option>
                <option value="cheque">{t('fees.cheque', 'Cheque')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('fees.reference', 'Reference')} optional hint={t('fees.referenceHint', 'Bank transaction or cheque number')}>
            {(a) => <Input {...a} value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />}
          </Field>
          <Field label={t('fees.receivedOn', 'Received on')}>{(a) => <Input {...a} type="date" value={v.received_at} onChange={(e) => setV({ ...v, received_at: e.target.value })} />}</Field>
        </div>
        <MutationError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            {t('fees.saveReceipt', 'Save and issue receipt')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AmountReasonDialog({ title, path, max, onClose, onDone }: { title: string; path: string; max?: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(max ? String(max) : '');
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(path, { amount: Number(amount), reason }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} title={title}>
      <div className="space-y-4">
        <Field label={t('fees.amount', 'Amount')}>{(a) => <Input {...a} type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label={t('common.reason', 'Reason')}>{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <MutationError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button loading={m.isPending} disabled={!amount || !reason} onClick={() => m.mutate()}>
            {title}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CancelDialog({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/finance/invoices/${id}/cancel`, { reason }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} title={t('fees.cancelInvoice', 'Cancel invoice')}>
      <div className="space-y-4">
        <Field label={t('common.reason', 'Reason')}>{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <MutationError error={m.error} />
        <div className="flex justify-end">
          <Button variant="danger" loading={m.isPending} disabled={!reason} onClick={() => m.mutate()}>
            {t('fees.cancelInvoice', 'Cancel invoice')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function LineDialog({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ kind: 'fee', head: '', label: '', amount: '' });
  const negative = ['discount', 'scholarship', 'waiver'].includes(v.kind);
  const m = useMutation({
    mutationFn: () => api.post(`/finance/invoices/${id}/lines`, { ...v, head: v.head || v.label, amount: negative ? -Math.abs(Number(v.amount)) : Number(v.amount) }),
    onSuccess: onDone,
  });
  return (
    <Dialog open onClose={onClose} title={t('fees.adjust', 'Add a charge or discount')}>
      <div className="space-y-4">
        <Field label={t('fees.kind', 'Kind')}>
          {(a) => (
            <Select {...a} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              <option value="fee">{t('fees.charge', 'Charge')}</option>
              <option value="fine">{t('fees.fine', 'Fine')}</option>
              <option value="discount">{t('fees.discount', 'Discount')}</option>
              <option value="scholarship">{t('fees.scholarship', 'Scholarship')}</option>
              <option value="adjustment">{t('fees.adjustment', 'Adjustment')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('fees.description', 'Description')}>{(a) => <Input {...a} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />}</Field>
        <Field label={t('fees.amount', 'Amount')}>{(a) => <Input {...a} type="number" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}</Field>
        <MutationError error={m.error} />
        <div className="flex justify-end">
          <Button loading={m.isPending} disabled={!v.label || !v.amount} onClick={() => m.mutate()}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface PaymentRow {
  id: number;
  receipt_no: string;
  amount: string;
  method: string;
  provider: string | null;
  received_at: string;
  reconciled_at: string | null;
  invoice_id: number;
  invoice_number: string;
  student: string | null;
  received_by: string | null;
}

function PaymentsTab() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState(thisMonth());
  const list = usePagedList<PaymentRow>('/finance/payments', period);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.from', 'From')}>{(a) => <Input {...a} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />}</Field>
        <Field label={t('common.to', 'To')}>{(a) => <Input {...a} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />}</Field>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('fees.noPayments', 'No payments in this period')}
        columns={[
          { key: 'receipt', header: t('fees.receipt', 'Receipt'), cell: (p) => <span className="font-mono text-xs">{p.receipt_no}</span> },
          { key: 'who', header: t('common.student', 'Student'), cell: (p) => p.student ?? '—' },
          { key: 'invoice', header: t('fees.invoice', 'Invoice'), cell: (p) => <Link className="text-primary hover:underline" to={`/finance/invoices/${p.invoice_id}`}>{p.invoice_number}</Link>, hideOnMobile: true },
          { key: 'when', header: t('fees.receivedOn', 'Received on'), cell: (p) => formatDateTime(p.received_at), hideOnMobile: true },
          { key: 'method', header: t('fees.method', 'Method'), cell: (p) => <span className="capitalize">{p.provider ?? p.method}</span>, hideOnMobile: true },
          { key: 'amount', header: t('fees.amount', 'Amount'), cell: (p) => <span className="tabular-nums">{formatMoney(p.amount)}</span> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </div>
  );
}

interface Defaulter {
  student_id: number;
  student: string;
  roll_no: string | null;
  section_name: string | null;
  invoices: number;
  overdue: string;
  oldest_due: string;
  days_overdue: number;
  guardians: string | null;
  invoice_ids: number[];
}

function DefaultersTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [minDays, setMinDays] = useState('1');
  const q = useQuery({ queryKey: ['/finance/defaulters', minDays], queryFn: () => api.get<Defaulter[]>('/finance/defaulters', { min_days: minDays }) });
  const [picked, setPicked] = useState<number[]>([]);
  const [channels, setChannels] = useState<string[]>(['in_app', 'email']);
  const offered = useChannels();
  const reminderChannels = (['in_app', 'email', 'whatsapp'] as const).filter((c) => c !== 'whatsapp' || offered.data?.whatsapp);
  const remind = useMutation({
    mutationFn: () => api.post<{ invoices: number; reminded: number }>('/finance/reminders', { invoice_ids: (q.data ?? []).filter((d) => picked.includes(d.student_id)).flatMap((d) => d.invoice_ids), channels }),
    onSuccess: (r) => {
      toast('success', t('fees.remindersSent', 'Reminders sent for {{n}} invoices', { n: r.reminded }));
      setPicked([]);
    },
  });
  const rows = q.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('fees.overdueAtLeast', 'Overdue by at least (days)')}>{(a) => <Input {...a} type="number" min={0} value={minDays} onChange={(e) => setMinDays(e.target.value)} className="w-28" />}</Field>
        <DownloadButton path={`/finance/defaulters?format=xlsx&min_days=${minDays}`} filename="defaulters.xlsx">
          Excel
        </DownloadButton>
        {can('fees.manage') && (
          <div className="ms-auto flex flex-wrap items-center gap-3">
            {reminderChannels.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} />
                {{ in_app: t('fees.inApp', 'App'), email: 'Email', whatsapp: 'WhatsApp' }[c]}
              </label>
            ))}
            <Button size="sm" disabled={!picked.length || !channels.length} loading={remind.isPending} onClick={() => remind.mutate()}>
              <BellRing className="size-4" /> {t('fees.remind', 'Remind ({{n}})', { n: picked.length })}
            </Button>
          </div>
        )}
      </div>
      <MutationError error={remind.error} />
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.student_id}
        empty={t('fees.noDefaulters', 'Nobody is overdue. 🎉')}
        columns={[
          {
            key: 'pick',
            header: (
              <input type="checkbox" aria-label={t('common.selectAll', 'Select all')} checked={rows.length > 0 && picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.student_id) : [])} />
            ),
            cell: (r) => <input type="checkbox" aria-label={r.student} checked={picked.includes(r.student_id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.student_id] : picked.filter((x) => x !== r.student_id))} />,
          },
          { key: 'student', header: t('common.student', 'Student'), cell: (r) => <span>{r.student} <span className="text-fg-muted">{r.roll_no}</span></span> },
          { key: 'class', header: t('common.class', 'Class'), cell: (r) => r.section_name ?? '—', hideOnMobile: true },
          { key: 'overdue', header: t('fees.overdue', 'Overdue'), cell: (r) => <span className="font-medium tabular-nums text-danger">{formatMoney(r.overdue)}</span> },
          { key: 'days', header: t('fees.days', 'Days'), cell: (r) => r.days_overdue, hideOnMobile: true },
          { key: 'guardians', header: t('common.guardians', 'Guardians'), cell: (r) => <span className="text-xs">{r.guardians ?? '—'}</span>, hideOnMobile: true },
        ]}
      />
    </div>
  );
}

// Paying fees: the student's / guardian's fees page, the public pay link (vouchers, reminders,
// applicants), and the page payers come back to from the payment provider.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, CreditCard, Landmark, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { Alert, Button, Card, Dialog, EmptyState, ErrorState, MutationError, PageHeader, Spinner } from '@/components/ui';
import { DownloadButton, InvoiceStatus } from './common';

interface CheckoutResult {
  redirectUrl?: string;
  form?: { action: string; fields: Record<string, string> };
  instructions?: Record<string, string>;
  reference: string;
  amount: number;
}
interface PayOption {
  provider: string;
  label: string;
  online: boolean;
  details?: Record<string, string>;
}

/** Send the browser to the provider (a link, or a form some providers need posted). */
function goToProvider(r: CheckoutResult) {
  if (r.redirectUrl) return void window.location.assign(r.redirectUrl);
  if (r.form) {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = r.form.action;
    for (const [k, v] of Object.entries(r.form.fields)) {
      const i = document.createElement('input');
      i.type = 'hidden';
      i.name = k;
      i.value = v;
      f.appendChild(i);
    }
    document.body.appendChild(f);
    f.submit();
  }
}

function BankDetails({ d, reference, amount }: { d: Record<string, string>; reference: string; amount: string }) {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {d.bank_name && (<><dt className="text-fg-muted">{t('fees.bankName', 'Bank')}</dt><dd>{d.bank_name}{d.branch ? `, ${d.branch}` : ''}</dd></>)}
      {d.account_title && (<><dt className="text-fg-muted">{t('fees.accountTitle', 'Account title')}</dt><dd>{d.account_title}</dd></>)}
      {d.iban && (<><dt className="text-fg-muted">IBAN</dt><dd className="font-mono">{d.iban}</dd></>)}
      {d.account_no && (<><dt className="text-fg-muted">{t('fees.accountNo', 'Account no.')}</dt><dd className="font-mono">{d.account_no}</dd></>)}
      {d.raast_id && (<><dt className="text-fg-muted">Raast</dt><dd className="font-mono">{d.raast_id}</dd></>)}
      <dt className="text-fg-muted">{t('fees.reference', 'Reference')}</dt>
      <dd className="font-mono font-semibold">{reference}</dd>
      <dt className="text-fg-muted">{t('fees.amount', 'Amount')}</dt>
      <dd className="font-semibold">{amount}</dd>
    </dl>
  );
}

/** Choose how to pay; online methods go to the provider, bank transfer shows the details. */
function PayChooser({ options, number, balance, currency, start, onClose }: { options: PayOption[]; number: string; balance: number; currency: string; start: (provider: string) => Promise<CheckoutResult>; onClose: () => void }) {
  const { t } = useTranslation();
  const m = useMutation({ mutationFn: start, onSuccess: goToProvider });
  const bank = options.find((o) => o.provider === 'bank');
  const online = options.filter((o) => o.online);
  return (
    <Dialog open onClose={onClose} title={t('fees.payNow', 'Pay {{amount}}', { amount: formatMoney(balance, currency) })}>
      <div className="space-y-4">
        {online.length === 0 && !bank && <Alert>{t('fees.noOnline', 'Online payment is not set up yet. Please pay at the accounts office.')}</Alert>}
        <div className="grid gap-2">
          {online.map((o) => (
            <Button key={o.provider} variant="outline" className="justify-start" loading={m.isPending && m.variables === o.provider} onClick={() => m.mutate(o.provider)}>
              <CreditCard className="size-4" /> {o.label}
            </Button>
          ))}
        </div>
        <MutationError error={m.error} />
        {bank?.details && (
          <Card className="p-4">
            <h3 className="mb-2 flex items-center gap-2 font-semibold"><Landmark className="size-4" /> {t('fees.bankTransferTitle', 'Bank transfer / Raast')}</h3>
            <BankDetails d={bank.details} reference={number} amount={formatMoney(balance, currency)} />
            <p className="mt-2 text-xs text-fg-muted">{t('fees.bankTransferHelp', 'Use the invoice number as the reference. It is marked paid once the school matches it with the bank statement.')}</p>
          </Card>
        )}
      </div>
    </Dialog>
  );
}

interface MyInvoice {
  id: number;
  number: string;
  title: string;
  issue_date: string;
  due_date: string;
  status: string;
  currency: string;
  total: string;
  paid: string;
  balance: string;
  overdue: boolean;
}

export function MyFeesPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/finance/my'], queryFn: () => api.get<{ students: { student_id: number; name: string; balance: number; invoices: MyInvoice[] }[]; hidden: boolean }>('/finance/my') });
  const options = useQuery({ queryKey: ['/finance/payment-options'], queryFn: () => api.get<PayOption[]>('/finance/payment-options') });
  const [paying, setPaying] = useState<MyInvoice | null>(null);
  return (
    <>
      <PageHeader title={t('nav.fees', 'Fees')} subtitle={t('fees.mySubtitle', 'Invoices, payments and receipts')} />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Spinner />
      ) : q.data.hidden ? (
        <EmptyState title={t('fees.hiddenTitle', 'Fees are shared with your guardians')} description={t('fees.hiddenHelp', 'Your school sends fee details to your parents or guardians.')} />
      ) : q.data.students.length === 0 ? (
        <EmptyState title={t('fees.nothing', 'No fees to show')} />
      ) : (
        <div className="space-y-6">
          {q.data.students.map((s) => (
            <section key={s.student_id}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold">{s.name}</h2>
                <span className="text-sm">{t('fees.toPay', 'To pay')}: <b className="tabular-nums">{formatMoney(s.balance)}</b></span>
              </div>
              {s.invoices.length === 0 ? (
                <EmptyState title={t('fees.noInvoicesYet', 'No invoices yet')} />
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {s.invoices.map((inv) => (
                    <li key={inv.id}>
                      <Card className="flex h-full flex-col gap-2 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{inv.title}</div>
                            <div className="text-xs text-fg-muted">{inv.number} · {t('fees.dueOn', 'due {{date}}', { date: formatDate(inv.due_date) })}</div>
                          </div>
                          <InvoiceStatus status={inv.status} overdue={inv.overdue} />
                        </div>
                        <div className="text-2xl font-bold tabular-nums">{formatMoney(inv.balance, inv.currency)}</div>
                        {Number(inv.paid) > 0 && <div className="text-xs text-fg-muted">{t('fees.ofTotalPaid', '{{paid}} of {{total}} paid', { paid: formatMoney(inv.paid, inv.currency), total: formatMoney(inv.total, inv.currency) })}</div>}
                        <div className="mt-auto flex flex-wrap gap-2 pt-2">
                          {Number(inv.balance) > 0 && <Button size="sm" onClick={() => setPaying(inv)}>{t('fees.pay', 'Pay')}</Button>}
                          <DownloadButton path={`/finance/invoices/${inv.id}/voucher.pdf`} filename={`voucher-${inv.number}.pdf`}>{t('fees.voucher', 'Voucher')}</DownloadButton>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {paying && (
        <PayChooser
          options={options.data ?? []}
          number={paying.number}
          balance={Number(paying.balance)}
          currency={paying.currency}
          start={(provider) => api.post<CheckoutResult>(`/finance/invoices/${paying.id}/checkout`, { provider })}
          onClose={() => setPaying(null)}
        />
      )}
    </>
  );
}

interface PublicInvoice {
  number: string;
  title: string;
  due_date: string;
  status: string;
  currency: string;
  total: string;
  paid: string;
  balance: number;
  payer: string;
  institution: string;
  primary_color: string | null;
  lines: { label: string; amount: string }[];
  options: PayOption[];
}

function PublicShell({ title, color, children }: { title: string; color?: string | null; children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-bg">
      <header className="px-4 py-5 text-white" style={{ background: color || '#4f46e5' }}>
        <div className="mx-auto max-w-xl text-lg font-bold">{title}</div>
      </header>
      <main className="mx-auto max-w-xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}

/** /pay/:token — anyone with the link (from a voucher, reminder or application) can pay. */
export function PayLinkPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const q = useQuery({ queryKey: ['pay', token], queryFn: () => api.get<PublicInvoice>(`/payments/pay/${token}`), retry: false });
  const [paying, setPaying] = useState(false);
  if (q.error) return <PublicShell title="Acadex"><ErrorState error={q.error} /></PublicShell>;
  if (!q.data) return <Spinner className="h-full" />;
  const inv = q.data;
  return (
    <PublicShell title={inv.institution} color={inv.primary_color}>
      <Card className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">{inv.title}</h1>
            <p className="text-sm text-fg-muted">{inv.payer} · {inv.number} · {t('fees.dueOn', 'due {{date}}', { date: formatDate(inv.due_date) })}</p>
          </div>
          <InvoiceStatus status={inv.status} />
        </div>
        <ul className="divide-y divide-border text-sm">
          {inv.lines.map((l, i) => (
            <li key={i} className="flex justify-between py-1.5"><span>{l.label}</span><span className="tabular-nums">{formatMoney(l.amount, inv.currency)}</span></li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="font-medium">{t('fees.balance', 'Balance')}</span>
          <span className="text-2xl font-bold tabular-nums">{formatMoney(inv.balance, inv.currency)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.balance > 0 && <Button onClick={() => setPaying(true)}>{t('fees.pay', 'Pay')}</Button>}
          <DownloadButton path={`/payments/pay/${token}/voucher.pdf`} filename={`voucher-${inv.number}.pdf`}>{t('fees.voucher', 'Voucher')}</DownloadButton>
        </div>
      </Card>
      {paying && (
        <PayChooser options={inv.options} number={inv.number} balance={inv.balance} currency={inv.currency} start={(provider) => api.post<CheckoutResult>(`/payments/pay/${token}/checkout`, { provider })} onClose={() => setPaying(false)} />
      )}
    </PublicShell>
  );
}

/** /pay/return?ref=… — where the provider sends the payer back; waits for the result. */
export function PayReturnPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [tries, setTries] = useState(0);
  const q = useQuery({
    queryKey: ['pay-status', ref, tries],
    queryFn: () => api.get<{ status: string; amount: string; currency: string; invoice_number: string; title: string; institution: string; receipt_no: string | null; pay_token: string | null }>(`/payments/status/${ref}`),
    enabled: /^AX[0-9A-F]{18}$/.test(ref),
    retry: false,
  });
  useEffect(() => {
    if (q.data?.status === 'pending' && tries < 20) {
      const timer = setTimeout(() => setTries((n) => n + 1), 3000);
      return () => clearTimeout(timer);
    }
  }, [q.data?.status, tries]);
  const s = q.data;
  return (
    <PublicShell title={s?.institution ?? 'Acadex'}>
      <Card className="space-y-3 p-6 text-center">
        {params.get('error') ? (
          <>
            <XCircle className="mx-auto size-12 text-danger" />
            <p>{t('fees.unverified', 'We could not confirm this payment. If money left your account, contact the school with the reference below.')}</p>
          </>
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : !s ? (
          <Spinner />
        ) : s.status === 'succeeded' ? (
          <>
            <CheckCircle2 className="mx-auto size-12 text-success" />
            <h1 className="text-xl font-semibold">{t('fees.thankYou', 'Payment received — thank you')}</h1>
            <p className="text-sm">{t('fees.receiptLine', '{{amount}} for {{title}} ({{number}}). Receipt {{receipt}}.', { amount: formatMoney(s.amount, s.currency), title: s.title, number: s.invoice_number, receipt: s.receipt_no })}</p>
          </>
        ) : s.status === 'pending' ? (
          <>
            <Clock className="mx-auto size-12 text-warning" />
            <p>{t('fees.waiting', 'Waiting for the payment provider to confirm…')}</p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto size-12 text-danger" />
            <p>{t('fees.failed', 'The payment did not go through. No money was taken.')}</p>
          </>
        )}
        <p className="font-mono text-xs text-fg-muted">{ref}</p>
        {s?.pay_token && <Link className="text-primary hover:underline" to={`/pay/${s.pay_token}`}>{t('fees.backToInvoice', 'Back to the invoice')}</Link>}
      </Card>
    </PublicShell>
  );
}

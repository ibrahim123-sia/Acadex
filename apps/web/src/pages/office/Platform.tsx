// The institution's side of the platform: billing (plan, usage against limits, invoices),
// branding and own domain, data & privacy (exports, deletion, retention, support access,
// consents, people's requests), integrations (API keys, webhooks, LTI tools, OneRoster),
// reports (view, export, schedules) and modules.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, KeyRound, Plus, Send, Trash2 } from 'lucide-react';
import { API_SCOPES, MODULE_LABELS, REPORTS, WEBHOOK_EVENTS, type ModuleKey } from '@acadex/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, CopyButton, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Select, Spinner, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';

// ---------------------------------------------------------------- billing

interface Billing {
  plan: { key: string; name: string; limits: Record<string, number | null>; prices: Record<string, number> };
  trial_ends_at: string | null;
  features: Record<string, boolean>;
  modules: { allowed: ModuleKey[]; enabled: ModuleKey[] };
  usage: { students: number; staff: number; storage_bytes: number; ai_usd: number; messages: number };
  messages_left: number | null;
  invoices: { id: number; number: string; period_start: string; currency: string; total: number; tax: number; tax_label: string; status: string; due_date: string; paid_at: string | null; lines: { label: string; quantity: number; unit: number; amount: number }[] }[];
  profile: { billing_email?: string; tax_id?: string; billing_currency?: string; address?: string };
  plans: { key: string; name: string; description: string; prices: Record<string, number> }[];
  card_payments: boolean;
  bank_details: { bank?: string; title?: string; iban?: string } | null;
}

function Meter({ label, used, limit, unit = '' }: { label: string; used: number; limit: number | null | undefined; unit?: string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-fg-muted">{used.toLocaleString()}{unit} / {limit == null ? '∞' : `${limit.toLocaleString()}${unit}`}</span></div>
      <div className="h-2 rounded-full bg-surface-2" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-2 rounded-full ${pct > 90 ? 'bg-danger' : pct > 70 ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${limit ? pct : 0}%` }} />
      </div>
    </div>
  );
}

export function BillingPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/billing'], queryFn: () => api.get<Billing>('/billing') });
  const [profile, setProfile] = useState<Billing['profile'] | null>(null);
  const saveProfile = useMutation({ mutationFn: () => api.put('/billing/profile', profile), onSuccess: () => { toast('success', t('common.saved', 'Saved')); void q.refetch(); } });
  const changePlan = useMutation({ mutationFn: (plan: string) => api.post('/billing/plan', { plan }), onSuccess: () => { toast('success', t('bill.planChanged', 'Plan changed')); void q.refetch(); } });
  const pay = useMutation({ mutationFn: (id: number) => api.post<{ url: string }>(`/billing/invoices/${id}/checkout`), onSuccess: (r) => window.location.assign(r.url) });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner />;
  const b = q.data;
  const p = profile ?? b.profile;
  return (
    <>
      <PageHeader title={t('nav.billing', 'Billing')} subtitle={t('bill.subtitle', 'Your plan, what you use, and your invoices')} />
      {new URLSearchParams(window.location.search).get('paid') && <Alert tone="success" className="mb-4">{t('bill.thanks', 'Thank you — your payment was received.')}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{b.plan.name}</h2>{b.trial_ends_at && <Badge tone="info">{t('bill.trial', 'Trial until {{d}}', { d: formatDate(b.trial_ends_at) })}</Badge>}</div>
          <Meter label={t('bill.students', 'Active students')} used={b.usage.students} limit={b.plan.limits.students} />
          <Meter label={t('bill.storage', 'Storage (GB)')} used={Math.round((b.usage.storage_bytes / 1e9) * 100) / 100} limit={b.plan.limits.storage_mb != null ? Math.round(b.plan.limits.storage_mb / 102.4) / 10 : null} />
          <Meter label={t('bill.ai', 'AI this month (USD)')} used={Math.round(b.usage.ai_usd * 100) / 100} limit={b.plan.limits.ai_usd} />
          <Meter label={t('bill.messages', 'WhatsApp messages this month')} used={b.usage.messages} limit={b.plan.limits.messages} />
          <div className="flex flex-wrap gap-2 pt-2">
            {b.plans.filter((x) => x.key !== b.plan.key).map((x) => <Button key={x.key} size="sm" variant="outline" loading={changePlan.isPending && changePlan.variables === x.key} onClick={() => changePlan.mutate(x.key)}>{t('bill.switchTo', 'Switch to {{plan}}', { plan: x.name })}</Button>)}
          </div>
          <MutationError error={changePlan.error} />
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">{t('bill.profile', 'Billing details')}</h2>
          <Field label={t('bill.email', 'Invoices go to')} optional>{(a) => <Input {...a} type="email" value={p.billing_email ?? ''} onChange={(e) => setProfile({ ...p, billing_email: e.target.value })} />}</Field>
          <Field label={t('bill.taxId', 'Tax number (NTN / VAT)')} optional>{(a) => <Input {...a} value={p.tax_id ?? ''} onChange={(e) => setProfile({ ...p, tax_id: e.target.value })} />}</Field>
          <Field label={t('bill.currency', 'Currency')}>{(a) => <Select {...a} value={p.billing_currency ?? 'PKR'} onChange={(e) => setProfile({ ...p, billing_currency: e.target.value })}>{['PKR', 'USD', 'AED', 'SAR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
          <Field label={t('bill.address', 'Billing address')} optional>{(a) => <Textarea {...a} rows={2} value={p.address ?? ''} onChange={(e) => setProfile({ ...p, address: e.target.value })} />}</Field>
          <Button size="sm" loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>{t('common.save', 'Save')}</Button>
        </Card>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">{t('bill.invoices', 'Invoices')}</h2>
      <DataTable
        rows={b.invoices}
        rowKey={(r) => r.id}
        empty={t('bill.noInvoices', 'No invoices yet')}
        columns={[
          { key: 'n', header: t('bill.number', 'Number'), cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'p', header: t('bill.items', 'Items'), cell: (r) => <span className="text-xs">{r.lines.map((l) => l.label).join(' · ')}{r.tax > 0 && ` · ${r.tax_label}`}</span>, hideOnMobile: true },
          { key: 't', header: t('bill.total', 'Total'), cell: (r) => `${r.currency} ${r.total.toFixed(2)}` },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <StatusBadge value={r.status === 'open' ? 'issued' : r.status} label={r.status} /> },
          { key: 'd', header: t('bill.due', 'Due'), cell: (r) => formatDate(r.due_date), hideOnMobile: true },
          { key: 'a', header: '', cell: (r) => ['open', 'overdue'].includes(r.status) && b.card_payments && <Button size="sm" loading={pay.isPending && pay.variables === r.id} onClick={() => pay.mutate(r.id)}>{t('bill.payCard', 'Pay by card')}</Button> },
        ]}
      />
      <MutationError error={pay.error} />
      {b.bank_details?.iban && <Alert className="mt-3">{t('bill.bank', 'Or pay by bank transfer to {{title}}, {{bank}}, IBAN {{iban}} — quote the invoice number.', { title: b.bank_details.title, bank: b.bank_details.bank, iban: b.bank_details.iban })}</Alert>}
    </>
  );
}

// ---------------------------------------------------------------- branding and domain

export function BrandingCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/institution/branding'], queryFn: () => api.get<{ logo_url: string; primary_color: string; app_name: string; email_footer: string; white_label: boolean; custom_domain: boolean; domains: { id: number; domain: string; token: string; verified_at: string | null }[] }>('/institution/branding') });
  const [v, setV] = useState<{ logo_url: string; primary_color: string; app_name: string; email_footer: string } | null>(null);
  const [domain, setDomain] = useState('');
  const save = useMutation({ mutationFn: () => api.put('/institution/branding', v), onSuccess: () => { toast('success', t('common.saved', 'Saved')); void q.refetch(); } });
  const add = useMutation({ mutationFn: () => api.post('/institution/domains', { domain }), onSuccess: () => { setDomain(''); void q.refetch(); } });
  const verify = useMutation({ mutationFn: (id: number) => api.post(`/institution/domains/${id}/verify`), onSuccess: () => { toast('success', t('brand.verified', 'Domain verified')); void q.refetch(); } });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/institution/domains/${id}`), onSuccess: () => q.refetch() });
  if (!q.data) return <Spinner />;
  const cur = v ?? q.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t('brand.title', 'Your brand')}</h2>
        <Field label={t('brand.logo', 'Logo URL')} optional>{(a) => <Input {...a} type="url" value={cur.logo_url} onChange={(e) => setV({ ...cur, logo_url: e.target.value })} />}</Field>
        <Field label={t('brand.color', 'Colour')}>{(a) => <Input {...a} type="color" value={cur.primary_color} onChange={(e) => setV({ ...cur, primary_color: e.target.value })} className="h-10 w-24 p-1" />}</Field>
        <Field label={t('brand.appName', 'App name (installed app, emails)')} optional hint={!q.data.white_label ? t('brand.needPlan', 'Needs a plan with white-label') : undefined}>{(a) => <Input {...a} disabled={!q.data!.white_label} value={cur.app_name} onChange={(e) => setV({ ...cur, app_name: e.target.value })} />}</Field>
        <Field label={t('brand.footer', 'Email footer')} optional>{(a) => <Textarea {...a} rows={2} disabled={!q.data!.white_label} value={cur.email_footer} onChange={(e) => setV({ ...cur, email_footer: e.target.value })} />}</Field>
        <MutationError error={save.error} />
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t('brand.domain', 'Your own domain')}</h2>
        {!q.data.custom_domain ? <Alert>{t('brand.domainPlan', 'Custom domains are part of the Enterprise plan.')}</Alert> : (
          <>
            <div className="flex gap-2"><Input aria-label={t('brand.domain', 'Domain')} placeholder="portal.yourschool.edu.pk" value={domain} onChange={(e) => setDomain(e.target.value)} /><Button loading={add.isPending} onClick={() => add.mutate()}>{t('common.add', 'Add')}</Button></div>
            <MutationError error={add.error ?? verify.error} />
            {q.data.domains.map((d) => (
              <div key={d.id} className="space-y-1 rounded border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><b>{d.domain}</b>{d.verified_at ? <Badge tone="success">{t('brand.ok', 'verified')}</Badge> : <Badge tone="warning">{t('brand.pending', 'waiting for DNS')}</Badge>}</div>
                {!d.verified_at && <p className="text-xs">{t('brand.dns', 'Add a TXT record')} <code>_acadex.{d.domain}</code> = <code className="break-all">{d.token}</code> <CopyButton text={d.token} />, {t('brand.cname', 'and point the domain (CNAME) at your Acadex address.')}</p>}
                <div className="flex gap-2">{!d.verified_at && <Button size="sm" variant="outline" onClick={() => verify.mutate(d.id)}>{t('brand.check', 'Check now')}</Button>}<Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)}>{t('common.remove', 'Remove')}</Button></div>
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- data and privacy

export function DataPrivacyPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.privacyOffice', 'Data & privacy')} subtitle={t('priv.subtitle', 'Exports, retention, consents and people\'s requests about their data')} />
      <Tabs
        tabs={[
          { id: 'requests', label: t('priv.requests', 'Requests'), content: () => <RequestsTab /> },
          { id: 'consents', label: t('priv.consents', 'Consents'), content: () => <ConsentReport /> },
          { id: 'retention', label: t('priv.retention', 'Retention & support'), content: () => <RetentionTab /> },
          { id: 'export', label: t('priv.export', 'Export & close'), content: () => <ExportTab /> },
          { id: 'brand', label: t('brand.tab', 'Branding'), content: () => <BrandingCard /> },
        ]}
      />
    </>
  );
}

function RequestsTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/privacy/requests', 'all'], queryFn: () => api.get<{ id: number; kind: string; details: string; status: string; person: string | null; email: string | null; created_at: string; due_at: string; response: string; export_id: number | null }[]>('/privacy/requests') });
  const decide = useMutation({ mutationFn: (v: { id: number; status: string; response: string }) => api.patch(`/privacy/requests/${v.id}`, v), onSuccess: () => q.refetch() });
  return (
    <>
      <MutationError error={decide.error} />
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        rowKey={(r) => r.id}
        empty={t('priv.noRequests', 'No requests')}
        columns={[
          { key: 'w', header: t('common.when', 'When'), cell: (r) => formatDate(r.created_at) },
          { key: 'p', header: t('priv.person', 'Person'), cell: (r) => <span>{r.person}<span className="block text-xs text-fg-muted">{r.email}</span></span> },
          { key: 'k', header: t('priv.kind', 'Asks for'), cell: (r) => <span><Badge>{t(`priv.k.${r.kind}`, r.kind)}</Badge> <span className="text-xs">{r.details}</span></span> },
          { key: 'd', header: t('priv.due', 'Answer by'), cell: (r) => formatDate(r.due_at), hideOnMobile: true },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <StatusBadge value={r.status === 'open' ? 'pending' : r.status === 'done' ? 'approved' : 'rejected'} label={r.status} /> },
          { key: 'a', header: '', cell: (r) => r.status === 'open' && (
            <span className="flex gap-1">
              <Button size="sm" onClick={() => decide.mutate({ id: r.id, status: 'done', response: '' })}>{r.kind === 'access' ? t('priv.prepare', 'Prepare their data') : r.kind === 'deletion' ? t('priv.erase', 'Close & erase account') : t('priv.done', 'Done')}</Button>
              <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, status: 'rejected', response: '' })}>{t('priv.reject', 'Decline')}</Button>
            </span>
          ) },
        ]}
      />
    </>
  );
}

function ConsentReport() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/privacy/consents/report'], queryFn: () => api.get<{ kind: string; granted: number; refused: number; no_answer: number }[]>('/privacy/consents/report') });
  return (
    <DataTable rows={q.data} loading={q.isPending} error={q.error} rowKey={(r) => r.kind} columns={[
      { key: 'k', header: t('priv.consent', 'Consent'), cell: (r) => t(`consent.${r.kind}`, r.kind.replace('_', ' ')) },
      { key: 'g', header: t('priv.granted', 'Given'), cell: (r) => r.granted },
      { key: 'r', header: t('priv.refused', 'Refused'), cell: (r) => r.refused },
      { key: 'n', header: t('priv.noAnswer', 'No answer yet'), cell: (r) => r.no_answer },
    ]} />
  );
}

function RetentionTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/privacy/retention'], queryFn: () => api.get<{ messages_months: number | null; ai_conversations_months: number | null; audit_months: number | null; visitor_logs_months: number | null; support_access: boolean }>('/privacy/retention') });
  const [v, setV] = useState<typeof q.data | null>(null);
  const save = useMutation({ mutationFn: () => api.put('/privacy/retention', v ?? q.data), onSuccess: () => toast('success', t('common.saved', 'Saved')) });
  if (!q.data) return <Spinner />;
  const cur = v ?? q.data;
  const months = (k: 'messages_months' | 'ai_conversations_months' | 'audit_months' | 'visitor_logs_months', label: string, min = 1) => (
    <Field label={label} hint={t('priv.forever', 'Empty keeps them')}>{(a) => <Input {...a} type="number" min={min} max={240} value={cur[k] ?? ''} onChange={(e) => setV({ ...cur, [k]: e.target.value ? Number(e.target.value) : null })} className="w-32" />}</Field>
  );
  return (
    <Card className="max-w-xl space-y-3 p-5">
      <h2 className="font-semibold">{t('priv.keepFor', 'Keep for (months)')}</h2>
      {months('messages_months', t('priv.messages', 'Messages'))}
      {months('ai_conversations_months', t('priv.ai', 'AI tutor conversations'))}
      {months('audit_months', t('priv.audit', 'Audit log'), 12)}
      {months('visitor_logs_months', t('priv.visitors', 'Visitor log'))}
      <label className="flex items-start gap-2 border-t border-border pt-3 text-sm">
        <input type="checkbox" className="mt-1" checked={cur.support_access} onChange={(e) => setV({ ...cur, support_access: e.target.checked })} />
        <span>{t('priv.support', 'Allow the Acadex support team to sign in as an administrator to help us (each sign-in is recorded in our audit log)')}</span>
      </label>
      <MutationError error={save.error} />
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
    </Card>
  );
}

function ExportTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/institution/exports'], queryFn: () => api.get<{ id: number; scope: string; status: string; size_bytes: number | null; created_at: string; expires_at: string | null; subject: string | null; error: string | null }[]>('/institution/exports'), refetchInterval: (qq) => (qq.state.data?.some((e) => ['queued', 'running'].includes(e.status)) ? 4000 : false) });
  const start = useMutation({ mutationFn: () => api.post('/institution/exports'), onSuccess: () => q.refetch() });
  const [confirm, setConfirm] = useState('');
  const close = useMutation({ mutationFn: () => api.post<{ deletion_due_at: string }>('/institution/deletion', { confirm }), onSuccess: (r) => toast('success', t('priv.closing', 'Everything will be erased on {{d}} unless you cancel', { d: formatDate(r.deletion_due_at) })) });
  const cancel = useMutation({ mutationFn: () => api.delete('/institution/deletion'), onSuccess: () => toast('success', t('priv.cancelled', 'Deletion cancelled')) });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t('priv.exportAll', 'Export everything')}</h2>
        <p className="text-sm text-fg-muted">{t('priv.exportHelp', 'A ZIP with every table as a spreadsheet (CSV) and every uploaded file. Ready in a few minutes, kept for 7 days.')}</p>
        <Button loading={start.isPending} onClick={() => start.mutate()}><Download className="size-4" /> {t('priv.startExport', 'Prepare an export')}</Button>
        <MutationError error={start.error} />
        <ul className="divide-y divide-border text-sm">
          {q.data?.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{formatDateTime(e.created_at)} · {e.scope === 'person' ? e.subject : t('priv.everything', 'everything')} {e.size_bytes ? `· ${(e.size_bytes / 1e6).toFixed(1)} MB` : ''}</span>
              {e.status === 'done' ? <Button size="sm" variant="outline" onClick={() => api.download(`/institution/exports/${e.id}/download`, `acadex-export-${e.id}.zip`)}>{t('common.download', 'Download')}</Button> : <StatusBadge value={e.status === 'failed' ? 'rejected' : 'pending'} label={e.status} />}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-3 border-danger p-5">
        <h2 className="font-semibold text-danger">{t('priv.closeAccount', 'Close the account')}</h2>
        <p className="text-sm">{t('priv.closeHelp', 'Everything — people, records, files — is erased 30 days after you confirm. You can cancel until then. Export first if you need a copy.')}</p>
        <Input aria-label={t('priv.typeSlug', 'Type your institution\'s short name')} placeholder={t('priv.typeSlug', 'Type your institution\'s short name')} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="flex gap-2"><Button variant="danger" disabled={!confirm} loading={close.isPending} onClick={() => close.mutate()}><Trash2 className="size-4" /> {t('priv.close', 'Close account')}</Button><Button variant="ghost" onClick={() => cancel.mutate()}>{t('priv.cancelClose', 'Cancel closing')}</Button></div>
        <MutationError error={close.error} />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- integrations

export function IntegrationsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.integrations', 'Integrations')} subtitle={t('int.subtitle', 'The REST API, webhooks, LTI 1.3 tools and OneRoster')} />
      <Tabs tabs={[
        { id: 'api', label: t('int.api', 'API keys'), content: () => <ApiKeysTab /> },
        { id: 'hooks', label: t('int.webhooks', 'Webhooks'), content: () => <WebhooksTab /> },
        { id: 'lti', label: 'LTI 1.3', content: () => <LtiTab /> },
        { id: 'oneroster', label: 'OneRoster', content: () => <Card className="max-w-xl space-y-3 p-5"><p className="text-sm">{t('int.oneroster', 'Download your organisation, terms, courses, classes, people and enrolments as OneRoster 1.1 CSV files (import them anywhere OneRoster is accepted). To import, use People → Import.')}</p><Button onClick={() => api.download('/institution/oneroster/export', 'oneroster.zip')}><Download className="size-4" /> {t('int.download', 'Download OneRoster ZIP')}</Button></Card> },
      ]} />
    </>
  );
}

function ApiKeysTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/institution/api-keys'], queryFn: () => api.get<{ keys: { id: number; name: string; prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null; created_at: string }[]; docs: string }>('/institution/api-keys') });
  const [v, setV] = useState({ name: '', scopes: [] as string[] });
  const [shown, setShown] = useState<string | null>(null);
  const add = useMutation({ mutationFn: () => api.post<{ key: string }>('/institution/api-keys', { ...v, expires_on: null }), onSuccess: (r) => { setShown(r.key); setV({ name: '', scopes: [] }); void q.refetch(); } });
  const revoke = useMutation({ mutationFn: (id: number) => api.delete(`/institution/api-keys/${id}`), onSuccess: () => q.refetch() });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <Field label={t('int.keyName', 'Name')}>{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('int.keyNameHint', 'e.g. Data warehouse')} />}</Field>
        <fieldset className="grid grid-cols-2 gap-1 text-sm">
          <legend className="mb-1 font-medium">{t('int.scopes', 'Allowed to')}</legend>
          {API_SCOPES.map((s) => <label key={s} className="flex items-center gap-1.5"><input type="checkbox" checked={v.scopes.includes(s)} onChange={(e) => setV({ ...v, scopes: e.target.checked ? [...v.scopes, s] : v.scopes.filter((x) => x !== s) })} /> <code>{s}</code></label>)}
        </fieldset>
        <MutationError error={add.error} />
        <Button disabled={!v.name || !v.scopes.length} loading={add.isPending} onClick={() => add.mutate()}><KeyRound className="size-4" /> {t('int.create', 'Create key')}</Button>
        {shown && <Alert tone="warning">{t('int.once', 'Copy this key now — it will not be shown again:')} <code className="break-all">{shown}</code> <CopyButton text={shown} /></Alert>}
        {q.data && <p className="text-xs text-fg-muted">{t('int.docs', 'API reference:')} <a className="text-primary underline" href={q.data.docs} target="_blank" rel="noreferrer">{q.data.docs}</a> · <code>GET /api/v1/students</code></p>}
      </Card>
      <Card className="divide-y divide-border p-2 text-sm">
        {!q.data?.keys.length ? <EmptyState title={t('int.noKeys', 'No keys yet')} /> : q.data.keys.map((k) => (
          <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
            <span><b>{k.name}</b> <code className="text-xs">{k.prefix}…</code><span className="block text-xs text-fg-muted">{k.scopes.join(' ')} · {k.last_used_at ? t('int.used', 'used {{d}}', { d: formatDateTime(k.last_used_at) }) : t('int.never', 'never used')}</span></span>
            {k.revoked_at ? <Badge>{t('int.revoked', 'revoked')}</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(k.id)}>{t('int.revoke', 'Revoke')}</Button>}
          </div>
        ))}
      </Card>
    </div>
  );
}

function WebhooksTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/institution/webhooks'], queryFn: () => api.get<{ id: number; url: string; events: string[]; enabled: boolean; failures: number; failed: number }[]>('/institution/webhooks') });
  const [v, setV] = useState({ url: '', events: [] as string[] });
  const [secret, setSecret] = useState<string | null>(null);
  const add = useMutation({ mutationFn: () => api.post<{ secret: string }>('/institution/webhooks', v), onSuccess: (r) => { setSecret(r.secret); setV({ url: '', events: [] }); void q.refetch(); } });
  const test = useMutation({ mutationFn: (id: number) => api.post<{ result: string }>(`/institution/webhooks/${id}/test`), onSuccess: (r) => toast(r.result === 'delivered' ? 'success' : 'error', t('int.testResult', 'Test: {{r}}', { r: r.result })) });
  const del = useMutation({ mutationFn: (id: number) => api.delete(`/institution/webhooks/${id}`), onSuccess: () => q.refetch() });
  const [log, setLog] = useState<number | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <Field label="URL">{(a) => <Input {...a} type="url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://example.com/acadex" />}</Field>
        <fieldset className="grid grid-cols-2 gap-1 text-sm">
          <legend className="mb-1 font-medium">{t('int.events', 'Events')}</legend>
          {WEBHOOK_EVENTS.map((s) => <label key={s} className="flex items-center gap-1.5"><input type="checkbox" checked={v.events.includes(s)} onChange={(e) => setV({ ...v, events: e.target.checked ? [...v.events, s] : v.events.filter((x) => x !== s) })} /> <code>{s}</code></label>)}
        </fieldset>
        <MutationError error={add.error} />
        <Button disabled={!v.url || !v.events.length} loading={add.isPending} onClick={() => add.mutate()}><Plus className="size-4" /> {t('int.addHook', 'Add endpoint')}</Button>
        {secret && <Alert tone="warning">{t('int.secret', 'Signing secret (shown once):')} <code className="break-all">{secret}</code> <CopyButton text={secret} /></Alert>}
        <p className="text-xs text-fg-muted">{t('int.sigHelp', 'Each request carries Acadex-Signature: t=<time>,v1=<HMAC-SHA256 of "t.body"> — check it with the secret. Failed deliveries are retried for about 8 hours.')}</p>
      </Card>
      <Card className="divide-y divide-border p-2 text-sm">
        {q.data?.map((w) => (
          <div key={w.id} className="space-y-1 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><code className="break-all">{w.url}</code>{w.enabled ? <Badge tone="success">{t('int.on', 'on')}</Badge> : <Badge tone="danger">{t('int.off', 'off')}</Badge>}</div>
            <p className="text-xs text-fg-muted">{w.events.join(', ')}{w.failed ? ` · ${t('int.failedN', '{{n}} failed', { n: w.failed })}` : ''}</p>
            <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => test.mutate(w.id)}><Send className="size-3.5" /> {t('int.test', 'Send test')}</Button><Button size="sm" variant="ghost" onClick={() => setLog(w.id)}>{t('int.log', 'Deliveries')}</Button><Button size="sm" variant="ghost" onClick={() => del.mutate(w.id)}>{t('common.delete', 'Delete')}</Button></div>
          </div>
        ))}
      </Card>
      {log && <DeliveryLog id={log} onClose={() => setLog(null)} />}
    </div>
  );
}

function DeliveryLog({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['hook-log', id], queryFn: () => api.get<{ id: number; event: string; status: string; attempts: number; response_code: number | null; error: string | null; created_at: string }[]>(`/institution/webhooks/${id}/deliveries`) });
  return (
    <Dialog open onClose={onClose} title={t('int.log', 'Deliveries')} className="max-w-2xl">
      <ul className="divide-y divide-border text-sm">{q.data?.map((d) => <li key={d.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{formatDateTime(d.created_at)} · <code>{d.event}</code></span><span>{d.status} · {d.response_code ?? d.error ?? ''} · ×{d.attempts}</span></li>)}</ul>
    </Dialog>
  );
}

function LtiTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/lti/tools'], queryFn: () => api.get<{ tools: { id: number; name: string; client_id: string; login_url: string; launch_url: string; deployment_id: string; enabled: boolean }[]; platform: { issuer: string; jwks_url: string; auth_url: string } }>('/lti/tools') });
  const [v, setV] = useState({ name: '', client_id: '', login_url: '', launch_url: '', jwks_url: '', deployment_id: '1', send_pii: false });
  const add = useMutation({ mutationFn: () => api.post('/lti/tools', v), onSuccess: () => { setV({ name: '', client_id: '', login_url: '', launch_url: '', jwks_url: '', deployment_id: '1', send_pii: false }); void q.refetch(); } });
  const del = useMutation({ mutationFn: (id: number) => api.delete(`/lti/tools/${id}`), onSuccess: () => q.refetch() });
  const f = (k: keyof typeof v, label: string) => <Field label={label}>{(a) => <Input {...a} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}</Field>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        {q.data && (
          <div className="space-y-1 rounded bg-surface-2 p-3 text-xs">
            <p className="font-medium">{t('int.giveTool', 'Give the tool these details:')}</p>
            {Object.entries({ Issuer: q.data.platform.issuer, 'Keyset (JWKS) URL': q.data.platform.jwks_url, 'OIDC auth URL': q.data.platform.auth_url }).map(([k, val]) => <p key={k} className="break-all">{k}: <code>{val}</code> <CopyButton text={val} /></p>)}
          </div>
        )}
        {f('name', t('common.name', 'Name'))}
        {f('client_id', 'Client ID')}
        {f('login_url', t('int.loginUrl', 'Tool login (OIDC initiation) URL'))}
        {f('launch_url', t('int.launchUrl', 'Tool launch URL'))}
        {f('deployment_id', 'Deployment ID')}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.send_pii} onChange={(e) => setV({ ...v, send_pii: e.target.checked })} /> {t('int.pii', 'Share names and emails with this tool')}</label>
        <MutationError error={add.error} />
        <Button loading={add.isPending} onClick={() => add.mutate()}>{t('int.addTool', 'Add tool')}</Button>
      </Card>
      <Card className="divide-y divide-border p-2 text-sm">
        {q.data?.tools.map((tl) => <div key={tl.id} className="flex items-center justify-between gap-2 p-2"><span><b>{tl.name}</b><span className="block break-all text-xs text-fg-muted">{tl.launch_url}</span></span><Button size="sm" variant="ghost" onClick={() => del.mutate(tl.id)}>{t('common.delete', 'Delete')}</Button></div>)}
        {!q.data?.tools.length && <EmptyState title={t('int.noTools', 'No tools yet')} />}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- reports

export function ReportsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [key, setKey] = useState<string>('attendance');
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ from: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), to: today });
  const q = useQuery({ queryKey: ['report', key, f], queryFn: () => api.get<{ title: string; columns: string[]; rows: (string | number | null)[][] }>(`/reports/${key}`, f) });
  const schedules = useQuery({ queryKey: ['/report-schedules'], queryFn: () => api.get<{ id: number; report: string; format: string; frequency: string; recipients: string[]; last_sent_at: string | null }[]>('/report-schedules') });
  const [s, setS] = useState({ frequency: 'weekly', format: 'xlsx', recipients: '' });
  const add = useMutation({ mutationFn: () => api.post('/report-schedules', { report: key, filters: {}, format: s.format, frequency: s.frequency, recipients: s.recipients.split(/[,\s]+/).filter(Boolean) }), onSuccess: () => { toast('success', t('rep.scheduled', 'Scheduled')); void schedules.refetch(); } });
  const del = useMutation({ mutationFn: (id: number) => api.delete(`/report-schedules/${id}`), onSuccess: () => schedules.refetch() });
  const send = useMutation({ mutationFn: (id: number) => api.post(`/report-schedules/${id}/send`), onSuccess: () => toast('success', t('rep.sent', 'Sent')) });
  const dl = (format: string) => api.download(`/reports/${key}?${new URLSearchParams({ ...f, format })}`, `${key}.${format}`);
  return (
    <>
      <PageHeader title={t('nav.reports', 'Reports')} />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label={t('rep.report', 'Report')}>{(a) => <Select {...a} value={key} onChange={(e) => setKey(e.target.value)}>{REPORTS.map((r) => <option key={r} value={r}>{t(`rep.r.${r}`, r.replace(/_/g, ' '))}</option>)}</Select>}</Field>
        <Field label={t('rep.from', 'From')}>{(a) => <Input {...a} type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label={t('rep.to', 'To')}>{(a) => <Input {...a} type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        <div className="flex gap-2">{['xlsx', 'csv', 'pdf'].map((x) => <Button key={x} size="sm" variant="outline" onClick={() => dl(x)}><Download className="size-3.5" /> {x.toUpperCase()}</Button>)}</div>
      </Card>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Spinner /> : (
        <Card className="overflow-x-auto p-0">
          <p className="px-4 py-2 text-sm font-medium">{q.data.title} · {t('rep.rows', '{{n}} rows', { n: q.data.rows.length })}</p>
          {!q.data.rows.length ? <EmptyState title={t('rep.empty', 'Nothing in this period')} /> : (
            <table className="w-full text-sm">
              <thead><tr>{q.data.columns.map((c) => <th key={c} className="border-b border-border px-3 py-2 text-start text-xs font-semibold uppercase text-fg-muted">{c}</th>)}</tr></thead>
              <tbody>{q.data.rows.slice(0, 500).map((r, i) => <tr key={i} className="odd:bg-surface-2/40">{r.map((c, j) => <td key={j} className="px-3 py-1.5 tabular-nums">{c ?? '—'}</td>)}</tr>)}</tbody>
            </table>
          )}
        </Card>
      )}
      <Card className="mt-4 space-y-3 p-4">
        <h2 className="font-semibold">{t('rep.schedule', 'Email this report regularly')}</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Select aria-label={t('rep.frequency', 'How often')} value={s.frequency} onChange={(e) => setS({ ...s, frequency: e.target.value })} className="w-32">{['daily', 'weekly', 'monthly'].map((x) => <option key={x} value={x}>{t(`rep.f.${x}`, x)}</option>)}</Select>
          <Select aria-label={t('rep.format', 'Format')} value={s.format} onChange={(e) => setS({ ...s, format: e.target.value })} className="w-24">{['xlsx', 'csv', 'pdf'].map((x) => <option key={x}>{x}</option>)}</Select>
          <Input aria-label={t('rep.to', 'To')} className="min-w-60 flex-1" placeholder={t('rep.emails', 'Emails, separated by commas')} value={s.recipients} onChange={(e) => setS({ ...s, recipients: e.target.value })} />
          <Button loading={add.isPending} onClick={() => add.mutate()}>{t('rep.add', 'Schedule')}</Button>
        </div>
        <MutationError error={add.error} />
        <ul className="divide-y divide-border text-sm">
          {schedules.data?.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{t(`rep.r.${x.report}`, x.report.replace(/_/g, ' '))} · {x.frequency} · {x.format} → {x.recipients.join(', ')}{x.last_sent_at && <span className="text-xs text-fg-muted"> · {t('rep.last', 'last {{d}}', { d: formatDateTime(x.last_sent_at) })}</span>}</span>
              <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => send.mutate(x.id)}>{t('rep.sendNow', 'Send now')}</Button><Button size="sm" variant="ghost" onClick={() => del.mutate(x.id)}>{t('common.delete', 'Delete')}</Button></span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-muted">{t('rep.when', 'Sent at 7:00 — weekly on Mondays, monthly on the 1st — as a download link valid for 7 days.')}</p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- modules

export function ModulesCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/modules'], queryFn: () => api.get<{ plan: string; allowed: ModuleKey[]; enabled: ModuleKey[]; all: ModuleKey[] }>('/modules') });
  const save = useMutation({ mutationFn: (v: Partial<Record<ModuleKey, boolean>>) => api.put('/modules', { modules: v }), onSuccess: () => { toast('success', t('common.saved', 'Saved')); void q.refetch(); } });
  if (!q.data) return <Spinner />;
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">{t('mod.title', 'Modules')}</h2>
      <p className="text-sm text-fg-muted">{t('mod.help', 'Turn on the extra modules your institution uses. Your plan ({{plan}}) decides which are available.', { plan: q.data.plan })}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.data.all.map((m) => {
          const allowed = q.data!.allowed.includes(m);
          return (
            <label key={m} className={`flex items-center gap-2 rounded border border-border p-3 ${allowed ? '' : 'opacity-60'}`}>
              <input type="checkbox" disabled={!allowed || save.isPending} checked={q.data!.enabled.includes(m)} onChange={(e) => save.mutate({ [m]: e.target.checked })} />
              <span className="flex-1">{t(`mod.${m}`, MODULE_LABELS[m])}</span>
              {!allowed && <Badge>{t('mod.upgrade', 'upgrade')}</Badge>}
            </label>
          );
        })}
      </div>
      <MutationError error={save.error} />
    </Card>
  );
}



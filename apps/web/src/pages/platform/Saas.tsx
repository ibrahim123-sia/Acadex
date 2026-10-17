// The platform owner's SaaS screens: plans, tenant invoices, usage / cost / margin, tenant
// health, announcements, demo requests and feedback, platform settings, and per-institution
// actions (overrides, support sign-in, deletion).
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MODULES, MODULE_LABELS } from '@acadex/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, DataTable, Dialog, ErrorState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';

interface PlanRow {
  key: string;
  name: string;
  description: string;
  prices: Record<string, number>;
  limits: Record<string, number | null>;
  features: { modules: string[]; api: boolean; sso: boolean; white_label: boolean; custom_domain: boolean; lti: boolean };
  overage: Record<string, number>;
  trial_days: number;
  public: boolean;
  position: number;
  institutions?: number;
}

export function PlatformSaasPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('plat.business', 'Business')} subtitle={t('plat.businessSub', 'Plans, billing, usage and margin, tenant health and the public site')} />
      <Tabs
        tabs={[
          { id: 'health', label: t('plat.health', 'Tenant health'), content: () => <HealthTab /> },
          { id: 'usage', label: t('plat.usage', 'Usage & margin'), content: () => <UsageTab /> },
          { id: 'invoices', label: t('plat.invoices', 'Invoices'), content: () => <InvoicesTab /> },
          { id: 'plans', label: t('plat.plans', 'Plans'), content: () => <PlansTab /> },
          { id: 'announce', label: t('plat.announce', 'Announcements'), content: () => <AnnouncementsTab /> },
          { id: 'leads', label: t('plat.leads', 'Demo requests & feedback'), content: () => <LeadsTab /> },
          { id: 'settings', label: t('nav.settings', 'Settings'), content: () => <SettingsTab /> },
        ]}
      />
    </>
  );
}

function HealthTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['plat-health'], queryFn: () => api.get<{ id: number; name: string; plan: string; status: string; health: number; level: string; last_activity: string | null; active_7d: number; accounts: number; students: number; storage_bytes: number; overdue_invoices: number; trial_ends_at: string | null; deletion_due_at: string | null }[]>('/platform/health') });
  const [open, setOpen] = useState<{ id: number; name: string } | null>(null);
  return (
    <>
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        rowKey={(r) => r.id}
        columns={[
          { key: 'n', header: t('plat.institution', 'Institution'), cell: (r) => <button className="text-start font-medium text-primary hover:underline" onClick={() => setOpen(r)}>{r.name}</button> },
          { key: 'h', header: t('plat.health', 'Health'), cell: (r) => <Badge tone={r.level === 'good' ? 'success' : r.level === 'watch' ? 'warning' : 'danger'}>{r.health}</Badge> },
          { key: 'p', header: t('plat.plan', 'Plan'), cell: (r) => <span>{r.plan}{r.trial_ends_at && <span className="block text-xs text-fg-muted">{t('plat.trialUntil', 'trial until {{d}}', { d: formatDate(r.trial_ends_at) })}</span>}</span> },
          { key: 'a', header: t('plat.active', 'Active (7 days)'), cell: (r) => `${r.active_7d} / ${r.accounts}`, hideOnMobile: true },
          { key: 'l', header: t('plat.lastActivity', 'Last activity'), cell: (r) => (r.last_activity ? formatDateTime(r.last_activity) : '—'), hideOnMobile: true },
          { key: 's', header: t('plat.students', 'Students'), cell: (r) => r.students, hideOnMobile: true },
          { key: 'st', header: t('plat.storage', 'Storage'), cell: (r) => `${(r.storage_bytes / 1e9).toFixed(2)} GB`, hideOnMobile: true },
          { key: 'o', header: t('plat.overdue', 'Overdue'), cell: (r) => (r.overdue_invoices ? <Badge tone="danger">{r.overdue_invoices}</Badge> : '—') },
          { key: 'x', header: '', cell: (r) => (r.deletion_due_at ? <Badge tone="danger">{t('plat.deleting', 'deleting {{d}}', { d: formatDate(r.deletion_due_at) })}</Badge> : r.status !== 'active' ? <StatusBadge value={r.status} /> : null) },
        ]}
      />
      {open && <InstitutionActions inst={open} onClose={() => { setOpen(null); void q.refetch(); }} />}
    </>
  );
}

function InstitutionActions({ inst, onClose }: { inst: { id: number; name: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { applySession } = useAuth();
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [trial, setTrial] = useState('');
  const [reason, setReason] = useState('');
  const overrides = useMutation({ mutationFn: () => api.patch(`/platform/institutions/${inst.id}/overrides`, { features, ...(trial ? { trial_ends_at: trial } : {}) }), onSuccess: () => toast('success', t('common.saved', 'Saved')) });
  const impersonate = useMutation({
    mutationFn: () => api.post<Parameters<typeof applySession>[0]>(`/platform/institutions/${inst.id}/impersonate`, { reason }),
    onSuccess: (s) => {
      applySession(s);
      window.location.assign('/home');
    },
  });
  const deletion = useMutation({ mutationFn: (action: 'schedule' | 'cancel') => api.post(`/platform/institutions/${inst.id}/deletion`, { action }), onSuccess: () => toast('success', t('common.saved', 'Saved')) });
  const run = useMutation({ mutationFn: () => api.post<{ invoices: number }>('/platform/billing/run', { month: new Date().toISOString().slice(0, 7), institution_id: inst.id }), onSuccess: (r) => toast('success', t('plat.invoiced', '{{n}} invoice(s) issued', { n: r.invoices })) });
  const keys = [...MODULES, 'api', 'sso', 'white_label', 'custom_domain', 'lti'];
  return (
    <Dialog open onClose={onClose} title={inst.name} className="max-w-xl">
      <div className="space-y-5 text-sm">
        <section className="space-y-2">
          <h3 className="font-semibold">{t('plat.overrides', 'Overrides (beyond the plan)')}</h3>
          <div className="grid grid-cols-2 gap-1">
            {keys.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <Select aria-label={k} value={features[k] === undefined ? '' : features[k] ? 'on' : 'off'} onChange={(e) => { const v = e.target.value; const next = { ...features }; if (!v) delete next[k]; else next[k] = v === 'on'; setFeatures(next); }} className="h-8 w-24">
                  <option value="">{t('plat.asPlan', 'plan')}</option>
                  <option value="on">{t('plat.on', 'on')}</option>
                  <option value="off">{t('plat.off', 'off')}</option>
                </Select>
                {MODULE_LABELS[k as keyof typeof MODULE_LABELS] ?? k}
              </label>
            ))}
          </div>
          <Field label={t('plat.trialEnds', 'Trial ends')} optional>{(a) => <Input {...a} type="date" value={trial} onChange={(e) => setTrial(e.target.value)} className="w-48" />}</Field>
          <Button size="sm" loading={overrides.isPending} onClick={() => overrides.mutate()}>{t('common.save', 'Save')}</Button>
          <MutationError error={overrides.error} />
        </section>
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="font-semibold">{t('plat.support', 'Support sign-in')}</h3>
          <p className="text-fg-muted">{t('plat.supportHelp', 'Opens a one-hour session as their administrator — only if they allowed support access. Both audit logs record it.')}</p>
          <Input aria-label={t('plat.reason', 'Reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('plat.reasonHint', 'Why (shown in their audit log)')} />
          <Button size="sm" variant="outline" disabled={reason.trim().length < 3} loading={impersonate.isPending} onClick={() => impersonate.mutate()}>{t('plat.signInAs', 'Sign in as their administrator')}</Button>
          <MutationError error={impersonate.error} />
        </section>
        <section className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate()}>{t('plat.invoiceNow', 'Invoice this month now')}</Button>
          <Button size="sm" variant="danger" onClick={() => deletion.mutate('schedule')}>{t('plat.scheduleDeletion', 'Schedule deletion (30 days)')}</Button>
          <Button size="sm" variant="ghost" onClick={() => deletion.mutate('cancel')}>{t('plat.cancelDeletion', 'Cancel deletion')}</Button>
          <MutationError error={deletion.error ?? run.error} />
        </section>
      </div>
    </Dialog>
  );
}

function UsageTab() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const q = useQuery({ queryKey: ['plat-usage', month], queryFn: () => api.get<{ id: number; name: string; plan: string; students: number; storage_gb: number; ai_usd: number; sms: number; whatsapp: number; emails: number; cost_usd: number; revenue: Record<string, number>; margin_usd: number | null }[]>('/platform/usage', { month }) });
  return (
    <>
      <Input type="month" aria-label={t('plat.month', 'Month')} value={month} onChange={(e) => setMonth(e.target.value)} className="mb-3 w-48" />
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        rowKey={(r) => r.id}
        columns={[
          { key: 'n', header: t('plat.institution', 'Institution'), cell: (r) => <span className="font-medium">{r.name} <span className="text-xs text-fg-muted">{r.plan}</span></span> },
          { key: 's', header: t('plat.students', 'Students'), cell: (r) => r.students },
          { key: 'g', header: 'GB', cell: (r) => r.storage_gb.toFixed(2), hideOnMobile: true },
          { key: 'ai', header: 'AI $', cell: (r) => r.ai_usd.toFixed(2), hideOnMobile: true },
          { key: 'm', header: t('plat.messages', 'SMS / WA'), cell: (r) => `${r.sms} / ${r.whatsapp}`, hideOnMobile: true },
          { key: 'c', header: t('plat.cost', 'Cost $'), cell: (r) => r.cost_usd.toFixed(2) },
          { key: 'r', header: t('plat.revenue', 'Revenue'), cell: (r) => Object.entries(r.revenue).map(([c, v]) => `${c} ${v.toFixed(0)}`).join(', ') || '—' },
          { key: 'mg', header: t('plat.margin', 'Margin $'), cell: (r) => (r.margin_usd == null ? '—' : <span className={r.margin_usd < 0 ? 'text-danger' : 'text-success'}>{r.margin_usd.toFixed(2)}</span>) },
        ]}
      />
    </>
  );
}

function InvoicesTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const list = usePagedList<{ id: number; number: string; institution: string; plan: string; period_start: string; currency: string; total: number; status: string; due_date: string; paid_at: string | null; method: string | null }>('/platform/billing/invoices', { status: status || undefined });
  const [paying, setPaying] = useState<number | null>(null);
  const [ref, setRef] = useState('');
  const paid = useMutation({ mutationFn: () => api.post(`/platform/billing/invoices/${paying}/paid`, { method: 'bank', reference: ref }), onSuccess: () => { setPaying(null); setRef(''); void list.refetch(); toast('success', t('plat.markedPaid', 'Marked paid')); } });
  return (
    <>
      <Select aria-label={t('common.status', 'Status')} value={status} onChange={(e) => setStatus(e.target.value)} className="mb-3 w-40"><option value="">{t('common.all', 'All')}</option>{['open', 'overdue', 'paid', 'void'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        columns={[
          { key: 'n', header: t('plat.number', 'Number'), cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
          { key: 'i', header: t('plat.institution', 'Institution'), cell: (r) => r.institution },
          { key: 'p', header: t('plat.period', 'Period'), cell: (r) => formatDate(r.period_start).slice(-8), hideOnMobile: true },
          { key: 't', header: t('plat.total', 'Total'), cell: (r) => `${r.currency} ${r.total.toFixed(2)}` },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <StatusBadge value={r.status === 'open' ? 'issued' : r.status} label={r.status} /> },
          { key: 'd', header: t('plat.due', 'Due'), cell: (r) => formatDate(r.due_date), hideOnMobile: true },
          { key: 'a', header: '', cell: (r) => ['open', 'overdue'].includes(r.status) && <Button size="sm" variant="outline" onClick={() => setPaying(r.id)}>{t('plat.markPaid', 'Mark paid')}</Button> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {paying && (
        <Dialog open onClose={() => setPaying(null)} title={t('plat.markPaid', 'Mark paid')}>
          <div className="space-y-3">
            <Field label={t('plat.reference', 'Bank reference')} optional>{(a) => <Input {...a} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
            <MutationError error={paid.error} />
            <Button loading={paid.isPending} onClick={() => paid.mutate()}>{t('plat.markPaid', 'Mark paid')}</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

const EMPTY_PLAN: PlanRow = { key: '', name: '', description: '', prices: { PKR: 0, USD: 0 }, limits: { students: null, staff: null, storage_mb: null, ai_usd: null, messages: null }, features: { modules: [], api: false, sso: false, white_label: false, custom_domain: false, lti: false }, overage: {}, trial_days: 14, public: true, position: 0 };

function PlansTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['plat-plans'], queryFn: () => api.get<PlanRow[]>('/platform/plans') });
  const [edit, setEdit] = useState<PlanRow | null>(null);
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner />;
  return (
    <>
      <div className="mb-3"><Button onClick={() => setEdit(EMPTY_PLAN)}>{t('plat.newPlan', 'New plan')}</Button></div>
      <div className="grid gap-4 md:grid-cols-3">
        {q.data.map((p) => (
          <Card key={p.key} className="space-y-2 p-4 text-sm">
            <div className="flex items-center justify-between"><h3 className="font-semibold">{p.name} <span className="font-mono text-xs text-fg-muted">{p.key}</span></h3>{!p.public && <Badge>{t('plat.hidden', 'hidden')}</Badge>}</div>
            <p>{Object.entries(p.prices).map(([c, v]) => `${c} ${v}`).join(' · ')} / {t('plat.month', 'month')}</p>
            <p className="text-fg-muted">{t('plat.studentsLimit', 'Students: {{n}}', { n: p.limits.students ?? '∞' })} · {t('plat.institutionsOn', '{{n}} institutions', { n: p.institutions ?? 0 })}</p>
            <Button size="sm" variant="outline" onClick={() => setEdit(p)}>{t('common.edit', 'Edit')}</Button>
          </Card>
        ))}
      </div>
      {edit && <PlanDialog plan={edit} onClose={() => { setEdit(null); void q.refetch(); }} />}
    </>
  );
}

function PlanDialog({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [json, setJson] = useState(JSON.stringify({ ...plan, institutions: undefined }, null, 2));
  const save = useMutation({ mutationFn: () => api.put('/platform/plans', JSON.parse(json)), onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={plan.key ? plan.name : t('plat.newPlan', 'New plan')} description={t('plat.planHelp', 'Prices per month by currency; limits (null = unlimited); modules from: library, hr, transport, hostel, inventory, visitors.')} className="max-w-2xl">
      <Textarea aria-label="JSON" rows={22} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
      <MutationError error={save.error} />
      <Button className="mt-3" loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
    </Dialog>
  );
}

function AnnouncementsTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['plat-ann'], queryFn: () => api.get<{ id: number; title: string; body: string; level: string; created_at: string; ends_at: string | null }[]>('/platform/announcements') });
  const [v, setV] = useState({ title: '', body: '', level: 'info' });
  const add = useMutation({ mutationFn: () => api.post('/platform/announcements', v), onSuccess: () => { setV({ title: '', body: '', level: 'info' }); void q.refetch(); } });
  const del = useMutation({ mutationFn: (id: number) => api.delete(`/platform/announcements/${id}`), onSuccess: () => q.refetch() });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
        <Field label={t('msg.message', 'Message')} optional>{(a) => <Textarea {...a} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field>
        <Field label={t('plat.level', 'Level')}>{(a) => <Select {...a} value={v.level} onChange={(e) => setV({ ...v, level: e.target.value })}>{['info', 'warning', 'critical'].map((l) => <option key={l}>{l}</option>)}</Select>}</Field>
        <MutationError error={add.error} />
        <Button disabled={!v.title} loading={add.isPending} onClick={() => add.mutate()}>{t('plat.publish', 'Publish to institutions')}</Button>
      </Card>
      <Card className="divide-y divide-border p-2 text-sm">
        {q.data?.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-2 p-2">
            <div><Badge tone={a.level === 'critical' ? 'danger' : a.level === 'warning' ? 'warning' : 'info'}>{a.level}</Badge> <b>{a.title}</b><p className="text-fg-muted">{a.body}</p></div>
            <Button size="sm" variant="ghost" onClick={() => del.mutate(a.id)}>{t('common.delete', 'Delete')}</Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

function LeadsTab() {
  const { t } = useTranslation();
  const demos = useQuery({ queryKey: ['plat-demos'], queryFn: () => api.page<{ id: number; name: string; email: string; phone: string; institution: string; type: string; size: string; message: string; status: string; created_at: string }>('/platform/demo-requests') });
  const fb = useQuery({ queryKey: ['plat-fb'], queryFn: () => api.page<{ id: number; institution: string | null; person: string | null; page: string; rating: number | null; message: string; created_at: string }>('/platform/feedback') });
  const status = useMutation({ mutationFn: (v: { id: number; status: string }) => api.patch(`/platform/demo-requests/${v.id}`, { status: v.status }), onSuccess: () => demos.refetch() });
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-semibold">{t('plat.demos', 'Demo requests')}</h3>
        <DataTable rows={demos.data?.rows} loading={demos.isPending} error={demos.error} rowKey={(r) => r.id} columns={[
          { key: 'w', header: t('common.when', 'When'), cell: (r) => formatDate(r.created_at) },
          { key: 'i', header: t('plat.institution', 'Institution'), cell: (r) => `${r.institution} (${r.type}${r.size ? `, ${r.size}` : ''})` },
          { key: 'c', header: t('plat.contact', 'Contact'), cell: (r) => <span>{r.name}<span className="block text-xs text-fg-muted">{r.email} {r.phone}</span></span> },
          { key: 'm', header: t('msg.message', 'Message'), cell: (r) => <span className="text-xs">{r.message}</span>, hideOnMobile: true },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <Select aria-label={t('common.status', 'Status')} value={r.status} onChange={(e) => status.mutate({ id: r.id, status: e.target.value })} className="h-8 w-32">{['new', 'contacted', 'won', 'lost'].map((s) => <option key={s}>{s}</option>)}</Select> },
        ]} />
      </section>
      <section>
        <h3 className="mb-2 font-semibold">{t('plat.feedback', 'Product feedback')}</h3>
        <DataTable rows={fb.data?.rows} loading={fb.isPending} error={fb.error} rowKey={(r) => r.id} columns={[
          { key: 'w', header: t('common.when', 'When'), cell: (r) => formatDate(r.created_at) },
          { key: 'f', header: t('plat.from', 'From'), cell: (r) => `${r.person ?? '—'} · ${r.institution ?? ''}` },
          { key: 'r', header: '★', cell: (r) => r.rating ?? '—' },
          { key: 'm', header: t('msg.message', 'Message'), cell: (r) => <span>{r.message}<span className="block text-xs text-fg-muted">{r.page}</span></span> },
        ]} />
      </section>
    </div>
  );
}

function SettingsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['plat-settings'], queryFn: () => api.get<Record<string, unknown>>('/platform/settings') });
  const [key, setKey] = useState('unit_costs');
  const [json, setJson] = useState('');
  const DEFAULTS: Record<string, unknown> = {
    unit_costs: { storage_gb_month: 0.023, sms: 0.012, whatsapp: 0.03, email: 0.0004, student_month: 0.02 },
    tax_rates: { PK: { label: 'Sales tax on services', rate: 16 } },
    ai_markup: 1.25,
    suspend_after_days: 21,
    tutorial_videos: { 'take-attendance': '' },
    bank_details: { bank: '', title: '', iban: '' },
  };
  const save = useMutation({ mutationFn: (raw: string) => api.put(`/platform/settings/${key}`, { value: JSON.parse(raw) }), onSuccess: () => { toast('success', t('common.saved', 'Saved')); void q.refetch(); } });
  if (!q.data) return <Spinner />;
  const current = q.data[key] ?? DEFAULTS[key];
  return (
    <Card className="max-w-2xl space-y-3 p-4">
      <Select aria-label={t('plat.setting', 'Setting')} value={key} onChange={(e) => { setKey(e.target.value); setJson(''); }}>{Object.keys(DEFAULTS).map((k) => <option key={k} value={k}>{k}</option>)}</Select>
      <Textarea aria-label="JSON" rows={10} className="font-mono text-xs" value={json || JSON.stringify(current, null, 2)} onChange={(e) => setJson(e.target.value)} />
      <Alert>{t('plat.settingsHelp', 'Unit costs (USD) feed the margin view; tax rates apply to invoices by country; tutorial videos map help articles to video links.')}</Alert>
      <MutationError error={save.error} />
      <Button onClick={() => save.mutate(json || JSON.stringify(current))} loading={save.isPending}>{t('common.save', 'Save')}</Button>
    </Card>
  );
}

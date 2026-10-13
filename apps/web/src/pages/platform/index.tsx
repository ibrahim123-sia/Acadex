import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Building2, GraduationCap, Plus, Users, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { createInstitutionBody, PLANS } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { InviteNotice, type Invite } from '@/components/InviteNotice';
import { Alert, Button, Card, DataTable, Dialog, ErrorState, Field, Input, PageHeader, Pager, Select, Spinner, StatCard, StatusBadge, useToast } from '@/components/ui';
import { RequireAuth } from '@/components/RequireAuth';

interface Stats {
  institutions: number;
  activeInstitutions: number;
  students: number;
  teachers: number;
  revenueByCurrency: { currency: string; amount: number }[];
  recentInstitutions: { id: number; name: string; students: number }[];
}

function PlatformDashboard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['platform-stats'], queryFn: () => api.get<Stats>('/platform/stats') });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const [first, ...rest] = d.revenueByCurrency;
  return (
    <>
      <PageHeader title={t('platform.title', 'Platform overview')} subtitle={t('platform.subtitle', 'All institutions on Acadex')} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('platform.institutions', 'Institutions')} value={d.institutions} sub={t('platform.active', '{{count}} active', { count: d.activeInstitutions })} icon={Building2} />
        <StatCard label={t('nav.students', 'Students')} value={d.students} icon={Users} tone="success" />
        <StatCard label={t('nav.teachers', 'Teachers')} value={d.teachers} icon={GraduationCap} tone="warning" />
        <StatCard
          label={t('platform.fees', 'Fees collected')}
          value={first ? formatMoney(first.amount, first.currency) : '—'}
          sub={rest.map((r) => formatMoney(r.amount, r.currency)).join(' · ') || t('platform.allInstitutions', 'across all institutions')}
          icon={Wallet}
          tone="danger"
        />
      </div>
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">{t('platform.recent', 'Recently added institutions')}</h2>
        <div dir="ltr">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.recentInstitutions}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--fg-muted)' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--fg-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' }} />
              <Bar dataKey="students" fill="var(--primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

interface InstitutionRow {
  id: number;
  name: string;
  slug: string;
  contact_email: string;
  plan: string;
  status: string;
  students: number;
  teachers: number;
  classes: number;
  currency: string;
}

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Karachi', 'UTC'];
  }
})();

function RegisterInstitutionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [created, setCreated] = useState<{ name: string; invite: Invite } | null>(null);
  const form = useForm<z.input<typeof createInstitutionBody>>({
    resolver: zodResolver(createInstitutionBody),
    defaultValues: { name: '', slug: '', plan: 'free', adminName: '', adminEmail: '', currency: 'PKR', timezone: 'Asia/Karachi', locale: 'en-PK' },
  });
  const m = useMutation({
    mutationFn: (v: z.input<typeof createInstitutionBody>) => api.post<{ institution: { name: string }; admin: { invite: Invite } }>('/platform/institutions', v),
    onSuccess: (r) => {
      setCreated({ name: r.institution.name, invite: r.admin.invite });
      void qc.invalidateQueries({ queryKey: ['/platform/institutions'] });
    },
  });
  const close = () => {
    setCreated(null);
    form.reset();
    m.reset();
    onClose();
  };
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={close} title={t('platform.register', 'Register an institution')}>
      {created ? (
        <InviteNotice title={t('platform.onboarded', '{{name}} is ready', { name: created.name })} invite={created.invite} onDone={close} />
      ) : (
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <Field label={t('platform.institutionName', 'Institution name')} error={e.name?.message}>
            {(a) => (
              <Input
                {...a}
                {...form.register('name', {
                  onChange: (ev) => form.setValue('slug', ev.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)),
                })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('platform.slug', 'Address name')} hint="greenwood → greenwood.acadex.app" error={e.slug?.message}>
              {(a) => <Input {...a} dir="ltr" {...form.register('slug')} />}
            </Field>
            <Field label={t('platform.plan', 'Plan')}>
              {(a) => (
                <Select {...a} {...form.register('plan')}>
                  {PLANS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label={t('platform.adminName', 'Administrator name')} optional>
            {(a) => <Input {...a} {...form.register('adminName')} />}
          </Field>
          <Field label={t('platform.adminEmail', 'Administrator email')} error={e.adminEmail?.message}>
            {(a) => <Input {...a} type="email" dir="ltr" {...form.register('adminEmail')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('platform.currency', 'Currency')} error={e.currency?.message}>
              {(a) => <Input {...a} dir="ltr" maxLength={3} {...form.register('currency')} />}
            </Field>
            <Field label={t('platform.locale', 'Locale')} error={e.locale?.message}>
              {(a) => <Input {...a} dir="ltr" {...form.register('locale')} />}
            </Field>
            <Field label={t('platform.timezone', 'Timezone')} error={e.timezone?.message}>
              {(a) => (
                <>
                  <Input {...a} dir="ltr" list="tz-list" {...form.register('timezone')} />
                  <datalist id="tz-list">
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
          </div>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('platform.register', 'Register an institution')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function PlatformInstitutions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = usePagedList<InstitutionRow>('/platform/institutions');
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'suspended' }) => api.patch(`/platform/institutions/${id}`, { status }),
    onSuccess: (_r, v) => {
      toast('success', v.status === 'suspended' ? t('platform.suspended', 'Institution suspended') : t('platform.reactivated', 'Institution reactivated'));
      void qc.invalidateQueries({ queryKey: ['/platform/institutions'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <>
      <PageHeader
        title={t('nav.institutions', 'Institutions')}
        subtitle={t('platform.institutionsSubtitle', 'Every institution on the platform')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> {t('platform.register', 'Register an institution')}
          </Button>
        }
      />
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        columns={[
          {
            key: 'name',
            header: t('common.name', 'Name'),
            cell: (s) => (
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-fg-muted">{s.contact_email}</div>
              </div>
            ),
          },
          { key: 'plan', header: t('platform.plan', 'Plan'), cell: (s) => <StatusBadge value={s.plan} /> },
          { key: 'students', header: t('nav.students', 'Students'), cell: (s) => s.students, hideOnMobile: true },
          { key: 'teachers', header: t('nav.teachers', 'Teachers'), cell: (s) => s.teachers, hideOnMobile: true },
          { key: 'status', header: t('common.status', 'Status'), cell: (s) => <StatusBadge value={s.status} /> },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (s) => (
              <Button
                variant="ghost"
                size="sm"
                loading={setStatus.isPending && setStatus.variables?.id === s.id}
                onClick={() => setStatus.mutate({ id: s.id, status: s.status === 'active' ? 'suspended' : 'active' })}
              >
                {s.status === 'active' ? t('platform.suspend', 'Suspend') : t('platform.reactivate', 'Reactivate')}
              </Button>
            ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <RegisterInstitutionDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

interface AuditRow {
  id: number;
  created_at: string;
  institution_name: string | null;
  actor: string;
  action: string;
  entity: string;
  detail: string;
}

function PlatformAudit() {
  const { t } = useTranslation();
  const list = usePagedList<AuditRow>('/platform/audit');
  return (
    <>
      <PageHeader title={t('nav.audit', 'Audit log')} subtitle={t('platform.auditSubtitle', 'Who did what, across the platform')} />
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        columns={[
          { key: 'when', header: t('platform.when', 'When'), cell: (a) => <span className="whitespace-nowrap text-fg-muted">{formatDateTime(a.created_at)}</span> },
          { key: 'institution', header: t('platform.institution', 'Institution'), cell: (a) => a.institution_name ?? '—', hideOnMobile: true },
          { key: 'actor', header: t('platform.actor', 'By'), cell: (a) => a.actor },
          { key: 'action', header: t('platform.action', 'Action'), cell: (a) => <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{a.action}</code> },
          { key: 'detail', header: t('platform.detail', 'Details'), cell: (a) => <span className="text-fg-muted">{a.detail || a.entity}</span>, hideOnMobile: true },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </>
  );
}

export default function PlatformRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="platform.institutions.read"><PlatformDashboard /></RequireAuth>} />
      <Route path="institutions" element={<RequireAuth permission="platform.institutions.read"><PlatformInstitutions /></RequireAuth>} />
      <Route path="audit" element={<RequireAuth permission="platform.audit.read"><PlatformAudit /></RequireAuth>} />
    </Routes>
  );
}

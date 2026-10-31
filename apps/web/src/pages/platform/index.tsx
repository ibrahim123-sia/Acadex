import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Building2, GraduationCap, MailPlus, Pencil, Plus, Search, Settings2, Users, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { countryDefaults, createInstitutionBody, institutionAdminBody, INSTITUTION_TYPES, PLANS, updateInstitutionBody, type InstitutionType } from '@acadex/shared';
import { CountrySelect, gatewaysText } from '@/components/CountrySelect';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useDebounced, usePagedList } from '@/lib/queries';
import { InviteNotice, type Invite } from '@/components/InviteNotice';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pager,
  Select,
  Spinner,
  StatCard,
  StatusBadge,
  Tabs,
  useToast,
} from '@/components/ui';
import { RequireAuth } from '@/components/RequireAuth';
import { AiUsagePage, ApiManagementPage } from './Ai';
import { PlatformPeoplePage } from './People';

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
  type: InstitutionType;
  group_id: number | null;
  contact_email: string;
  primary_color: string | null;
  plan: string;
  status: string;
  students: number;
  teachers: number;
  sections: number;
  country: string;
  currency: string;
  timezone: string;
  locale: string;
}

const TYPE_LABELS: Record<InstitutionType, string> = {
  school: 'School',
  chain: 'School chain',
  college: 'College',
  university: 'University',
  academy: 'Academy',
  training_center: 'Training center',
};

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
    defaultValues: { name: '', slug: '', type: 'school', plan: 'free', adminName: '', adminEmail: '', country: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', locale: 'en-PK' },
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
  const country = form.watch('country') ?? 'PK';
  // the country fills in the currency, timezone and formats (still editable)
  const pickCountry = (code: string) => {
    const d = countryDefaults(code);
    form.setValue('currency', d.currency);
    form.setValue('timezone', d.timezone);
    form.setValue('locale', d.locale);
  };
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
          <Field label={t('platform.type', 'Kind of institution')} hint={t('platform.typeHint', 'Sets the starting years, terms and grading')}>
            {(a) => (
              <Select {...a} {...form.register('type')}>
                {INSTITUTION_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`institutionType.${x}`, TYPE_LABELS[x])}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('platform.adminName', 'Administrator name')} optional>
            {(a) => <Input {...a} {...form.register('adminName')} />}
          </Field>
          <Field label={t('platform.adminEmail', 'Administrator email')} error={e.adminEmail?.message}>
            {(a) => <Input {...a} type="email" dir="ltr" {...form.register('adminEmail')} />}
          </Field>
          <Field label={t('platform.country', 'Country')} hint={t('platform.countryHint', 'Online payments: {{gateways}}', { gateways: gatewaysText(country) })} error={e.country?.message}>
            {(a) => <CountrySelect {...a} {...form.register('country', { onChange: (ev) => pickCountry(ev.target.value) })} />}
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

type DetailsForm = z.input<typeof updateInstitutionBody>;

/** Correct what was entered when the institution was registered. Only changed fields are sent. */
function DetailsTab({ institution, onSaved }: { institution: InstitutionRow; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const form = useForm<DetailsForm>({
    resolver: zodResolver(updateInstitutionBody),
    defaultValues: {
      name: institution.name,
      slug: institution.slug,
      type: institution.type,
      contact_email: institution.contact_email ?? '',
      primary_color: institution.primary_color || '#2563EB',
      group_id: institution.group_id,
      plan: institution.plan as DetailsForm['plan'],
      country: institution.country,
      currency: institution.currency,
      timezone: institution.timezone,
      locale: institution.locale,
    },
  });
  const groups = useQuery({ queryKey: ['platform-groups'], queryFn: () => api.get<{ id: number; name: string }[]>('/platform/groups') });
  const save = useMutation({
    mutationFn: (v: DetailsForm) => {
      const dirty = form.formState.dirtyFields as Partial<Record<keyof DetailsForm, boolean>>;
      const changed = Object.fromEntries(Object.entries(v).filter(([k]) => dirty[k as keyof DetailsForm]));
      return api.patch(`/platform/institutions/${institution.id}`, changed);
    },
    onSuccess: () => {
      toast('success', t('platform.saved', 'Institution updated'));
      void qc.invalidateQueries({ queryKey: ['/platform/institutions'] });
      onSaved();
    },
  });
  const e = form.formState.errors;
  const country = form.watch('country') ?? 'PK';
  const pickCountry = (code: string) => {
    const d = countryDefaults(code);
    form.setValue('currency', d.currency, { shouldDirty: true });
    form.setValue('timezone', d.timezone, { shouldDirty: true });
    form.setValue('locale', d.locale, { shouldDirty: true });
  };
  return (
    <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <Field label={t('platform.institutionName', 'Institution name')} error={e.name?.message}>
        {(a) => <Input {...a} {...form.register('name')} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('platform.slug', 'Address name')} hint={t('platform.slugChange', 'Changing it changes the institution’s web address')} error={e.slug?.message}>
          {(a) => <Input {...a} dir="ltr" {...form.register('slug')} />}
        </Field>
        <Field label={t('platform.type', 'Kind of institution')}>
          {(a) => (
            <Select {...a} {...form.register('type')}>
              {INSTITUTION_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`institutionType.${x}`, TYPE_LABELS[x])}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('platform.contactEmail', 'Contact email')} optional error={e.contact_email?.message}>
          {(a) => <Input {...a} type="email" dir="ltr" {...form.register('contact_email')} />}
        </Field>
        <Field label={t('platform.color', 'Brand colour')} error={e.primary_color?.message}>
          {(a) => (
            <div className="flex gap-2">
              <input
                type="color"
                aria-label={t('platform.color', 'Brand colour')}
                className="h-10 w-12 rounded border border-border"
                value={form.watch('primary_color') ?? '#2563EB'}
                onChange={(ev) => form.setValue('primary_color', ev.target.value, { shouldDirty: true })}
              />
              <Input {...a} dir="ltr" {...form.register('primary_color')} />
            </div>
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
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
        <Field label={t('platform.group', 'Group')} hint={t('platform.groupHint', 'Create groups in Groups & team')}>
          {(a) =>
            // mounted once the groups are loaded, so the current group shows as selected
            groups.data ? (
              <Select {...a} {...form.register('group_id', { setValueAs: (v) => (v === '' || v === null ? null : Number(v)) })}>
                <option value="">{t('platform.noGroup', 'No group')}</option>
                {groups.data.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Select {...a} disabled>
                <option>{t('common.loading', 'Loading…')}</option>
              </Select>
            )
          }
        </Field>
      </div>
      <Field label={t('platform.country', 'Country')} hint={t('platform.countryHint', 'Online payments: {{gateways}}', { gateways: gatewaysText(country) })} error={e.country?.message}>
        {(a) => <CountrySelect {...a} {...form.register('country', { onChange: (ev) => pickCountry(ev.target.value) })} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('platform.currency', 'Currency')} hint={t('platform.currencyLocked', 'Locked once fee invoices exist')} error={e.currency?.message}>
          {(a) => <Input {...a} dir="ltr" maxLength={3} {...form.register('currency')} />}
        </Field>
        <Field label={t('platform.locale', 'Locale')} error={e.locale?.message}>
          {(a) => <Input {...a} dir="ltr" {...form.register('locale')} />}
        </Field>
        <Field label={t('platform.timezone', 'Timezone')} error={e.timezone?.message}>
          {(a) => <Input {...a} dir="ltr" list="tz-list-edit" {...form.register('timezone')} />}
        </Field>
      </div>
      <datalist id="tz-list-edit">
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
      {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
          {t('common.saveChanges', 'Save changes')}
        </Button>
      </div>
    </form>
  );
}

interface AdminRow {
  id: number;
  full_name: string;
  email: string;
  status: 'invited' | 'active';
  full_admin: boolean;
  is_active: boolean;
  last_login_at: string | null;
}

type AdminForm = z.input<typeof institutionAdminBody>;

/** Name and email of one administrator: add a new one, or correct an existing one. */
function AdminFormFields({ initial, emailLocked, submitLabel, busy, error, onSubmit, onCancel }: {
  initial: AdminForm;
  emailLocked?: boolean;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (v: AdminForm) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const form = useForm<AdminForm>({ resolver: zodResolver(institutionAdminBody), defaultValues: initial });
  const e = form.formState.errors;
  return (
    <form className="space-y-3" noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('platform.adminName', 'Administrator name')} error={e.name?.message}>
          {(a) => <Input {...a} {...form.register('name')} />}
        </Field>
        <Field
          label={t('platform.adminEmail', 'Administrator email')}
          hint={emailLocked ? t('platform.emailLocked', 'They have activated their account; only they can change it') : undefined}
          error={e.email?.message}
        >
          {(a) => <Input {...a} type="email" dir="ltr" readOnly={emailLocked} {...form.register('email')} />}
        </Field>
      </div>
      {error ? <Alert tone="danger">{errorMessage(error)}</Alert> : null}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
        )}
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function AdministratorsTab({ institution }: { institution: InstitutionRow }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const key = ['platform-admins', institution.id];
  const admins = useQuery({ queryKey: key, queryFn: () => api.get<AdminRow[]>(`/platform/institutions/${institution.id}/admins`) });
  const [editing, setEditing] = useState<number | null>(null);
  const [sent, setSent] = useState<Invite | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['/platform/institutions'] });
  };
  const update = useMutation({
    mutationFn: ({ id, v }: { id: number; v: AdminForm }) => api.patch<{ invite: Invite | null }>(`/platform/institutions/${institution.id}/admins/${id}`, v),
    onSuccess: (r) => {
      setEditing(null);
      if (r.invite) setSent(r.invite);
      else toast('success', t('platform.adminSaved', 'Administrator updated'));
      refresh();
    },
  });
  const resend = useMutation({
    mutationFn: (id: number) => api.post<{ invite: Invite }>(`/platform/institutions/${institution.id}/admins/${id}/invite`, {}),
    onSuccess: (r) => setSent(r.invite),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const add = useMutation({
    mutationFn: (v: AdminForm) => api.post<{ invite: Invite }>(`/platform/institutions/${institution.id}/admins`, v),
    onSuccess: (r) => {
      setSent(r.invite);
      refresh();
    },
  });
  if (sent) return <InviteNotice title={t('platform.inviteSent', 'Invitation sent to {{email}}', { email: sent.email })} invite={sent} onDone={() => setSent(null)} />;
  if (admins.isPending) return <Spinner />;
  if (admins.isError) return <ErrorState error={admins.error} onRetry={() => admins.refetch()} />;
  return (
    <div className="space-y-5">
      <ul className="divide-y divide-border rounded-lg border border-border">
        {admins.data.map((a) => (
          <li key={a.id} className="space-y-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">{a.full_name}</div>
                <div className="truncate text-sm text-fg-muted" dir="ltr">
                  {a.email}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted">
                  <StatusBadge value={a.status} />
                  {!a.full_admin && <span>{t('platform.limitedRole', 'Limited role')}</span>}
                  {a.last_login_at && <span>{t('platform.lastLogin', 'Last sign-in {{when}}', { when: formatDateTime(a.last_login_at) })}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                {a.status === 'invited' && (
                  <Button variant="ghost" size="sm" loading={resend.isPending && resend.variables === a.id} onClick={() => resend.mutate(a.id)}>
                    <MailPlus className="size-4" /> {t('platform.resend', 'Resend invitation')}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditing(editing === a.id ? null : a.id)}>
                  <Pencil className="size-4" /> {t('common.edit', 'Edit')}
                </Button>
              </div>
            </div>
            {editing === a.id && (
              <AdminFormFields
                initial={{ name: a.full_name, email: a.email }}
                emailLocked={a.status === 'active'}
                submitLabel={a.status === 'invited' ? t('platform.saveAndInvite', 'Save (a new invitation goes out if the email changed)') : t('common.save', 'Save')}
                busy={update.isPending}
                error={update.error}
                onSubmit={(v) => update.mutate({ id: a.id, v })}
                onCancel={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>
      <div>
        <h3 className="mb-2 font-semibold">{t('platform.addAdmin', 'Add an administrator')}</h3>
        <p className="mb-3 text-sm text-fg-muted">{t('platform.addAdminHelp', 'They get full administrator rights and an invitation by email — for example when the first administrator has left.')}</p>
        <AdminFormFields initial={{ name: '', email: '' }} submitLabel={t('platform.addAndInvite', 'Add and invite')} busy={add.isPending} error={add.error} onSubmit={(v) => add.mutate(v)} />
      </div>
    </div>
  );
}

function ManageInstitutionDialog({ institution, onClose }: { institution: InstitutionRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!institution} onClose={onClose} title={institution ? t('platform.manageTitle', 'Manage {{name}}', { name: institution.name }) : ''}>
      {institution && (
        <Tabs
          hash={false}
          tabs={[
            { id: 'details', label: t('platform.details', 'Details'), content: () => <DetailsTab institution={institution} onSaved={onClose} /> },
            { id: 'admins', label: t('platform.administrators', 'Administrators'), content: () => <AdministratorsTab institution={institution} /> },
          ]}
        />
      )}
    </Dialog>
  );
}

function PlatformInstitutions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState<InstitutionRow | null>(null);
  const [suspending, setSuspending] = useState<InstitutionRow | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatusFilter] = useState('');
  const q = useDebounced(search);
  const list = usePagedList<InstitutionRow>('/platform/institutions', { q: q || undefined, status: status || undefined });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'suspended' }) => api.patch(`/platform/institutions/${id}`, { status }),
    onSuccess: (_r, v) => {
      setSuspending(null);
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
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
            placeholder={t('platform.searchInstitutions', 'Name, address name or email')}
            className="ps-9"
            aria-label={t('common.search', 'Search')}
          />
        </div>
        <Select value={status} onChange={(ev) => setStatusFilter(ev.target.value)} aria-label={t('common.status', 'Status')} className="w-auto">
          <option value="">{t('platform.allStatuses', 'All statuses')}</option>
          <option value="active">{t('status.active', 'Active')}</option>
          <option value="suspended">{t('status.suspended', 'Suspended')}</option>
        </Select>
      </div>
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
              <button type="button" className="text-start" onClick={() => setManaging(s)}>
                <div className="font-medium hover:underline">{s.name}</div>
                <div className="text-xs text-fg-muted">
                  {t(`institutionType.${s.type}`, TYPE_LABELS[s.type] ?? s.type)} · {s.slug} · {s.contact_email}
                </div>
              </button>
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
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => setManaging(s)}>
                  <Settings2 className="size-4" /> {t('platform.manage', 'Manage')}
                </Button>
                {s.status === 'active' ? (
                  <Button variant="ghost" size="sm" onClick={() => setSuspending(s)}>
                    {t('platform.suspend', 'Suspend')}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" loading={setStatus.isPending && setStatus.variables?.id === s.id} onClick={() => setStatus.mutate({ id: s.id, status: 'active' })}>
                    {t('platform.reactivate', 'Reactivate')}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <RegisterInstitutionDialog open={open} onClose={() => setOpen(false)} />
      <ManageInstitutionDialog institution={managing} onClose={() => setManaging(null)} />
      <ConfirmDialog
        open={!!suspending}
        title={t('platform.suspendTitle', 'Suspend {{name}}?', { name: suspending?.name ?? '' })}
        confirmLabel={t('platform.suspend', 'Suspend')}
        busy={setStatus.isPending}
        error={setStatus.error}
        onConfirm={() => suspending && setStatus.mutate({ id: suspending.id, status: 'suspended' })}
        onClose={() => setSuspending(null)}
      >
        {t('platform.suspendBody', 'Nobody at this institution can sign in until you reactivate it. Their data is kept.')}
      </ConfirmDialog>
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
      <Route path="people" element={<RequireAuth permission="platform.institutions.read"><PlatformPeoplePage /></RequireAuth>} />
      <Route path="ai" element={<RequireAuth permission="platform.institutions.read"><ApiManagementPage /></RequireAuth>} />
      <Route path="ai/usage" element={<RequireAuth permission="platform.institutions.read"><AiUsagePage /></RequireAuth>} />
    </Routes>
  );
}

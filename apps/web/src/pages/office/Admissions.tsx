// The admissions office: application forms (with their public link), the applications
// pipeline and each application, merit lists with offers, one-click enrolment, and enquiries
// with follow-ups.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink, Phone, Plus, Trash2, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { useDebounced, usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, CopyButton, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, StatCard, Tabs, Textarea, useToast } from '@/components/ui';
import { DownloadButton, Info, useInvalidate, useSections, useStructure } from './common';

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  submitted: 'info',
  under_review: 'info',
  test_scheduled: 'warning',
  tested: 'warning',
  offered: 'success',
  accepted: 'success',
  enrolled: 'success',
  waitlisted: 'warning',
  declined: 'neutral',
  rejected: 'danger',
  withdrawn: 'neutral',
};
const AppStatus = ({ s }: { s: string }) => <Badge tone={STATUS_TONE[s] ?? 'neutral'}>{s.replace('_', ' ')}</Badge>;

export function AdmissionsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const summary = useQuery({ queryKey: ['/admissions/summary'], queryFn: () => api.get<{ applications: Record<string, number>; enquiries: Record<string, number>; follow_ups_due: number }>('/admissions/summary'), enabled: can('admissions.manage') });
  const s = summary.data;
  const sum = (o?: Record<string, number>) => Object.values(o ?? {}).reduce((n, x) => n + x, 0);
  return (
    <>
      <PageHeader title={t('nav.admissions', 'Admissions')} subtitle={t('adm.subtitle', 'Enquiries, applications, tests, offers and enrolment')} />
      {s && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t('adm.enquiries', 'Enquiries')} value={sum(s.enquiries)} sub={t('adm.followUpsDue', '{{n}} follow-ups due', { n: s.follow_ups_due })} icon={Phone} tone={s.follow_ups_due ? 'warning' : 'primary'} />
          <StatCard label={t('adm.applications', 'Applications')} value={sum(s.applications)} icon={UserPlus} />
          <StatCard label={t('adm.offered', 'Offers out')} value={(s.applications.offered ?? 0) + (s.applications.accepted ?? 0)} tone="success" />
          <StatCard label={t('adm.enrolled', 'Enrolled')} value={s.applications.enrolled ?? 0} tone="success" />
        </div>
      )}
      <Tabs
        tabs={[
          { id: 'applications', label: t('adm.applications', 'Applications'), content: () => <ApplicationsTab />, hidden: !can('admissions.manage') },
          { id: 'enquiries', label: t('adm.enquiries', 'Enquiries'), content: () => <EnquiriesTab />, hidden: !can('enquiries.manage') },
          { id: 'forms', label: t('adm.forms', 'Forms'), content: () => <FormsTab />, hidden: !can('admissions.manage') },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- forms

interface FormRow {
  id: number;
  slug: string;
  institution_slug: string;
  title: string;
  description: string;
  status: string;
  application_fee: string;
  applications: number;
  enrolled: number;
  fields: { key: string; label: string; type: string; options?: string[]; required: boolean }[];
  documents: { key: string; label: string; required: boolean }[];
  entrance_test: { bank_id: number; count: number; minutes: number } | null;
  program_id: number | null;
  program_level_id: number | null;
  closes_at: string | null;
  seats: number | null;
}

function FormsTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/admissions/forms'], queryFn: () => api.get<FormRow[]>('/admissions/forms') });
  const [edit, setEdit] = useState<FormRow | 'new' | null>(null);
  const [merit, setMerit] = useState<FormRow | null>(null);
  const publicUrl = (f: FormRow) => `${window.location.origin}/apply/${f.institution_slug}/${f.slug}`;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setEdit('new')}><Plus className="size-4" /> {t('adm.newForm', 'New application form')}</Button></div>
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Spinner /> : q.data.length === 0 ? <EmptyState title={t('adm.noForms', 'No forms yet')} description={t('adm.noFormsHelp', 'A form is the public page where families apply, with your own questions and documents.')} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.map((f) => (
            <Card key={f.id} className="space-y-2 p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{f.title}</h3>
                <Badge tone={f.status === 'open' ? 'success' : 'neutral'}>{f.status}</Badge>
              </div>
              <p className="text-sm text-fg-muted">{t('adm.formStats', '{{a}} applications · {{e}} enrolled', { a: f.applications, e: f.enrolled })}</p>
              {f.status !== 'draft' && (
                <div className="flex items-center gap-1 text-xs">
                  <a className="break-all text-primary hover:underline" href={publicUrl(f)} target="_blank" rel="noreferrer">{publicUrl(f)} <ExternalLink className="inline size-3" /></a>
                  <CopyButton text={publicUrl(f)} />
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setEdit(f)}>{t('common.edit', 'Edit')}</Button>
                <Button size="sm" variant="outline" onClick={() => setMerit(f)}>{t('adm.meritList', 'Merit list')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <FormEditor form={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {merit && <MeritDialog form={merit} onClose={() => setMerit(null)} />}
    </div>
  );
}

function FormEditor({ form, onClose }: { form: FormRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const structure = useStructure();
  const banks = useQuery({ queryKey: ['/question-banks'], queryFn: () => api.get<{ id: number; name: string; questions?: number }[]>('/question-banks').catch(() => []) });
  const [v, setV] = useState({
    title: form?.title ?? '',
    slug: form?.slug ?? '',
    description: form?.description ?? '',
    status: form?.status ?? 'draft',
    application_fee: form?.application_fee ?? '0',
    program_id: form?.program_id ? String(form.program_id) : '',
    program_level_id: form?.program_level_id ? String(form.program_level_id) : '',
    seats: form?.seats ? String(form.seats) : '',
    closes_at: form?.closes_at?.slice(0, 10) ?? '',
    fields: form?.fields ?? [],
    documents: form?.documents ?? [{ key: 'birth_certificate', label: 'Birth certificate / B-form', required: true }],
    test: form?.entrance_test ? { bank_id: String(form.entrance_test.bank_id), count: String(form.entrance_test.count), minutes: String(form.entrance_test.minutes) } : null as null | { bank_id: string; count: string; minutes: string },
  });
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        title: v.title,
        slug: v.slug || slugify(v.title),
        description: v.description,
        status: v.status,
        application_fee: Number(v.application_fee) || 0,
        program_id: v.program_id ? Number(v.program_id) : null,
        program_level_id: v.program_level_id ? Number(v.program_level_id) : null,
        seats: v.seats ? Number(v.seats) : null,
        closes_at: v.closes_at ? `${v.closes_at}T23:59:00Z` : null,
        fields: v.fields.map((f) => ({ ...f, key: f.key || slugify(f.label).replace(/-/g, '_').replace(/^[^a-z]+/, 'q_') })),
        documents: v.documents.map((d) => ({ ...d, key: d.key || slugify(d.label).replace(/-/g, '_').replace(/^[^a-z]+/, 'd_') })),
        entrance_test: v.test?.bank_id ? { bank_id: Number(v.test.bank_id), count: Number(v.test.count), minutes: Number(v.test.minutes) } : null,
      };
      return form ? api.patch(`/admissions/forms/${form.id}`, body) : api.post('/admissions/forms', body);
    },
    onSuccess: async () => { await invalidate('/admissions'); onClose(); },
  });
  const program = structure.data?.programs.find((p) => String(p.id) === v.program_id);
  return (
    <Dialog open onClose={onClose} title={form ? form.title : t('adm.newForm', 'New application form')} className="max-w-3xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('adm.formTitle', 'Title')}>{(a) => <Input {...a} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value, slug: form ? v.slug : slugify(e.target.value) })} />}</Field>
          <Field label={t('adm.address', 'Web address')} hint={`/apply/…/${v.slug || '…'}`}>{(a) => <Input {...a} value={v.slug} onChange={(e) => setV({ ...v, slug: slugify(e.target.value) })} />}</Field>
        </div>
        <Field label={t('adm.intro', 'Introduction shown on the form')} optional>{(a) => <Textarea {...a} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('common.status', 'Status')}>{(a) => <Select {...a} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}><option value="draft">{t('adm.draft', 'Draft')}</option><option value="open">{t('adm.open', 'Open')}</option><option value="closed">{t('adm.closed', 'Closed')}</option></Select>}</Field>
          <Field label={t('adm.fee', 'Application fee')}>{(a) => <Input {...a} type="number" value={v.application_fee} onChange={(e) => setV({ ...v, application_fee: e.target.value })} />}</Field>
          <Field label={t('adm.closes', 'Closes on')} optional>{(a) => <Input {...a} type="date" value={v.closes_at} onChange={(e) => setV({ ...v, closes_at: e.target.value })} />}</Field>
          <Field label={t('common.program', 'Program')} optional>{(a) => <Select {...a} value={v.program_id} onChange={(e) => setV({ ...v, program_id: e.target.value, program_level_id: '' })}><option value="">—</option>{structure.data?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
          <Field label={t('common.level', 'Level')} optional>{(a) => <Select {...a} value={v.program_level_id} disabled={!program} onChange={(e) => setV({ ...v, program_level_id: e.target.value })}><option value="">—</option>{program?.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}</Field>
          <Field label={t('adm.seats', 'Seats')} optional>{(a) => <Input {...a} type="number" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })} />}</Field>
        </div>
        <section>
          <h3 className="mb-1 text-sm font-semibold">{t('adm.questions', 'Extra questions')}</h3>
          <p className="mb-2 text-xs text-fg-muted">{t('adm.questionsHelp', "Name, date of birth, contact details and the guardian are always asked.")}</p>
          {v.fields.map((f, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_8rem_1fr_auto_auto] items-center gap-2">
              <Input aria-label={t('adm.question', 'Question')} value={f.label} onChange={(e) => setV({ ...v, fields: v.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Select aria-label={t('adm.answerType', 'Answer type')} value={f.type} onChange={(e) => setV({ ...v, fields: v.fields.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)) })}>
                <option value="text">{t('adm.text', 'Text')}</option><option value="textarea">{t('adm.longText', 'Long text')}</option><option value="number">{t('adm.number', 'Number')}</option><option value="date">{t('common.date', 'Date')}</option><option value="select">{t('adm.list', 'List')}</option>
              </Select>
              <Input aria-label={t('adm.options', 'Options')} disabled={f.type !== 'select'} placeholder={t('adm.optionsHint', 'Options, comma-separated')} value={f.options?.join(', ') ?? ''} onChange={(e) => setV({ ...v, fields: v.fields.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x)) })} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.required} onChange={(e) => setV({ ...v, fields: v.fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> {t('adm.required', 'Required')}</label>
              <Button size="icon" variant="ghost" aria-label={t('common.remove', 'Remove')} onClick={() => setV({ ...v, fields: v.fields.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setV({ ...v, fields: [...v.fields, { key: '', label: '', type: 'text', required: false }] })}><Plus className="size-4" /> {t('adm.addQuestion', 'Add a question')}</Button>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('adm.documents', 'Documents to upload')}</h3>
          {v.documents.map((d, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <Input aria-label={t('adm.document', 'Document')} value={d.label} onChange={(e) => setV({ ...v, documents: v.documents.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={d.required} onChange={(e) => setV({ ...v, documents: v.documents.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> {t('adm.required', 'Required')}</label>
              <Button size="icon" variant="ghost" aria-label={t('common.remove', 'Remove')} onClick={() => setV({ ...v, documents: v.documents.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setV({ ...v, documents: [...v.documents, { key: '', label: '', required: false }] })}><Plus className="size-4" /> {t('adm.addDocument', 'Add a document')}</Button>
        </section>
        <section className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={!!v.test} onChange={(e) => setV({ ...v, test: e.target.checked ? { bank_id: '', count: '20', minutes: '30' } : null })} /> {t('adm.onlineTest', 'Online entrance test')}</label>
          {v.test && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('adm.bank', 'Question bank')}>{(a) => <Select {...a} value={v.test!.bank_id} onChange={(e) => setV({ ...v, test: { ...v.test!, bank_id: e.target.value } })}><option value="">{t('common.choose', 'Choose…')}</option>{banks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
              <Field label={t('adm.questionsN', 'Questions')}>{(a) => <Input {...a} type="number" value={v.test!.count} onChange={(e) => setV({ ...v, test: { ...v.test!, count: e.target.value } })} />}</Field>
              <Field label={t('adm.minutes', 'Minutes')}>{(a) => <Input {...a} type="number" value={v.test!.minutes} onChange={(e) => setV({ ...v, test: { ...v.test!, minutes: e.target.value } })} />}</Field>
            </div>
          )}
        </section>
        <MutationError error={m.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button loading={m.isPending} disabled={!v.title} onClick={() => m.mutate()}>{t('common.save', 'Save')}</Button></div>
      </div>
    </Dialog>
  );
}

function MeritDialog({ form, onClose }: { form: FormRow; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [v, setV] = useState({ test_weight: '0.7', interview_weight: '0.3', offer: String(form.seats ?? 0), waitlist: '0', offer_expires_at: '' });
  const body = (commit: boolean) => ({ test_weight: Number(v.test_weight), interview_weight: Number(v.interview_weight), offer: Number(v.offer), waitlist: Number(v.waitlist), offer_expires_at: v.offer_expires_at ? `${v.offer_expires_at}T23:59:00Z` : null, commit });
  const list = useQuery({ queryKey: ['merit', form.id, v], queryFn: () => api.post<{ rank: number; id: number; number: string; name: string; test_percent: number | null; interview: number | null; score: number; outcome: string | null }[]>(`/admissions/forms/${form.id}/merit`, body(false)) });
  const commit = useMutation({ mutationFn: () => api.post(`/admissions/forms/${form.id}/merit`, body(true)), onSuccess: async () => { await invalidate('/admissions'); toast('success', t('adm.offersSent', 'Offers sent')); onClose(); } });
  return (
    <Dialog open onClose={onClose} title={t('adm.meritFor', 'Merit list: {{form}}', { form: form.title })} className="max-w-3xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label={t('adm.testWeight', 'Test weight')}>{(a) => <Input {...a} type="number" step="0.1" value={v.test_weight} onChange={(e) => setV({ ...v, test_weight: e.target.value })} />}</Field>
          <Field label={t('adm.interviewWeight', 'Interview weight')}>{(a) => <Input {...a} type="number" step="0.1" value={v.interview_weight} onChange={(e) => setV({ ...v, interview_weight: e.target.value })} />}</Field>
          <Field label={t('adm.offerTop', 'Offer places')}>{(a) => <Input {...a} type="number" value={v.offer} onChange={(e) => setV({ ...v, offer: e.target.value })} />}</Field>
          <Field label={t('adm.waitlistN', 'Waiting list')}>{(a) => <Input {...a} type="number" value={v.waitlist} onChange={(e) => setV({ ...v, waitlist: e.target.value })} />}</Field>
          <Field label={t('adm.replyBy', 'Reply by')} optional>{(a) => <Input {...a} type="date" value={v.offer_expires_at} onChange={(e) => setV({ ...v, offer_expires_at: e.target.value })} />}</Field>
        </div>
        <DataTable
          rows={list.data}
          loading={list.isPending}
          error={list.error}
          rowKey={(r) => r.id}
          empty={t('adm.noRanked', 'No applicants to rank (reviewed or tested ones are ranked)')}
          columns={[
            { key: 'rank', header: '#', cell: (r) => r.rank },
            { key: 'name', header: t('common.name', 'Name'), cell: (r) => `${r.name} (${r.number})` },
            { key: 'test', header: t('adm.test', 'Test %'), cell: (r) => r.test_percent ?? '—' },
            { key: 'int', header: t('adm.interview', 'Interview'), cell: (r) => r.interview ?? '—', hideOnMobile: true },
            { key: 'score', header: t('adm.score', 'Score'), cell: (r) => r.score },
            { key: 'out', header: '', cell: (r) => r.outcome && <AppStatus s={r.outcome} /> },
          ]}
        />
        <MutationError error={commit.error} />
        <div className="flex justify-end"><Button loading={commit.isPending} disabled={!list.data?.some((r) => r.outcome)} onClick={() => commit.mutate()}>{t('adm.sendOffers', 'Send offers and waiting-list emails')}</Button></div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- applications

interface AppRow { id: number; number: string; first_name: string; last_name: string; email: string; phone: string; status: string; test_score: string | null; test_max: string | null; interview_score: string | null; merit_rank: number | null; fee_status: string | null; documents: number; form: string; created_at: string }

function ApplicationsTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 300);
  const list = usePagedList<AppRow>('/admissions/applications', { status: status || undefined, q: q || undefined });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.search', 'Search')} className="min-w-52 flex-1">{(a) => <Input {...a} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('adm.searchHint', 'Number, name, email or phone')} />}</Field>
        <Field label={t('common.status', 'Status')}>
          {(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('common.all', 'All')}</option>{Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>}
        </Field>
        <DownloadButton path={`/admissions/applications?format=xlsx${status ? `&status=${status}` : ''}`} filename="applications.xlsx">Excel</DownloadButton>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('adm.noApplications', 'No applications yet')}
        columns={[
          { key: 'n', header: t('adm.number', 'Number'), cell: (r) => <Link to={`/admissions/applications/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link> },
          { key: 'name', header: t('common.name', 'Name'), cell: (r) => `${r.first_name} ${r.last_name}` },
          { key: 'form', header: t('adm.form', 'Form'), cell: (r) => r.form, hideOnMobile: true },
          { key: 'test', header: t('adm.test', 'Test'), cell: (r) => (r.test_score == null ? '—' : `${Number(r.test_score)}/${Number(r.test_max)}`), hideOnMobile: true },
          { key: 'fee', header: t('adm.fee', 'Fee'), cell: (r) => (r.fee_status ? <Badge tone={r.fee_status === 'paid' ? 'success' : 'warning'}>{r.fee_status}</Badge> : '—'), hideOnMobile: true },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <AppStatus s={r.status} /> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </div>
  );
}

interface AppDetail extends AppRow {
  dob: string | null;
  gender: string | null;
  guardian_name: string;
  guardian_phone: string;
  guardian_email: string;
  guardian_relationship: string;
  previous_school: string;
  data: Record<string, unknown>;
  test_at: string | null;
  test_venue: string;
  offer_expires_at: string | null;
  decision_note: string;
  student_id: number | null;
  form: { title: string; fields: { key: string; label: string }[]; documents: { key: string; label: string }[]; entrance_test: unknown } & never;
  documents: { id: number; key: string; original_name: string }[] & never;
  invoices: { id: number; number: string; total: string; paid: string; status: string }[];
}

const NEXT: Record<string, string[]> = {
  submitted: ['under_review', 'test_scheduled', 'offered', 'waitlisted', 'rejected'],
  under_review: ['test_scheduled', 'tested', 'offered', 'waitlisted', 'rejected'],
  test_scheduled: ['tested', 'rejected'],
  tested: ['offered', 'waitlisted', 'rejected'],
  waitlisted: ['offered', 'rejected'],
  offered: ['accepted', 'declined', 'waitlisted'],
  declined: ['offered'],
  rejected: ['under_review'],
  withdrawn: ['under_review'],
};

export function ApplicationPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const toast = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: [`/admissions/applications/${id}`], queryFn: () => api.get<Omit<AppDetail, 'form' | 'documents'> & { form: { title: string; fields: { key: string; label: string }[]; documents: { key: string; label: string }[]; entrance_test: unknown }; documents: { id: number; key: string; original_name: string }[] }>(`/admissions/applications/${id}`) });
  const [move, setMove] = useState<string | null>(null);
  const [enrol, setEnrol] = useState(false);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner className="h-full" />;
  const a = q.data;
  return (
    <>
      <Link to="/admissions#applications" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> {t('adm.applications', 'Applications')}</Link>
      <PageHeader
        title={`${a.first_name} ${a.last_name}`}
        subtitle={<span>{a.number} · {a.form.title} · <AppStatus s={a.status} /></span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {(NEXT[a.status] ?? []).map((s) => <Button key={s} size="sm" variant={s === 'rejected' ? 'ghost' : 'outline'} onClick={() => setMove(s)}>{s.replace('_', ' ')}</Button>)}
            {['accepted', 'offered'].includes(a.status) && !a.student_id && <Button size="sm" onClick={() => setEnrol(true)}><UserPlus className="size-4" /> {t('adm.enrol', 'Enrol')}</Button>}
            {a.student_id && <Link to={`/admin/students/${a.student_id}`}><Button size="sm" variant="outline">{t('adm.studentProfile', 'Student profile')}</Button></Link>}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:col-span-2">
          <Info label={t('common.email', 'Email')}>{a.email}</Info>
          <Info label={t('common.phone', 'Phone')}>{a.phone || '—'}</Info>
          <Info label={t('adm.dob', 'Date of birth')}>{a.dob ? formatDate(a.dob) : '—'}</Info>
          <Info label={t('adm.previousSchool', 'Previous school')}>{a.previous_school || '—'}</Info>
          <Info label={t('common.guardian', 'Guardian')}>{a.guardian_name || '—'} {a.guardian_relationship && `(${a.guardian_relationship})`}</Info>
          <Info label={t('adm.guardianContact', 'Guardian contact')}>{[a.guardian_phone, a.guardian_email].filter(Boolean).join(' · ') || '—'}</Info>
          {a.form.fields.map((f) => <Info key={f.key} label={f.label}>{String(a.data[f.key] ?? '—')}</Info>)}
        </Card>
        <div className="space-y-4">
          <Card className="space-y-2 p-5">
            <h3 className="font-semibold">{t('adm.test', 'Entrance test')}</h3>
            <p className="text-sm">{a.test_score != null ? `${Number(a.test_score)} / ${Number(a.test_max)}` : a.test_at ? `${formatDateTime(a.test_at)} ${a.test_venue}` : t('adm.notScheduled', 'Not scheduled')}</p>
            {a.interview_score != null && <p className="text-sm">{t('adm.interview', 'Interview')}: {Number(a.interview_score)}</p>}
            {a.merit_rank && <p className="text-sm">{t('adm.rank', 'Merit rank')}: {a.merit_rank}</p>}
          </Card>
          <Card className="space-y-2 p-5">
            <h3 className="font-semibold">{t('adm.documents', 'Documents')}</h3>
            {a.form.documents.map((d) => {
              const up = a.documents.find((x) => x.key === d.key);
              return <div key={d.key} className="flex items-center justify-between text-sm"><span>{d.label}</span>{up ? <DownloadButton variant="ghost" path={`/admissions/applications/${a.id}/documents/${up.id}`} filename={up.original_name}>{t('common.open', 'Open')}</DownloadButton> : <Badge tone="warning">{t('adm.missing', 'missing')}</Badge>}</div>;
            })}
          </Card>
          <Card className="space-y-2 p-5">
            <h3 className="font-semibold">{t('adm.fee', 'Application fee')}</h3>
            {a.invoices.length === 0 ? <p className="text-sm text-fg-muted">{t('adm.noFee', 'No fee')}</p> : a.invoices.map((i) => <Link key={i.id} to={`/finance/invoices/${i.id}`} className="flex justify-between text-sm text-primary hover:underline"><span>{i.number}</span><Badge tone={i.status === 'paid' ? 'success' : 'warning'}>{i.status}</Badge></Link>)}
          </Card>
        </div>
      </div>
      {move && <MoveDialog app={a} to={move} onClose={() => setMove(null)} onDone={async () => { setMove(null); await invalidate('/admissions'); toast('success', t('adm.updated', 'Updated — the applicant was emailed')); }} />}
      {enrol && <EnrolDialog appId={a.id} onClose={() => setEnrol(false)} onDone={async () => { setEnrol(false); await invalidate('/admissions'); toast('success', t('adm.enrolledMsg', 'Enrolled. Invitations sent to the student and parent.')); }} />}
    </>
  );
}

function MoveDialog({ app, to, onClose, onDone }: { app: { id: number; test_score: string | null; test_max: string | null }; to: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ test_at: '', test_venue: '', test_score: app.test_score ?? '', test_max: app.test_max ?? '', interview_score: '', offer_expires_at: '', decision_note: '' });
  const m = useMutation({
    mutationFn: () =>
      api.patch(`/admissions/applications/${app.id}`, {
        status: to,
        ...(to === 'test_scheduled' ? { test_at: v.test_at ? new Date(v.test_at).toISOString() : null, test_venue: v.test_venue } : {}),
        ...(to === 'tested' ? { test_score: v.test_score === '' ? null : Number(v.test_score), test_max: v.test_max === '' ? null : Number(v.test_max), interview_score: v.interview_score === '' ? null : Number(v.interview_score) } : {}),
        ...(to === 'offered' ? { offer_expires_at: v.offer_expires_at ? `${v.offer_expires_at}T23:59:00Z` : null } : {}),
        decision_note: v.decision_note,
      }),
    onSuccess: onDone,
  });
  return (
    <Dialog open onClose={onClose} title={to.replace('_', ' ')}>
      <div className="space-y-3">
        {to === 'test_scheduled' && (
          <>
            <Alert>{t('adm.onlineTestNote', 'With an online test on the form, leave the time empty: the applicant can start it from their page.')}</Alert>
            <Field label={t('adm.testAt', 'Date and time')} optional>{(a) => <Input {...a} type="datetime-local" value={v.test_at} onChange={(e) => setV({ ...v, test_at: e.target.value })} />}</Field>
            <Field label={t('adm.venue', 'Venue')} optional>{(a) => <Input {...a} value={v.test_venue} onChange={(e) => setV({ ...v, test_venue: e.target.value })} />}</Field>
          </>
        )}
        {to === 'tested' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('adm.score', 'Score')}>{(a) => <Input {...a} type="number" value={v.test_score} onChange={(e) => setV({ ...v, test_score: e.target.value })} />}</Field>
            <Field label={t('adm.outOf', 'Out of')}>{(a) => <Input {...a} type="number" value={v.test_max} onChange={(e) => setV({ ...v, test_max: e.target.value })} />}</Field>
            <Field label={t('adm.interview', 'Interview (0–100)')} optional>{(a) => <Input {...a} type="number" value={v.interview_score} onChange={(e) => setV({ ...v, interview_score: e.target.value })} />}</Field>
          </div>
        )}
        {to === 'offered' && <Field label={t('adm.replyBy', 'Reply by')} optional>{(a) => <Input {...a} type="date" value={v.offer_expires_at} onChange={(e) => setV({ ...v, offer_expires_at: e.target.value })} />}</Field>}
        <Field label={t('adm.note', 'Note to the applicant')} optional>{(a) => <Textarea {...a} value={v.decision_note} onChange={(e) => setV({ ...v, decision_note: e.target.value })} />}</Field>
        <MutationError error={m.error} />
        <div className="flex justify-end"><Button loading={m.isPending} onClick={() => m.mutate()}>{t('common.confirm', 'Confirm')}</Button></div>
      </div>
    </Dialog>
  );
}

function EnrolDialog({ appId, onClose, onDone }: { appId: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const sections = useSections();
  const [section, setSection] = useState('');
  const [roll, setRoll] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/admissions/applications/${appId}/convert`, { section_id: Number(section), roll_no: roll || null }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} title={t('adm.enrol', 'Enrol')} description={t('adm.enrolHelp', 'Creates the student, links (or adds) the guardian, and emails portal invitations.')}>
      <div className="space-y-3">
        <Field label={t('common.class', 'Class')}>{(a) => <Select {...a} value={section} onChange={(e) => setSection(e.target.value)}><option value="">{t('common.choose', 'Choose…')}</option>{sections.data?.map((s) => <option key={s.id} value={s.id}>{s.name} {s.label} {s.campus_name && `· ${s.campus_name}`}</option>)}</Select>}</Field>
        <Field label={t('adm.rollNo', 'Roll number')} optional>{(a) => <Input {...a} value={roll} onChange={(e) => setRoll(e.target.value)} />}</Field>
        <MutationError error={m.error} />
        <div className="flex justify-end"><Button disabled={!section} loading={m.isPending} onClick={() => m.mutate()}>{t('adm.enrol', 'Enrol')}</Button></div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- enquiries

interface Enquiry { id: number; name: string; phone: string; email: string; student_name: string; source: string; status: string; next_follow_up_at: string | null; notes: string; followups: number; assigned_name: string | null; created_at: string }
const ENQ_TONE: Record<string, 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = { new: 'info', contacted: 'warning', visited: 'warning', applied: 'success', enrolled: 'success', lost: 'neutral' };

function EnquiriesTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('');
  const [due, setDue] = useState(false);
  const list = usePagedList<Enquiry>('/admissions/enquiries', { status: status || undefined, due: due ? 'true' : undefined });
  const [open, setOpen] = useState<Enquiry | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.status', 'Status')}>{(a) => <Select {...a} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('common.all', 'All')}</option>{Object.keys(ENQ_TONE).map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={due} onChange={(e) => setDue(e.target.checked)} /> {t('adm.dueOnly', 'Follow-ups due')}</label>
        <Button className="ms-auto" onClick={() => setOpen('new')}><Plus className="size-4" /> {t('adm.newEnquiry', 'New enquiry')}</Button>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('adm.noEnquiries', 'No enquiries')}
        columns={[
          { key: 'name', header: t('common.name', 'Name'), cell: (e) => <button className="text-start font-medium text-primary hover:underline" onClick={() => setOpen(e)}>{e.name}{e.student_name && <span className="text-fg-muted"> · {e.student_name}</span>}</button> },
          { key: 'contact', header: t('adm.contact', 'Contact'), cell: (e) => e.phone || e.email, hideOnMobile: true },
          { key: 'source', header: t('adm.source', 'Source'), cell: (e) => e.source.replace('_', ' '), hideOnMobile: true },
          { key: 'next', header: t('adm.nextFollowUp', 'Next follow-up'), cell: (e) => (e.next_follow_up_at ? <span className={new Date(e.next_follow_up_at) < new Date() ? 'text-danger' : ''}>{formatDateTime(e.next_follow_up_at)}</span> : '—') },
          { key: 's', header: t('common.status', 'Status'), cell: (e) => <Badge tone={ENQ_TONE[e.status]}>{e.status}</Badge> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {open && <EnquiryDialog enquiry={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function EnquiryDialog({ enquiry, onClose }: { enquiry: Enquiry | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const detail = useQuery({ queryKey: [`/admissions/enquiries/${enquiry?.id}`], queryFn: () => api.get<Enquiry & { followups: { id: number; channel: string; note: string; created_at: string; by: string | null }[] } & { followups: never }>(`/admissions/enquiries/${enquiry!.id}`), enabled: !!enquiry });
  const [v, setV] = useState({ name: enquiry?.name ?? '', phone: enquiry?.phone ?? '', email: enquiry?.email ?? '', student_name: enquiry?.student_name ?? '', source: enquiry?.source ?? 'walk_in', status: enquiry?.status ?? 'new', notes: enquiry?.notes ?? '' });
  const [fu, setFu] = useState({ channel: 'phone', note: '', next_at: '' });
  const save = useMutation({ mutationFn: () => (enquiry ? api.patch(`/admissions/enquiries/${enquiry.id}`, v) : api.post('/admissions/enquiries', v)), onSuccess: async () => { await invalidate('/admissions'); if (!enquiry) onClose(); } });
  const addFu = useMutation({ mutationFn: () => api.post(`/admissions/enquiries/${enquiry!.id}/followups`, { ...fu, next_at: fu.next_at ? new Date(fu.next_at).toISOString() : null }), onSuccess: async () => { setFu({ channel: 'phone', note: '', next_at: '' }); await invalidate('/admissions'); } });
  const followups = (detail.data as unknown as { followups?: { id: number; channel: string; note: string; created_at: string; by: string | null }[] })?.followups ?? [];
  return (
    <Dialog open onClose={onClose} title={enquiry ? enquiry.name : t('adm.newEnquiry', 'New enquiry')} className="max-w-2xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('adm.enquirer', 'Name (parent / caller)')}>{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label={t('adm.childName', "Child's name")} optional>{(a) => <Input {...a} value={v.student_name} onChange={(e) => setV({ ...v, student_name: e.target.value })} />}</Field>
          <Field label={t('common.phone', 'Phone')}>{(a) => <Input {...a} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
          <Field label={t('common.email', 'Email')} optional>{(a) => <Input {...a} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
          <Field label={t('adm.source', 'Source')}>{(a) => <Select {...a} value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}>{['walk_in', 'phone', 'website', 'social', 'referral', 'event', 'other'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>}</Field>
          <Field label={t('common.status', 'Status')}>{(a) => <Select {...a} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{Object.keys(ENQ_TONE).map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
        </div>
        <Field label={t('adm.notes', 'Notes')} optional>{(a) => <Textarea {...a} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />}</Field>
        <MutationError error={save.error} />
        <div className="flex justify-end"><Button loading={save.isPending} disabled={!v.name} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button></div>
        {enquiry && (
          <section className="space-y-3 border-t border-border pt-4">
            <h3 className="font-semibold">{t('adm.followUps', 'Follow-ups')}</h3>
            <div className="grid gap-2 sm:grid-cols-[8rem_1fr_12rem]">
              <Select aria-label={t('adm.channel', 'Channel')} value={fu.channel} onChange={(e) => setFu({ ...fu, channel: e.target.value })}>{['phone', 'whatsapp', 'sms', 'email', 'visit', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
              <Input aria-label={t('adm.what', 'What happened')} placeholder={t('adm.what', 'What happened')} value={fu.note} onChange={(e) => setFu({ ...fu, note: e.target.value })} />
              <Input aria-label={t('adm.nextFollowUp', 'Next follow-up')} type="datetime-local" value={fu.next_at} onChange={(e) => setFu({ ...fu, next_at: e.target.value })} />
            </div>
            <MutationError error={addFu.error} />
            <Button size="sm" disabled={!fu.note} loading={addFu.isPending} onClick={() => addFu.mutate()}>{t('adm.logFollowUp', 'Log follow-up')}</Button>
            <ul className="space-y-1 text-sm">{followups.map((f) => <li key={f.id}><span className="text-fg-muted">{formatDateTime(f.created_at)} · {f.channel} · {f.by}</span> — {f.note}</li>)}</ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}

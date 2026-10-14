// One student's record: details and custom fields, guardians (and what each may see),
// medical notes (restricted), documents, courses, certificates / ID card, and history.
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Camera, FileDown, FileText, IdCard, MailPlus, Pencil, Plus, Trash2, Unlink, Upload } from 'lucide-react';
import { DOCUMENT_CATEGORIES, GUARDIAN_RELATIONSHIPS } from '@acadex/shared';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useTerms } from '@/lib/terms';
import { Avatar } from '@/components/FileImage';
import { CustomFieldInputs, CustomFieldValues, useCustomFields, type CustomValues } from '@/components/CustomFields';
import { InviteNotice, type Invite } from '@/components/InviteNotice';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, ErrorState, Field, Input, MutationError, PageHeader, Select, Skeleton, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { sectionName, useSectionOptions } from './structure-data';

interface Guardian {
  guardianship_id: number;
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  occupation: string;
  relationship: string;
  is_primary: boolean;
  can_view_grades: boolean;
  can_view_fees: boolean;
  can_message: boolean;
  is_emergency_contact: boolean;
  has_account: boolean;
  invite_pending: boolean;
}
interface StudentProfile {
  id: number;
  roll_no: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  gender: string | null;
  dob: string | null;
  city: string;
  address: string;
  national_id: string;
  nationality: string;
  religion: string;
  admission_date: string | null;
  status: 'active' | 'inactive' | 'graduated' | 'left';
  left_on: string | null;
  section_id: number | null;
  photo_file_id: number | null;
  custom_data: CustomValues;
  section: { id: number; name: string; label: string; code: string; campus_name: string | null; level_name: string | null; program_name: string | null; academic_year: string | null } | null;
  guardians: Guardian[];
  enrollments: { id: number; status: string; waitlist_position: number | null; offering_id: number; code: string; name: string; credit_hours: string | null; term_name: string | null }[];
  documents: { id: number; title: string; category: string; created_at: string; file_id: number; original_name: string; content_type: string; size_bytes: number }[];
  promotions: { action: string; created_at: string; from_name: string | null; from_label: string | null; from_year: string | null; to_name: string | null; to_label: string | null; to_year: string | null }[];
  account: { id: number; is_active: boolean; invite_pending: boolean; last_login_at: string | null } | null;
  medical?: Record<string, string>;
  id_cards: { id: number; verify_code: string; valid_until: string; issued_at: string; revoked_at: string | null }[];
  issued_documents: { id: number; kind: string; serial_no: string; title: string; issued_at: string; revoked_at: string | null }[];
}

const useStudent = (id: string | undefined) => useQuery({ queryKey: ['student', id], queryFn: () => api.get<StudentProfile>(`/institution/students/${id}`) });
const fieldErrors = (e: unknown): Record<string, string> =>
  e instanceof ApiError && Array.isArray(e.details) ? Object.fromEntries((e.details as { path: string; message: string }[]).map((d) => [d.path, d.message])) : {};

// ---------------------------------------------------------------- details

function EditDetails({ s, open, onClose }: { s: StudentProfile; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const qc = useQueryClient();
  const defs = useCustomFields('student');
  const sections = useSectionOptions({}, open);
  const [v, setV] = useState({
    first_name: s.first_name, last_name: s.last_name, email: s.email, roll_no: s.roll_no ?? '', phone: s.phone ?? '', gender: s.gender ?? '', dob: s.dob ?? '',
    city: s.city, address: s.address, national_id: s.national_id, nationality: s.nationality, religion: s.religion, admission_date: s.admission_date ?? '', section_id: s.section_id ? String(s.section_id) : '', status: s.status,
  });
  const [custom, setCustom] = useState<CustomValues>(s.custom_data ?? {});
  const m = useMutation({
    mutationFn: () => api.patch(`/institution/students/${s.id}`, { ...v, section_id: v.section_id || null, dob: v.dob || null, admission_date: v.admission_date || null, custom_data: custom }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['student', String(s.id)] });
      void qc.invalidateQueries({ queryKey: ['/institution/students'] });
      onClose();
    },
  });
  const errs = fieldErrors(m.error);
  const text = (k: keyof typeof v, label: string, opts: { type?: string; optional?: boolean; dir?: 'ltr' } = {}) => (
    <Field label={label} optional={opts.optional} error={errs[k]}>
      {(a) => <Input {...a} type={opts.type} dir={opts.dir} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
    </Field>
  );
  return (
    <Dialog open={open} onClose={onClose} title={t('profile.editDetails', 'Edit details')} className="max-w-2xl">
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {text('first_name', t('people.firstName', 'First name'))}
          {text('last_name', t('people.lastName', 'Last name'))}
          {text('email', t('common.email', 'Email'), { type: 'email', dir: 'ltr' })}
          {text('roll_no', t('people.rollNo', 'Roll number'), { optional: true, dir: 'ltr' })}
          <Field label={term('section')} optional>
            {(a) => (
              <Select {...a} value={v.section_id} onChange={(e) => setV({ ...v, section_id: e.target.value })}>
                <option value="">—</option>
                {sections.data?.map((x) => (
                  <option key={x.id} value={x.id}>
                    {sectionName(x)} ({x.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('common.status', 'Status')}>
            {(a) => (
              <Select {...a} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as StudentProfile['status'] })}>
                {(['active', 'inactive', 'graduated', 'left'] as const).map((x) => (
                  <option key={x} value={x}>
                    {t(`studentStatus.${x}`, x)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('common.gender', 'Gender')} optional>
            {(a) => (
              <Select {...a} value={v.gender} onChange={(e) => setV({ ...v, gender: e.target.value })}>
                <option value="">—</option>
                <option value="Male">{t('common.male', 'Male')}</option>
                <option value="Female">{t('common.female', 'Female')}</option>
              </Select>
            )}
          </Field>
          {text('dob', t('people.dob', 'Date of birth'), { type: 'date', optional: true })}
          {text('phone', t('common.phone', 'Phone'), { optional: true, dir: 'ltr' })}
          {text('national_id', t('people.nationalId', 'National ID / B-form'), { optional: true, dir: 'ltr' })}
          {text('admission_date', t('people.admissionDate', 'Admission date'), { type: 'date', optional: true })}
          {text('nationality', t('people.nationality', 'Nationality'), { optional: true })}
          {text('religion', t('people.religion', 'Religion'), { optional: true })}
          {text('city', t('people.city', 'City'), { optional: true })}
        </div>
        {text('address', t('common.address', 'Address'), { optional: true })}
        <CustomFieldInputs defs={defs.data ?? []} values={custom} onChange={setCustom} errors={errs} />
        {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" loading={m.isPending}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Details({ s }: { s: StudentProfile }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const defs = useCustomFields('student');
  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
  return (
    <Card className="p-5">
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {item(t('common.email', 'Email'), <span dir="ltr">{s.email}</span>)}
        {item(t('common.phone', 'Phone'), s.phone && <span dir="ltr">{s.phone}</span>)}
        {item(term('section'), s.section && <Link className="text-primary hover:underline" to={`/admin/sections/${s.section.id}`}>{sectionName(s.section)}</Link>)}
        {item(term('program'), s.section?.program_name && `${s.section.program_name} · ${s.section.level_name}`)}
        {item(term('campus'), s.section?.campus_name)}
        {item(term('academicYear'), s.section?.academic_year)}
        {item(t('common.gender', 'Gender'), s.gender)}
        {item(t('people.dob', 'Date of birth'), s.dob && formatDate(s.dob))}
        {item(t('people.admissionDate', 'Admission date'), s.admission_date && formatDate(s.admission_date))}
        {item(t('people.nationalId', 'National ID / B-form'), s.national_id)}
        {item(t('people.nationality', 'Nationality'), s.nationality)}
        {item(t('people.religion', 'Religion'), s.religion)}
        {item(t('common.address', 'Address'), [s.address, s.city].filter(Boolean).join(', '))}
        {s.left_on && item(t('people.leftOn', 'Left on'), formatDate(s.left_on))}
        {item(
          t('profile.account', 'Sign-in'),
          s.account ? (s.account.invite_pending ? t('invite.pending', 'Invitation pending') : s.account.is_active ? (s.account.last_login_at ? t('profile.lastSeen', 'Last signed in {{date}}', { date: formatDate(s.account.last_login_at) }) : t('profile.neverSignedIn', 'Never signed in')) : t('profile.disabled', 'Disabled')) : t('profile.noAccount', 'No account')
        )}
        <CustomFieldValues defs={defs.data ?? []} values={s.custom_data ?? {}} />
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------- guardians

function AddGuardian({ studentId, open, onClose }: { studentId: number; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [g, setG] = useState({ first_name: '', last_name: '', phone: '', email: '', occupation: '' });
  const [search, setSearch] = useState('');
  const [existing, setExisting] = useState<number | null>(null);
  const [relationship, setRelationship] = useState('father');
  const found = useQuery({
    queryKey: ['guardian-search', search],
    queryFn: () => api.get<{ id: number; first_name: string; last_name: string; phone: string; children: { name: string }[] }[]>('/institution/guardians', { search, pageSize: 10 }),
    enabled: open && mode === 'existing' && search.length > 1,
  });
  const m = useMutation({
    mutationFn: () =>
      api.post(`/institution/students/${studentId}/guardians`, mode === 'existing' ? { guardian_id: existing, relationship } : { guardian: g, relationship }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['student', String(studentId)] });
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title={t('guardians.add', 'Add a guardian')}>
      <div className="space-y-4">
        <div className="flex gap-2" role="radiogroup">
          <Button variant={mode === 'new' ? 'primary' : 'outline'} size="sm" onClick={() => setMode('new')} aria-pressed={mode === 'new'}>
            {t('guardians.new', 'New person')}
          </Button>
          <Button variant={mode === 'existing' ? 'primary' : 'outline'} size="sm" onClick={() => setMode('existing')} aria-pressed={mode === 'existing'}>
            {t('guardians.existing', 'Already a guardian (sibling)')}
          </Button>
        </div>
        {mode === 'new' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {(['first_name', 'last_name', 'phone', 'email', 'occupation'] as const).map((k) => (
              <Field key={k} label={t(`guardians.${k}`, k.replace('_', ' '))} optional={k !== 'first_name'}>
                {(a) => <Input {...a} dir={k === 'phone' || k === 'email' ? 'ltr' : undefined} value={g[k]} onChange={(e) => setG({ ...g, [k]: e.target.value })} />}
              </Field>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('guardians.search', 'Name, phone or email…')} aria-label={t('common.search', 'Search')} />
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {found.data?.map((x) => (
                <li key={x.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                    <input type="radio" name="guardian" checked={existing === x.id} onChange={() => setExisting(x.id)} />
                    <span className="flex-1">
                      {x.first_name} {x.last_name} <span className="text-fg-muted" dir="ltr">{x.phone}</span>
                      <span className="block text-xs text-fg-muted">{x.children.map((c) => c.name).join(', ')}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field label={t('guardians.relationship', 'Relationship')}>
          {(a) => (
            <Select {...a} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              {GUARDIAN_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {t(`relationship.${r}`, r)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <MutationError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button loading={m.isPending} disabled={mode === 'existing' ? !existing : !g.first_name} onClick={() => m.mutate()}>
            {t('common.add', 'Add')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Guardians({ s }: { s: StudentProfile }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [invite, setInvite] = useState<{ name: string; invite: Invite } | null>(null);
  const reload = () => void qc.invalidateQueries({ queryKey: ['student', String(s.id)] });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, boolean> }) => api.patch(`/institution/guardianships/${id}`, body),
    onSuccess: reload,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const unlink = useMutation({ mutationFn: (id: number) => api.delete(`/institution/guardianships/${id}`), onSuccess: reload, onError: (e) => toast('error', errorMessage(e)) });
  const inviteM = useMutation({
    mutationFn: (g: Guardian) => api.post<{ invite: Invite }>(`/institution/guardians/${g.id}/invite`).then((r) => ({ ...r, name: `${g.first_name} ${g.last_name}` })),
    onSuccess: (r) => {
      setInvite({ name: r.name, invite: r.invite });
      reload();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const manage = can('guardians.manage');
  const toggle = (g: Guardian, key: 'can_view_grades' | 'can_view_fees' | 'can_message' | 'is_emergency_contact', label: string) => (
    <label className="flex items-center gap-1.5 text-xs">
      <input type="checkbox" disabled={!manage || patch.isPending} checked={g[key]} onChange={(e) => patch.mutate({ id: g.guardianship_id, body: { [key]: e.target.checked } })} />
      {label}
    </label>
  );
  return (
    <div className="space-y-3">
      {manage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> {t('guardians.add', 'Add a guardian')}
          </Button>
        </div>
      )}
      {s.guardians.length === 0 && <Alert tone="warning">{t('guardians.none', 'No guardians on file. Add at least one emergency contact.')}</Alert>}
      {s.guardians.map((g) => (
        <Card key={g.guardianship_id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-semibold">
                {g.first_name} {g.last_name}
                <Badge>{t(`relationship.${g.relationship}`, g.relationship)}</Badge>
                {g.is_primary && <Badge tone="info">{t('guardians.primary', 'Primary')}</Badge>}
                {g.has_account && (g.invite_pending ? <Badge tone="warning">{t('invite.pending', 'Invitation pending')}</Badge> : <Badge tone="success">{t('guardians.portal', 'Uses the parent portal')}</Badge>)}
              </div>
              <div className="mt-1 text-sm text-fg-muted">
                <span dir="ltr">{g.phone || '—'}</span>
                {g.email && <> · <span dir="ltr">{g.email}</span></>}
                {g.occupation && <> · {g.occupation}</>}
              </div>
            </div>
            {manage && (
              <div className="flex gap-1">
                {!g.is_primary && (
                  <Button variant="ghost" size="sm" onClick={() => patch.mutate({ id: g.guardianship_id, body: { is_primary: true } })}>
                    {t('guardians.makePrimary', 'Make primary')}
                  </Button>
                )}
                {g.email && (!g.has_account || g.invite_pending) && (
                  <Button variant="ghost" size="sm" loading={inviteM.isPending && inviteM.variables?.id === g.id} onClick={() => inviteM.mutate(g)} aria-label={t('guardians.invite', 'Invite to the parent portal')}>
                    <MailPlus className="size-4" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => unlink.mutate(g.guardianship_id)} aria-label={t('guardians.unlink', 'Unlink')}>
                  <Unlink className="size-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {toggle(g, 'can_view_grades', t('guardians.grades', 'Sees grades'))}
            {toggle(g, 'can_view_fees', t('guardians.fees', 'Sees fees'))}
            {toggle(g, 'can_message', t('guardians.messages', 'Can message teachers'))}
            {toggle(g, 'is_emergency_contact', t('guardians.emergency', 'Emergency contact'))}
          </div>
        </Card>
      ))}
      <AddGuardian studentId={s.id} open={adding} onClose={() => setAdding(false)} />
      <Dialog open={!!invite} onClose={() => setInvite(null)} title={t('guardians.invited', 'Invitation sent')}>
        {invite && <InviteNotice title={invite.name} invite={invite.invite} onDone={() => setInvite(null)} />}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- medical

function Medical({ s }: { s: StudentProfile }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const edit = can('students.medical.manage');
  const [v, setV] = useState<Record<string, string>>(() => ({
    blood_group: '', allergies: '', conditions: '', medications: '', emergency_contact_name: '', emergency_contact_phone: '', notes: '', ...(s.medical ?? {}),
  }));
  const m = useMutation({
    mutationFn: () => api.put(`/institution/students/${s.id}/medical`, v),
    onSuccess: () => {
      toast('success', t('common.saved', 'Saved'));
      void qc.invalidateQueries({ queryKey: ['student', String(s.id)] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const area = (k: string, label: string) => (
    <Field label={label} optional>
      {(a) => <Textarea {...a} rows={2} readOnly={!edit} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
    </Field>
  );
  return (
    <Card className="space-y-4 p-5">
      <Alert tone="info">{t('medical.restricted', 'Only people with the medical permission see this. Changes are logged without their contents.')}</Alert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('medical.blood', 'Blood group')} optional>
          {(a) => <Input {...a} readOnly={!edit} value={v.blood_group ?? ''} onChange={(e) => setV({ ...v, blood_group: e.target.value })} />}
        </Field>
        <Field label={t('medical.contact', 'Emergency contact')} optional>
          {(a) => <Input {...a} readOnly={!edit} value={v.emergency_contact_name ?? ''} onChange={(e) => setV({ ...v, emergency_contact_name: e.target.value })} />}
        </Field>
        <Field label={t('medical.contactPhone', 'Emergency phone')} optional>
          {(a) => <Input {...a} dir="ltr" readOnly={!edit} value={v.emergency_contact_phone ?? ''} onChange={(e) => setV({ ...v, emergency_contact_phone: e.target.value })} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {area('allergies', t('medical.allergies', 'Allergies'))}
        {area('conditions', t('medical.conditions', 'Conditions'))}
        {area('medications', t('medical.medications', 'Medications'))}
        {area('notes', t('medical.notes', 'Notes'))}
      </div>
      {edit && (
        <div className="flex justify-end">
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            {t('common.save', 'Save')}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- documents

function Documents({ s }: { s: StudentProfile }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('other');
  const reload = () => void qc.invalidateQueries({ queryKey: ['student', String(s.id)] });
  const up = useMutation({
    mutationFn: () => api.upload('POST', `/institution/students/${s.id}/documents`, file!, { title: title || file!.name, category }),
    onSuccess: () => {
      setFile(null);
      setTitle('');
      reload();
    },
  });
  const del = useMutation({ mutationFn: (id: number) => api.delete(`/institution/documents/${id}`), onSuccess: reload, onError: (e) => toast('error', errorMessage(e)) });
  const download = (d: StudentProfile['documents'][number]) => api.download(`/files/${d.file_id}?download=1`, d.original_name).catch((e) => toast('error', errorMessage(e)));
  return (
    <div className="space-y-4">
      {can('students.manage') && (
        <Card className="p-4">
          <form
            className="grid items-end gap-3 sm:grid-cols-[1fr_12rem_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (file) up.mutate();
            }}
          >
            <Field label={t('documents.title', 'Title')} optional>
              {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name} />}
            </Field>
            <Field label={t('documents.category', 'Kind')}>
              {(a) => (
                <Select {...a} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`docCategory.${c}`, c.replace(/_/g, ' '))}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-surface-2">
              <Upload className="size-4" aria-hidden /> {file ? file.name.slice(0, 24) : t('documents.choose', 'Choose a file')}
              <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <Button type="submit" disabled={!file} loading={up.isPending}>
              {t('documents.upload', 'Upload')}
            </Button>
          </form>
          <p className="mt-2 text-xs text-fg-muted">{t('documents.limits', 'PDF or image, up to 10 MB.')}</p>
          <MutationError error={up.error} />
        </Card>
      )}
      <Card className="divide-y divide-border">
        {s.documents.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{d.title}</div>
              <div className="text-xs text-fg-muted">
                {t(`docCategory.${d.category}`, d.category.replace(/_/g, ' '))} · {formatDate(d.created_at)} · {Math.max(1, Math.round(d.size_bytes / 1024))} KB
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => void download(d)} aria-label={t('common.download', 'Download')}>
                <FileDown className="size-4" />
              </Button>
              {can('students.manage') && (
                <Button variant="ghost" size="sm" onClick={() => del.mutate(d.id)} aria-label={t('common.delete', 'Delete')}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
        {s.documents.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-muted">{t('documents.none', 'No documents yet')}</p>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- certificates & ID card

function Certificates({ s }: { s: StudentProfile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'bonafide_letter' | 'character_certificate' | 'leaving_certificate'>('bonafide_letter');
  const [form, setForm] = useState({ purpose: '', conduct: 'good', reason: '', left_on: '', mark_left: true });
  const reload = () => void qc.invalidateQueries({ queryKey: ['student', String(s.id)] });
  const issue = useMutation({
    mutationFn: () => api.post<{ id: number; serial_no: string }>('/institution/issued-documents', { kind, student_id: s.id, ...form, left_on: form.left_on || null, mark_left: kind === 'leaving_certificate' && form.mark_left }),
    onSuccess: (d) => {
      toast('success', t('certificates.issued', '{{serial}} issued', { serial: d.serial_no }));
      reload();
      void api.download(`/institution/issued-documents/${d.id}/pdf`, `${d.serial_no}.pdf`);
    },
  });
  const card = useMutation({
    mutationFn: () => api.post<{ cards: { id: number }[] }>('/institution/id-cards', { holder_type: 'student', holder_ids: [s.id] }),
    onSuccess: (r) => {
      reload();
      void api.download(`/institution/id-cards/pdf?ids=${r.cards.map((c) => c.id).join(',')}`, `id-card-${s.roll_no ?? s.id}.pdf`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const activeCard = s.id_cards.find((c) => !c.revoked_at);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <FileText className="size-4" aria-hidden /> {t('certificates.issue', 'Issue a certificate or letter')}
        </h3>
        <Field label={t('certificates.kind', 'Document')}>
          {(a) => (
            <Select {...a} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="bonafide_letter">{t('certificates.bonafide', 'Bonafide certificate')}</option>
              <option value="character_certificate">{t('certificates.character', 'Character certificate')}</option>
              <option value="leaving_certificate">{t('certificates.leaving', 'Leaving / transfer certificate')}</option>
            </Select>
          )}
        </Field>
        {kind === 'bonafide_letter' && (
          <Field label={t('certificates.purpose', 'Purpose')} optional>
            {(a) => <Input {...a} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder={t('certificates.purposeExample', 'a visa application')} />}
          </Field>
        )}
        {kind !== 'bonafide_letter' && (
          <Field label={t('certificates.conduct', 'Conduct')}>
            {(a) => <Input {...a} value={form.conduct} onChange={(e) => setForm({ ...form, conduct: e.target.value })} />}
          </Field>
        )}
        {kind === 'leaving_certificate' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('certificates.leftOn', 'Last day')} optional>
                {(a) => <Input {...a} type="date" value={form.left_on} onChange={(e) => setForm({ ...form, left_on: e.target.value })} />}
              </Field>
              <Field label={t('certificates.reason', 'Reason for leaving')} optional>
                {(a) => <Input {...a} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.mark_left} onChange={(e) => setForm({ ...form, mark_left: e.target.checked })} />
              {t('certificates.markLeft', 'Also mark the student as having left (their sign-in stops)')}
            </label>
          </>
        )}
        <MutationError error={issue.error} />
        <Button loading={issue.isPending} onClick={() => issue.mutate()}>
          {t('certificates.issueButton', 'Issue and download')}
        </Button>
      </Card>
      <div className="space-y-4">
        <Card className="p-5">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <IdCard className="size-4" aria-hidden /> {t('idcards.title', 'ID card')}
          </h3>
          <p className="mb-3 text-sm text-fg-muted">
            {activeCard ? t('idcards.valid', 'Valid until {{date}} · code {{code}}', { date: formatDate(activeCard.valid_until), code: activeCard.verify_code }) : t('idcards.none', 'No card issued yet')}
          </p>
          <Button variant="outline" loading={card.isPending} onClick={() => card.mutate()}>
            {activeCard ? t('idcards.reissue', 'Reissue and print') : t('idcards.issue', 'Issue and print')}
          </Button>
        </Card>
        <Card className="divide-y divide-border">
          {s.issued_documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">
                  {d.title} {d.revoked_at && <Badge tone="danger">{t('certificates.revoked', 'Revoked')}</Badge>}
                </div>
                <div className="font-mono text-xs text-fg-muted">
                  {d.serial_no} · {formatDate(d.issued_at)}
                </div>
              </div>
              <Button variant="ghost" size="sm" aria-label={t('common.download', 'Download')} onClick={() => void api.download(`/institution/issued-documents/${d.id}/pdf`, `${d.serial_no}.pdf`)}>
                <FileDown className="size-4" />
              </Button>
            </div>
          ))}
          {s.issued_documents.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-muted">{t('certificates.none', 'Nothing issued yet')}</p>}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- history

function History({ s }: { s: StudentProfile }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const audit = useQuery({
    queryKey: ['audit', 'students', s.id],
    queryFn: () => api.get<{ id: number; created_at: string; action: string; actor: string; changes: Record<string, [unknown, unknown]> | null }[]>('/institution/audit', { entity: 'students', entity_id: s.id, pageSize: 50 }),
    enabled: can('audit.read'),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-3 font-semibold">{t('history.moves', 'Promotions and moves')}</h3>
        <ol className="space-y-2 text-sm">
          {s.promotions.map((p, i) => (
            <li key={i}>
              <Badge tone={p.action === 'graduated' ? 'success' : p.action === 'left' ? 'neutral' : 'info'}>{t(`promotion.${p.action}`, p.action)}</Badge>{' '}
              {p.from_name && `${sectionName({ name: p.from_name, label: p.from_label })} (${p.from_year})`}
              {p.to_name && ` → ${sectionName({ name: p.to_name, label: p.to_label })} (${p.to_year})`}
              <span className="ms-2 text-xs text-fg-muted">{formatDate(p.created_at)}</span>
            </li>
          ))}
          {s.promotions.length === 0 && <li className="text-fg-muted">{t('history.noMoves', 'No year-end moves yet')}</li>}
        </ol>
      </Card>
      {can('audit.read') && (
        <Card className="p-5">
          <h3 className="mb-3 font-semibold">{t('history.changes', 'Changes to this record')}</h3>
          <ol className="space-y-3 text-sm">
            {audit.data?.map((a) => (
              <li key={a.id}>
                <div>
                  <span className="font-medium">{a.actor}</span> · {t(`auditAction.${a.action}`, a.action)} <span className="text-xs text-fg-muted">{formatDate(a.created_at)}</span>
                </div>
                {a.changes && (
                  <ul className="mt-1 text-xs text-fg-muted">
                    {Object.entries(a.changes).map(([k, v]) => (
                      <li key={k}>
                        {k}: {Array.isArray(v) ? `${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}` : String(v)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {audit.data?.length === 0 && <li className="text-fg-muted">{t('history.noChanges', 'No changes recorded')}</li>}
          </ol>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- page

export function AdminStudentProfile() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useStudent(id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const photo = useMutation({
    mutationFn: (f: File) => api.upload('PUT', `/institution/students/${id}/photo`, f),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['student', id] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/institution/students/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/institution/students'] });
      nav('/admin/students');
    },
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const name = `${s.first_name} ${s.last_name}`;
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="relative">
              <Avatar fileId={s.photo_file_id} name={name} className="size-14" />
              {can('students.manage') && (
                <button type="button" onClick={() => photoInput.current?.click()} className="absolute -bottom-1 -end-1 grid size-6 place-items-center rounded-full border border-border bg-surface shadow" aria-label={t('profile.changePhoto', 'Change photo')}>
                  <Camera className="size-3.5" />
                </button>
              )}
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />
            </span>
            <span>
              {name}
              <span className="ms-2 align-middle">
                <StatusBadge value={s.status === 'active' ? 'active' : 'inactive'} label={t(`studentStatus.${s.status}`, s.status)} />
              </span>
            </span>
          </span>
        }
        subtitle={[s.roll_no, s.section && sectionName(s.section), s.section?.campus_name].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void api.download(`/pdf/report-card/${s.id}`, `report-card-${s.roll_no || s.id}.pdf`).catch((e) => toast('error', errorMessage(e)))}>
              <FileText className="size-4" /> {t('admin.reportCard', 'Report card')}
            </Button>
            {can('students.manage') && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> {t('common.edit', 'Edit')}
                </Button>
                <Button variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => setRemoving(true)}>
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>
        }
      />
      <Tabs
        tabs={[
          { id: 'details', label: t('profile.details', 'Details'), content: () => <Details s={s} /> },
          { id: 'guardians', label: `${term('guardian', true)} (${s.guardians.length})`, content: () => <Guardians s={s} /> },
          { id: 'medical', label: t('profile.medical', 'Medical'), hidden: s.medical === undefined, content: () => <Medical s={s} /> },
          { id: 'documents', label: `${t('profile.documents', 'Documents')} (${s.documents.length})`, content: () => <Documents s={s} /> },
          {
            id: 'courses',
            label: term('course', true),
            hidden: s.enrollments.length === 0,
            content: () => (
              <Card className="divide-y divide-border">
                {s.enrollments.map((e) => (
                  <div key={e.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <Link to={`/admin/offerings/${e.offering_id}`} className="text-primary hover:underline">
                      <span className="font-mono text-xs text-fg-muted">{e.code}</span> {e.name}
                    </Link>
                    <span className="text-fg-muted">
                      {e.term_name} {e.status === 'waitlisted' && <Badge tone="warning">{t('courses.waitlistPos', 'Waitlist #{{n}}', { n: e.waitlist_position })}</Badge>}
                    </span>
                  </div>
                ))}
              </Card>
            ),
          },
          { id: 'certificates', label: t('profile.certificates', 'Certificates & ID'), hidden: !can('documents.issue'), content: () => <Certificates s={s} /> },
          { id: 'history', label: t('profile.history', 'History'), content: () => <History s={s} /> },
        ]}
      />
      {editing && <EditDetails s={s} open onClose={() => setEditing(false)} />}
      <ConfirmDialog open={removing} title={t('profile.deleteTitle', 'Delete {{name}}?', { name })} confirmLabel={t('common.delete', 'Delete')} busy={del.isPending} error={del.error} onConfirm={() => del.mutate()} onClose={() => { setRemoving(false); del.reset(); }}>
        {t('profile.deleteHelp', 'The record moves to the recycle bin for 30 days and their sign-in stops. You can restore it from there.')}
      </ConfirmDialog>
    </>
  );
}

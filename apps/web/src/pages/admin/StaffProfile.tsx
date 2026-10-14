// One staff member: details, what they teach (load), documents, and their photo.
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Camera, FileDown, Pencil, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useTerms } from '@/lib/terms';
import { Avatar } from '@/components/FileImage';
import { FormDialog, nullIfEmpty, useFormDialog } from '@/components/FormDialog';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Input, MutationError, PageHeader, Skeleton, StatCard, StatusBadge, Tabs, useToast } from '@/components/ui';
import { sectionName, useStructure } from './structure-data';

interface Staff {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  gender: string | null;
  dob: string | null;
  cnic: string | null;
  qualification: string;
  designation: string;
  employee_no: string | null;
  staff_type: 'teaching' | 'non_teaching';
  employment_type: string;
  status: 'active' | 'on_leave' | 'left';
  campus_id: number | null;
  campus_name: string | null;
  department_id: number | null;
  department_name: string | null;
  joining_date: string | null;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  photo_file_id: number | null;
  courses: number;
  credit_hours: number;
  periods_per_week: number;
  homerooms: number;
  teaching: { role: string; offering_id: number; code: string; name: string; credit_hours: string | null; section_id: number | null; section_name: string | null; section_label: string | null; term_name: string | null }[];
  documents: { id: number; title: string; category: string; created_at: string; file_id: number; original_name: string; size_bytes: number }[];
  account: { is_active: boolean; invite_pending: boolean; last_login_at: string | null } | null;
}

export function AdminStaffProfile() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const structure = useStructure();
  const dlg = useFormDialog();
  const photoInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [removing, setRemoving] = useState(false);
  const q = useQuery({ queryKey: ['staff', id], queryFn: () => api.get<Staff>(`/institution/teachers/${id}`) });
  const reload = () => void qc.invalidateQueries({ queryKey: ['staff', id] });
  const photo = useMutation({ mutationFn: (f: File) => api.upload('PUT', `/institution/teachers/${id}/photo`, f), onSuccess: reload, onError: (e) => toast('error', errorMessage(e)) });
  const upload = useMutation({
    mutationFn: () => api.upload('POST', `/institution/teachers/${id}/documents`, file!, { title: title || file!.name, category: 'other' }),
    onSuccess: () => {
      setFile(null);
      setTitle('');
      reload();
    },
  });
  const delDoc = useMutation({ mutationFn: (docId: number) => api.delete(`/institution/documents/${docId}`), onSuccess: reload, onError: (e) => toast('error', errorMessage(e)) });
  const del = useMutation({
    mutationFn: () => api.delete(`/institution/teachers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/institution/teachers'] });
      nav('/admin/teachers');
    },
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const name = `${s.first_name} ${s.last_name}`;
  const manage = can('staff.manage');
  const fields = [
    { name: 'first_name', label: t('people.firstName', 'First name') },
    { name: 'last_name', label: t('people.lastName', 'Last name') },
    { name: 'email', label: t('common.email', 'Email'), type: 'email', dir: 'ltr' as const },
    { name: 'phone', label: t('common.phone', 'Phone'), optional: true, dir: 'ltr' as const },
    { name: 'designation', label: t('staff.designation', 'Designation'), optional: true },
    { name: 'employee_no', label: t('staff.employeeNo', 'Employee number'), optional: true, dir: 'ltr' as const },
    { name: 'staff_type', label: t('staff.type', 'Staff type'), options: [{ value: 'teaching', label: term('teacher') }, { value: 'non_teaching', label: t('staff.nonTeachingShort', 'Non-teaching') }] },
    { name: 'employment_type', label: t('staff.employment', 'Employment'), options: ['full_time', 'part_time', 'visiting', 'contract'].map((x) => ({ value: x, label: t(`employment.${x}`, x.replace('_', ' ')) })) },
    { name: 'status', label: t('common.status', 'Status'), options: ['active', 'on_leave', 'left'].map((x) => ({ value: x, label: t(`staffStatus.${x}`, x.replace('_', ' ')) })) },
    { name: 'campus_id', label: term('campus'), optional: true, options: [{ value: '', label: '—' }, ...(structure.data?.campuses ?? []).map((c) => ({ value: String(c.id), label: c.name }))] },
    { name: 'department_id', label: term('department'), optional: true, options: [{ value: '', label: '—' }, ...(structure.data?.departments ?? []).map((d) => ({ value: String(d.id), label: d.name }))] },
    { name: 'qualification', label: t('people.qualification', 'Qualification'), optional: true },
    { name: 'joining_date', label: t('staff.joined', 'Joining date'), type: 'date', optional: true },
    { name: 'emergency_contact_name', label: t('medical.contact', 'Emergency contact'), optional: true },
    { name: 'emergency_contact_phone', label: t('medical.contactPhone', 'Emergency phone'), optional: true, dir: 'ltr' as const },
    { name: 'address', label: t('common.address', 'Address'), optional: true },
  ];
  const edit = () =>
    dlg.open({
      title: t('common.edit', 'Edit'),
      initial: Object.fromEntries(fields.map((f) => [f.name, String((s as unknown as Record<string, unknown>)[f.name] ?? '')])),
      submit: async (v) => {
        await api.patch(`/institution/teachers/${id}`, { ...v, campus_id: nullIfEmpty(v.campus_id), department_id: nullIfEmpty(v.department_id), joining_date: nullIfEmpty(v.joining_date), employee_no: nullIfEmpty(v.employee_no) });
        reload();
      },
    });
  const item = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="relative">
              <Avatar fileId={s.photo_file_id} name={name} className="size-14" />
              {manage && (
                <button type="button" onClick={() => photoInput.current?.click()} className="absolute -bottom-1 -end-1 grid size-6 place-items-center rounded-full border border-border bg-surface shadow" aria-label={t('profile.changePhoto', 'Change photo')}>
                  <Camera className="size-3.5" />
                </button>
              )}
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} />
            </span>
            <span>
              {name} <StatusBadge value={s.status === 'active' ? 'active' : 'inactive'} label={t(`staffStatus.${s.status}`, s.status.replace('_', ' '))} />
            </span>
          </span>
        }
        subtitle={[s.designation, s.department_name, s.campus_name, s.employee_no].filter(Boolean).join(' · ')}
        actions={
          manage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={edit}>
                <Pencil className="size-4" /> {t('common.edit', 'Edit')}
              </Button>
              <Button variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => setRemoving(true)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          )
        }
      />
      {s.staff_type === 'teaching' && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={term('course', true)} value={s.courses} />
          <StatCard label={t('staff.credits', 'Credit hours (this term)')} value={s.credit_hours} />
          <StatCard label={t('staff.periods', 'Periods a week')} value={s.periods_per_week} />
          <StatCard label={t('staff.homerooms', 'Class teacher of')} value={s.homerooms} />
        </div>
      )}
      <Tabs
        tabs={[
          {
            id: 'details',
            label: t('profile.details', 'Details'),
            content: () => (
              <Card className="p-5">
                <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {item(t('common.email', 'Email'), <span dir="ltr">{s.email}</span>)}
                  {item(t('common.phone', 'Phone'), s.phone && <span dir="ltr">{s.phone}</span>)}
                  {item(t('staff.employment', 'Employment'), t(`employment.${s.employment_type}`, s.employment_type.replace('_', ' ')))}
                  {item(t('people.qualification', 'Qualification'), s.qualification)}
                  {item(t('staff.joined', 'Joining date'), s.joining_date && formatDate(s.joining_date))}
                  {item(t('medical.contact', 'Emergency contact'), [s.emergency_contact_name, s.emergency_contact_phone].filter(Boolean).join(' · '))}
                  {item(t('common.address', 'Address'), s.address)}
                  {item(t('profile.account', 'Sign-in'), s.account ? (s.account.invite_pending ? t('invite.pending', 'Invitation pending') : s.account.is_active ? t('profile.active', 'Active') : t('profile.disabled', 'Disabled')) : t('profile.noAccount', 'No account'))}
                </dl>
              </Card>
            ),
          },
          {
            id: 'teaching',
            label: t('staff.teachingTab', 'Teaching'),
            hidden: s.staff_type !== 'teaching',
            content: () => (
              <Card className="divide-y divide-border">
                {s.teaching.map((x) => (
                  <div key={`${x.offering_id}-${x.role}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <Link to={`/admin/offerings/${x.offering_id}`} className="text-primary hover:underline">
                      <span className="font-mono text-xs text-fg-muted">{x.code}</span> {x.name}
                    </Link>
                    <span className="flex items-center gap-2 text-fg-muted">
                      {x.section_name && sectionName({ name: x.section_name, label: x.section_label })}
                      {x.term_name && ` · ${x.term_name}`}
                      {x.role !== 'teacher' && <Badge>{t(`staffRole.${x.role}`, x.role)}</Badge>}
                    </span>
                  </div>
                ))}
                {s.teaching.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-muted">{t('staff.noTeaching', 'Not assigned to any course yet — assign from a class page.')}</p>}
              </Card>
            ),
          },
          {
            id: 'documents',
            label: `${t('profile.documents', 'Documents')} (${s.documents.length})`,
            content: () => (
              <div className="space-y-4">
                {manage && (
                  <Card className="p-4">
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (file) upload.mutate();
                      }}
                    >
                      <Input className="max-w-xs" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('documents.titleExample', 'CV, contract, degree…')} aria-label={t('documents.title', 'Title')} />
                      <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-surface-2">
                        <Upload className="size-4" aria-hidden /> {file ? file.name.slice(0, 24) : t('documents.choose', 'Choose a file')}
                        <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                      </label>
                      <Button type="submit" disabled={!file} loading={upload.isPending}>
                        {t('documents.upload', 'Upload')}
                      </Button>
                    </form>
                    <MutationError error={upload.error} />
                  </Card>
                )}
                <Card className="divide-y divide-border">
                  {s.documents.map((d) => (
                    <div key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <span>
                        {d.title} <span className="text-xs text-fg-muted">· {formatDate(d.created_at)}</span>
                      </span>
                      <span className="flex gap-1">
                        <Button variant="ghost" size="sm" aria-label={t('common.download', 'Download')} onClick={() => void api.download(`/files/${d.file_id}?download=1`, d.original_name)}>
                          <FileDown className="size-4" />
                        </Button>
                        {manage && (
                          <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => delDoc.mutate(d.id)}>
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </span>
                    </div>
                  ))}
                  {s.documents.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-muted">{t('documents.none', 'No documents yet')}</p>}
                </Card>
              </div>
            ),
          },
        ]}
      />
      {dlg.state && <FormDialog open title={dlg.state.title} initial={dlg.state.initial} fields={fields} submitLabel={t('common.save', 'Save')} onSubmit={dlg.state.submit} onClose={dlg.close} />}
      <ConfirmDialog open={removing} title={t('profile.deleteTitle', 'Delete {{name}}?', { name })} confirmLabel={t('common.delete', 'Delete')} busy={del.isPending} error={del.error} onConfirm={() => del.mutate()} onClose={() => { setRemoving(false); del.reset(); }}>
        {t('profile.deleteHelp', 'The record moves to the recycle bin for 30 days and their sign-in stops. You can restore it from there.')}
      </ConfirmDialog>
    </>
  );
}

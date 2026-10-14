// Classes / batches / cohorts (sections): list with filters, create and edit, and a detail page
// with the students, the courses offered to the section and who teaches them.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookOpen, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePagedList, useDebounced } from '@/lib/queries';
import { useTerms } from '@/lib/terms';
import { FormDialog, nullIfEmpty, useFormDialog, type Values } from '@/components/FormDialog';
import { Badge, Button, Card, ConfirmDialog, DataTable, ErrorState, Input, PageHeader, Pager, Select, Skeleton, StatusBadge, useToast } from '@/components/ui';
import { sectionName, useRefreshStructure, useStaffOptions, useStructure } from './structure-data';

interface SectionRow {
  id: number;
  code: string;
  name: string;
  label: string | null;
  status: string;
  capacity: number | null;
  campus_id: number | null;
  campus_name: string | null;
  program_level_id: number | null;
  level_name: string | null;
  program_name: string | null;
  academic_year_id: number | null;
  academic_year: string | null;
  homeroom_teacher_id: number | null;
  homeroom_teacher: string | null;
  students: number;
  subjects: number;
}

/** Fields shared by "new section" and "edit section". */
function useSectionFields() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const s = useStructure();
  const staff = useStaffOptions();
  return [
    { name: 'name', label: t('common.name', 'Name'), hint: t('sections.nameHint', 'e.g. Class 9, BSCS batch 2026, Cohort 12') },
    { name: 'label', label: t('sections.label', 'Section / label'), optional: true, hint: 'A, B, Blue…' },
    { name: 'code', label: t('common.code', 'Code'), dir: 'ltr' as const, hint: t('sections.codeHint', 'Short and unique, e.g. C9-A') },
    {
      name: 'program_level_id',
      label: term('level'),
      optional: true,
      options: [{ value: '', label: '—' }, ...(s.data?.programs ?? []).flatMap((p) => p.levels.map((l) => ({ value: String(l.id), label: `${p.name} · ${l.name}` })))],
    },
    { name: 'campus_id', label: term('campus'), optional: true, options: [{ value: '', label: t('sections.mainCampus', 'Main') }, ...(s.data?.campuses ?? []).map((c) => ({ value: String(c.id), label: c.name }))] },
    {
      name: 'academic_year_id',
      label: term('academicYear'),
      optional: true,
      options: [{ value: '', label: t('sections.currentYear', 'Current') }, ...(s.data?.academic_years ?? []).filter((y) => y.status !== 'archived').map((y) => ({ value: String(y.id), label: y.name }))],
    },
    { name: 'homeroom_teacher_id', label: t('sections.homeroom', 'Class teacher'), optional: true, options: [{ value: '', label: '—' }, ...(staff.data ?? []).map((x) => ({ value: String(x.id), label: `${x.first_name} ${x.last_name}` }))] },
    { name: 'capacity', label: t('sections.capacity', 'Capacity'), optional: true, type: 'number' },
  ];
}

const sectionBody = (v: Values) => ({
  ...v,
  program_level_id: nullIfEmpty(v.program_level_id),
  campus_id: nullIfEmpty(v.campus_id),
  academic_year_id: nullIfEmpty(v.academic_year_id),
  homeroom_teacher_id: nullIfEmpty(v.homeroom_teacher_id),
  capacity: nullIfEmpty(v.capacity),
});

export function AdminSections() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const structure = useStructure();
  const refresh = useRefreshStructure();
  const fields = useSectionFields();
  const dlg = useFormDialog();
  const [search, setSearch] = useState('');
  const [campus, setCampus] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState('active');
  const debounced = useDebounced(search);
  const list = usePagedList<SectionRow>('/institution/sections', { search: debounced, campus_id: campus, academic_year_id: year, status }, 100);
  const multiCampus = (structure.data?.campuses.length ?? 0) > 1;
  return (
    <>
      <PageHeader
        title={term('section', true)}
        subtitle={list.data && t('sections.count', '{{count}} in this view', { count: list.data.total })}
        actions={
          can('sections.manage') && (
            <Button
              onClick={() =>
                dlg.open({
                  title: t('sections.add', 'Add a {{section}}', { section: term('section', false, { lower: true }) }),
                  initial: { name: '', label: 'A', code: '', program_level_id: '', campus_id: '', academic_year_id: '', homeroom_teacher_id: '', capacity: '' },
                  submit: async (v) => {
                    await api.post('/institution/sections', sectionBody(v));
                    refresh();
                  },
                })
              }
            >
              <Plus className="size-4" /> {t('sections.add', 'Add a {{section}}', { section: term('section', false, { lower: true }) })}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('common.searchName', 'Search by name or code…')} aria-label={t('common.search', 'Search')} />
        {multiCampus && (
          <Select className="w-auto" value={campus} onChange={(e) => setCampus(e.target.value)} aria-label={term('campus')}>
            <option value="">{t('structure.allCampuses', 'All campuses')}</option>
            {structure.data?.campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select className="w-auto" value={year} onChange={(e) => setYear(e.target.value)} aria-label={term('academicYear')}>
          <option value="">{t('sections.anyYear', 'Any year')}</option>
          {structure.data?.academic_years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status', 'Status')}>
          <option value="active">{t('status.active', 'Active')}</option>
          <option value="archived">{t('structure.archived', 'Archived')}</option>
          <option value="all">{t('common.all', 'All')}</option>
        </Select>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('sections.none', 'No {{sections}} here yet', { sections: term('section', true, { lower: true }) })}
        columns={[
          {
            key: 'name',
            header: t('common.name', 'Name'),
            cell: (s) => (
              <Link to={`/admin/sections/${s.id}`} className="font-medium text-primary hover:underline">
                {sectionName(s)}
                <span className="ms-2 font-mono text-xs text-fg-muted">{s.code}</span>
              </Link>
            ),
          },
          { key: 'level', header: term('level'), cell: (s) => (s.level_name ? `${s.program_name} · ${s.level_name}` : '—'), hideOnMobile: true },
          ...(multiCampus ? [{ key: 'campus', header: term('campus'), cell: (s: SectionRow) => s.campus_name ?? '—', hideOnMobile: true }] : []),
          { key: 'year', header: term('academicYear'), cell: (s) => s.academic_year ?? '—', hideOnMobile: true },
          { key: 'teacher', header: t('sections.homeroom', 'Class teacher'), cell: (s) => s.homeroom_teacher ?? '—', hideOnMobile: true },
          {
            key: 'students',
            header: term('student', true),
            cell: (s) => (
              <span>
                {s.students}
                {s.capacity ? <span className="text-fg-muted"> / {s.capacity}</span> : null}
              </span>
            ),
          },
          { key: 'status', header: <span className="sr-only">{t('common.status', 'Status')}</span>, cell: (s) => s.status === 'archived' && <StatusBadge value="inactive" label={t('structure.archived', 'Archived')} /> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {dlg.state && <FormDialog open title={dlg.state.title} initial={dlg.state.initial} fields={fields} submitLabel={t('common.save', 'Save')} onSubmit={dlg.state.submit} onClose={dlg.close} />}
    </>
  );
}

// ---------------------------------------------------------------- detail

interface SectionDetail extends SectionRow {
  year_status: string | null;
  students: never;
  offerings: { id: number; course_id: number; code: string; name: string; credit_hours: string | null; term_name: string | null; enrollment_mode: string; staff: { teacher_id: number; role: string; name: string }[] }[];
}
interface SectionDetailResponse extends Omit<SectionDetail, 'students'> {
  students: { id: number; roll_no: string | null; first_name: string; last_name: string; gender: string | null; status: string }[];
}

export function AdminSectionDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = useRefreshStructure();
  const structure = useStructure();
  const staff = useStaffOptions();
  const fields = useSectionFields();
  const dlg = useFormDialog();
  const [remove, setRemove] = useState(false);
  const q = useQuery({ queryKey: ['section', id], queryFn: () => api.get<SectionDetailResponse>(`/institution/sections/${id}`) });
  const courses = useQuery({ queryKey: ['courses-all'], queryFn: () => api.get<{ id: number; code: string; name: string }[]>('/institution/courses', { pageSize: 100 }), enabled: can('structure.manage') });
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ['section', id] });
    refresh();
  };
  const del = useMutation({ mutationFn: () => api.delete(`/institution/sections/${id}`), onSuccess: () => history.back() });
  const unassign = useMutation({
    mutationFn: ({ offering, teacher }: { offering: number; teacher: number }) => api.delete(`/institution/offerings/${offering}/staff/${teacher}`),
    onSuccess: reload,
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const readOnly = s.status === 'archived' || s.year_status === 'archived';
  const manage = can('sections.manage') && !readOnly;
  const currentTerms = (structure.data?.academic_years ?? []).filter((y) => y.id === s.academic_year_id || y.is_current).flatMap((y) => y.terms);
  return (
    <>
      <PageHeader
        title={
          <span>
            {sectionName(s)} <span className="ms-1 font-mono text-sm text-fg-muted">{s.code}</span>
          </span>
        }
        subtitle={[s.program_name && `${s.program_name} · ${s.level_name}`, s.campus_name, s.academic_year].filter(Boolean).join(' · ')}
        actions={
          manage && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  dlg.open({
                    title: t('common.edit', 'Edit'),
                    initial: {
                      name: s.name, label: s.label ?? '', code: s.code, program_level_id: s.program_level_id ? String(s.program_level_id) : '', campus_id: s.campus_id ? String(s.campus_id) : '',
                      academic_year_id: s.academic_year_id ? String(s.academic_year_id) : '', homeroom_teacher_id: s.homeroom_teacher_id ? String(s.homeroom_teacher_id) : '', capacity: s.capacity ? String(s.capacity) : '',
                    },
                    submit: async (v) => {
                      await api.patch(`/institution/sections/${id}`, sectionBody(v));
                      reload();
                    },
                  })
                }
              >
                <Pencil className="size-4" /> {t('common.edit', 'Edit')}
              </Button>
              <Button variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => setRemove(true)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          )
        }
      />
      {readOnly && <Badge tone="neutral" className="mb-4">{t('structure.archived', 'Archived · read-only')}</Badge>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Users className="size-4" aria-hidden /> {term('student', true)} <span className="text-fg-muted">({s.students.length}{s.capacity ? ` / ${s.capacity}` : ''})</span>
          </h2>
          {s.homeroom_teacher && <p className="mb-2 text-sm text-fg-muted">{t('sections.homeroomIs', 'Class teacher: {{name}}', { name: s.homeroom_teacher })}</p>}
          <ul className="divide-y divide-border">
            {s.students.map((st) => (
              <li key={st.id} className="flex items-center justify-between py-2 text-sm">
                <Link to={`/admin/students/${st.id}`} className="font-medium text-primary hover:underline">
                  {st.first_name} {st.last_name}
                </Link>
                <span className="font-mono text-xs text-fg-muted">{st.roll_no ?? ''}</span>
              </li>
            ))}
            {s.students.length === 0 && <li className="py-2 text-sm text-fg-muted">{t('sections.noStudents', 'Nobody yet')}</li>}
          </ul>
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold">
              <BookOpen className="size-4" aria-hidden /> {term('course', true)}
            </h2>
            {can('structure.manage') && !readOnly && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  dlg.open({
                    title: t('sections.offer', 'Offer a {{course}}', { course: term('course', false, { lower: true }) }),
                    initial: { course_id: String(courses.data?.[0]?.id ?? ''), term_id: String(currentTerms.find((x) => x.status === 'active')?.id ?? currentTerms[0]?.id ?? '') },
                    submit: async (v) => {
                      await api.post('/institution/offerings', { course_id: v.course_id, term_id: nullIfEmpty(v.term_id), section_id: Number(id), enrollment_mode: 'section' });
                      reload();
                    },
                  })
                }
              >
                <Plus className="size-4" /> {term('course')}
              </Button>
            )}
          </div>
          <ul className="space-y-2">
            {s.offerings.map((o) => (
              <li key={o.id} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/admin/offerings/${o.id}`} className="font-medium text-primary hover:underline">
                    <span className="font-mono text-xs text-fg-muted">{o.code}</span> {o.name}
                  </Link>
                  {o.term_name && <span className="text-xs text-fg-muted">{o.term_name}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {o.staff.map((p) => (
                    <Badge key={p.teacher_id} tone={p.role === 'teacher' ? 'info' : 'neutral'}>
                      {p.name}
                      {p.role !== 'teacher' && ` · ${t(`staffRole.${p.role}`, p.role === 'ta' ? 'TA' : 'co-teacher')}`}
                      {can('structure.manage') && !readOnly && (
                        <button type="button" className="ms-1 opacity-60 hover:opacity-100" aria-label={t('sections.unassign', 'Remove {{name}}', { name: p.name })} onClick={() => unassign.mutate({ offering: o.id, teacher: p.teacher_id })}>
                          ×
                        </button>
                      )}
                    </Badge>
                  ))}
                  {can('structure.manage') && !readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        dlg.open({
                          title: t('sections.assign', 'Who teaches {{course}}?', { course: o.name }),
                          initial: { teacher_id: String(staff.data?.[0]?.id ?? ''), role: 'teacher' },
                          submit: async (v) => {
                            await api.post(`/institution/offerings/${o.id}/staff`, v);
                            reload();
                          },
                        })
                      }
                    >
                      <UserPlus className="size-3.5" /> {t('sections.assignShort', 'Assign')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {s.offerings.length === 0 && <li className="text-sm text-fg-muted">{t('sections.noCourses', 'No {{courses}} yet', { courses: term('course', true, { lower: true }) })}</li>}
          </ul>
        </Card>
      </div>
      {dlg.state && (
        <FormDialog
          open
          title={dlg.state.title}
          initial={dlg.state.initial}
          fields={
            'course_id' in dlg.state.initial
              ? [
                  { name: 'course_id', label: term('course'), options: (courses.data ?? []).map((c) => ({ value: String(c.id), label: `${c.code} · ${c.name}` })) },
                  { name: 'term_id', label: term('term'), optional: true, options: [{ value: '', label: '—' }, ...currentTerms.map((x) => ({ value: String(x.id), label: x.name }))] },
                ]
              : 'teacher_id' in dlg.state.initial
                ? [
                    { name: 'teacher_id', label: term('teacher'), options: (staff.data ?? []).map((x) => ({ value: String(x.id), label: `${x.first_name} ${x.last_name}` })) },
                    { name: 'role', label: t('sections.role', 'Role'), options: [{ value: 'teacher', label: term('teacher') }, { value: 'co_teacher', label: t('staffRole.co_teacher', 'Co-teacher') }, { value: 'ta', label: t('staffRole.ta', 'Teaching assistant') }] },
                  ]
                : fields
          }
          submitLabel={t('common.save', 'Save')}
          onSubmit={dlg.state.submit}
          onClose={dlg.close}
        />
      )}
      <ConfirmDialog open={remove} title={t('structure.deleteNamed', 'Delete {{name}}?', { name: sectionName(s) })} confirmLabel={t('common.delete', 'Delete')} busy={del.isPending} error={del.error} onConfirm={() => del.mutate()} onClose={() => { setRemove(false); del.reset(); }}>
        {t('sections.deleteHelp', 'Only an empty {{section}} can be deleted; it goes to the recycle bin.', { section: term('section', false, { lower: true }) })}
      </ConfirmDialog>
    </>
  );
}

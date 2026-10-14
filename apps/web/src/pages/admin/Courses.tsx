// The course catalog and course offerings. An offering is a course in a term, for a whole
// class or open for enrolment with capacity and a waitlist.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Search, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, usePagedList } from '@/lib/queries';
import { useTerms } from '@/lib/terms';
import { FormDialog, nullIfEmpty, useFormDialog, type Values } from '@/components/FormDialog';
import { Alert, Badge, Button, Card, DataTable, Dialog, ErrorState, Input, PageHeader, Pager, Select, Skeleton, Tabs, useToast } from '@/components/ui';
import { sectionName, useSectionOptions, useStructure } from './structure-data';

interface CourseRow {
  id: number;
  code: string;
  name: string;
  description: string;
  credit_hours: string | null;
  department_id: number | null;
  department_name: string | null;
  offerings: number;
}
interface Offering {
  id: number;
  course_id: number;
  code: string;
  name: string;
  credit_hours: string | null;
  term_id: number | null;
  term_name: string | null;
  section_id: number | null;
  section_name: string | null;
  section_label: string | null;
  enrollment_mode: 'section' | 'open';
  capacity: number | null;
  waitlist_enabled: boolean;
  enrolled: number;
  waitlisted: number;
  staff: { teacher_id: number; role: string; name: string }[];
}

function Catalog() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const structure = useStructure();
  const qc = useQueryClient();
  const dlg = useFormDialog();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const list = usePagedList<CourseRow>('/institution/courses', { search: debounced }, 100);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['/institution/courses'] });
  const del = useMutation({ mutationFn: (c: CourseRow) => api.delete(`/institution/courses/${c.id}`), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const fields = [
    { name: 'code', label: t('common.code', 'Code'), dir: 'ltr' as const, hint: 'CS101, MATH-9' },
    { name: 'name', label: t('common.name', 'Name') },
    { name: 'credit_hours', label: t('courses.credits', 'Credit hours'), optional: true, type: 'number' },
    { name: 'department_id', label: term('department'), optional: true, options: [{ value: '', label: '—' }, ...(structure.data?.departments ?? []).map((d) => ({ value: String(d.id), label: d.name }))] },
    { name: 'description', label: t('common.description', 'Description'), optional: true },
  ];
  const save = (c: CourseRow | null) => async (v: Values) => {
    const body = { ...v, credit_hours: nullIfEmpty(v.credit_hours), department_id: nullIfEmpty(v.department_id) };
    if (c) await api.patch(`/institution/courses/${c.id}`, body);
    else await api.post('/institution/courses', body);
    refresh();
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('common.searchName', 'Search by name or code…')} aria-label={t('common.search', 'Search')} />
        </div>
        {can('structure.manage') && (
          <Button onClick={() => dlg.open({ title: t('courses.add', 'Add a {{course}}', { course: term('course', false, { lower: true }) }), initial: { code: '', name: '', credit_hours: '', department_id: '', description: '' }, submit: save(null) })}>
            <Plus className="size-4" /> {t('courses.add', 'Add a {{course}}', { course: term('course', false, { lower: true }) })}
          </Button>
        )}
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('courses.none', 'No {{courses}} yet', { courses: term('course', true, { lower: true }) })}
        columns={[
          { key: 'code', header: t('common.code', 'Code'), cell: (c) => <span className="font-mono text-xs">{c.code}</span> },
          { key: 'name', header: t('common.name', 'Name'), cell: (c) => <span className="font-medium">{c.name}</span> },
          { key: 'credits', header: t('courses.credits', 'Credit hours'), cell: (c) => c.credit_hours ?? '—', hideOnMobile: true },
          { key: 'dept', header: term('department'), cell: (c) => c.department_name ?? '—', hideOnMobile: true },
          { key: 'offerings', header: t('courses.offered', 'Offered'), cell: (c) => c.offerings, hideOnMobile: true },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (c) =>
              can('structure.manage') && (
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" aria-label={t('common.edit', 'Edit')} onClick={() => dlg.open({ title: t('common.edit', 'Edit'), initial: { code: c.code, name: c.name, credit_hours: c.credit_hours ?? '', department_id: c.department_id ? String(c.department_id) : '', description: c.description }, submit: save(c) })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => del.mutate(c)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {dlg.state && <FormDialog open title={dlg.state.title} initial={dlg.state.initial} fields={fields} submitLabel={t('common.save', 'Save')} onSubmit={dlg.state.submit} onClose={dlg.close} />}
    </>
  );
}

function Offerings() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const structure = useStructure();
  const qc = useQueryClient();
  const dlg = useFormDialog();
  const terms = (structure.data?.academic_years ?? []).flatMap((y) => y.terms.map((x) => ({ ...x, year: y.name })));
  const [termId, setTermId] = useState('');
  const list = usePagedList<Offering>('/institution/offerings', { term_id: termId }, 100);
  const courses = useQuery({ queryKey: ['courses-all'], queryFn: () => api.get<{ id: number; code: string; name: string }[]>('/institution/courses', { pageSize: 100 }) });
  const sections = useSectionOptions();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Select className="w-auto" value={termId} onChange={(e) => setTermId(e.target.value)} aria-label={term('term')}>
          <option value="">{t('courses.allTerms', 'All {{terms}}', { terms: term('term', true, { lower: true }) })}</option>
          {terms.map((x) => (
            <option key={x.id} value={x.id}>
              {x.year} · {x.name}
            </option>
          ))}
        </Select>
        {can('structure.manage') && (
          <Button
            onClick={() =>
              dlg.open({
                title: t('courses.offer', 'Offer a {{course}}', { course: term('course', false, { lower: true }) }),
                initial: { course_id: String(courses.data?.[0]?.id ?? ''), term_id: String(terms.find((x) => x.status === 'active')?.id ?? ''), enrollment_mode: 'open', section_id: '', capacity: '' },
                submit: async (v) => {
                  await api.post('/institution/offerings', { ...v, term_id: nullIfEmpty(v.term_id), section_id: nullIfEmpty(v.section_id), capacity: nullIfEmpty(v.capacity) });
                  void qc.invalidateQueries({ queryKey: ['/institution/offerings'] });
                },
              })
            }
          >
            <Plus className="size-4" /> {t('courses.offer', 'Offer a {{course}}', { course: term('course', false, { lower: true }) })}
          </Button>
        )}
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('courses.noOfferings', 'Nothing offered yet')}
        columns={[
          {
            key: 'course',
            header: term('course'),
            cell: (o) => (
              <Link to={`/admin/offerings/${o.id}`} className="font-medium text-primary hover:underline">
                <span className="font-mono text-xs text-fg-muted">{o.code}</span> {o.name}
              </Link>
            ),
          },
          { key: 'term', header: term('term'), cell: (o) => o.term_name ?? '—', hideOnMobile: true },
          { key: 'section', header: term('section'), cell: (o) => (o.section_name ? sectionName({ name: o.section_name, label: o.section_label }) : t('courses.open', 'Open enrolment')) },
          { key: 'staff', header: term('teacher', true), cell: (o) => o.staff.map((s) => s.name).join(', ') || '—', hideOnMobile: true },
          {
            key: 'seats',
            header: t('courses.seats', 'Seats'),
            cell: (o) =>
              o.enrollment_mode === 'open' ? (
                <span>
                  {o.enrolled}
                  {o.capacity ? ` / ${o.capacity}` : ''}
                  {o.waitlisted > 0 && <Badge tone="warning" className="ms-2">{t('courses.waitlisted', '{{n}} waiting', { n: o.waitlisted })}</Badge>}
                </span>
              ) : (
                <span className="text-fg-muted">{t('courses.wholeClass', 'Whole class')}</span>
              ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {dlg.state && (
        <FormDialog
          open
          title={dlg.state.title}
          initial={dlg.state.initial}
          fields={[
            { name: 'course_id', label: term('course'), options: (courses.data ?? []).map((c) => ({ value: String(c.id), label: `${c.code} · ${c.name}` })) },
            { name: 'term_id', label: term('term'), optional: true, options: [{ value: '', label: '—' }, ...terms.filter((x) => x.status !== 'archived').map((x) => ({ value: String(x.id), label: `${x.year} · ${x.name}` }))] },
            { name: 'enrollment_mode', label: t('courses.who', 'Who takes it'), options: [{ value: 'open', label: t('courses.openHelp', 'Students enrol individually') }, { value: 'section', label: t('courses.sectionHelp', 'Everyone in one {{section}}', { section: term('section', false, { lower: true }) }) }] },
            { name: 'section_id', label: term('section'), optional: true, options: [{ value: '', label: '—' }, ...(sections.data ?? []).map((s) => ({ value: String(s.id), label: `${sectionName(s)} (${s.code})` }))] },
            { name: 'capacity', label: t('courses.capacity', 'Capacity (open enrolment)'), optional: true, type: 'number' },
          ]}
          submitLabel={t('common.save', 'Save')}
          onSubmit={dlg.state.submit}
          onClose={dlg.close}
        />
      )}
    </>
  );
}

export function AdminCourses() {
  const { t } = useTranslation();
  const { term } = useTerms();
  return (
    <>
      <PageHeader title={term('course', true)} subtitle={t('courses.subtitle', 'The catalog, and what is offered each {{term}}', { term: term('term', false, { lower: true }) })} />
      <Tabs
        tabs={[
          { id: 'catalog', label: t('courses.catalog', 'Catalog'), content: () => <Catalog /> },
          { id: 'offerings', label: t('courses.offerings', 'Offered'), content: () => <Offerings /> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- one offering

interface EnrolmentRow {
  student_id: number;
  roll_no: string | null;
  first_name: string;
  last_name: string;
  status: 'active' | 'waitlisted';
  waitlist_position: number | null;
}

function EnrolDialog({ offeringId, open, onClose }: { offeringId: number; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const debounced = useDebounced(search);
  const students = useQuery({
    queryKey: ['student-search', debounced],
    queryFn: () => api.get<{ id: number; first_name: string; last_name: string; roll_no: string | null; section_name: string | null }[]>('/institution/students', { search: debounced, pageSize: 20 }),
    enabled: open,
  });
  const m = useMutation({
    mutationFn: () => api.post<{ enrolled: number[]; waitlisted: number[]; already: number[]; full: number[] }>(`/institution/offerings/${offeringId}/enrollments`, { student_ids: picked }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offering', String(offeringId)] });
      setPicked([]);
    },
  });
  const close = () => {
    m.reset();
    setPicked([]);
    onClose();
  };
  return (
    <Dialog open={open} onClose={close} title={t('courses.enrol', 'Enrol {{students}}', { students: term('student', true, { lower: true }) })}>
      <div className="space-y-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.searchStudents', 'Search by name or roll number…')} aria-label={t('common.search', 'Search')} />
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {students.data?.map((s) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-2">
                <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                <span className="flex-1">
                  {s.first_name} {s.last_name} <span className="text-fg-muted">{s.section_name ?? ''}</span>
                </span>
                <span className="font-mono text-xs text-fg-muted">{s.roll_no}</span>
              </label>
            </li>
          ))}
        </ul>
        {m.data && (
          <Alert tone="success">
            {t('courses.enrolResult', '{{a}} enrolled, {{w}} on the waitlist, {{x}} already in, {{f}} not added (full)', { a: m.data.enrolled.length, w: m.data.waitlisted.length, x: m.data.already.length, f: m.data.full.length })}
          </Alert>
        )}
        {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {t('common.done', 'Done')}
          </Button>
          <Button disabled={!picked.length} loading={m.isPending} onClick={() => m.mutate()}>
            {t('courses.enrolN', 'Enrol {{n}}', { n: picked.length })}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function AdminOfferingDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [enrolOpen, setEnrolOpen] = useState(false);
  const q = useQuery({ queryKey: ['offering', id], queryFn: () => api.get<{ offering: Offering; students: EnrolmentRow[] }>(`/institution/offerings/${id}/enrollments`) });
  const drop = useMutation({
    mutationFn: (studentId: number) => api.delete(`/institution/offerings/${id}/enrollments/${studentId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offering', id] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const capacity = useMutation({
    mutationFn: (c: string) => api.patch(`/institution/offerings/${id}`, { capacity: nullIfEmpty(c) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offering', id] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const [cap, setCap] = useState<string | null>(null);
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { offering: o, students } = q.data;
  const active = students.filter((s) => s.status === 'active');
  const waiting = students.filter((s) => s.status === 'waitlisted');
  const open = o.enrollment_mode === 'open';
  return (
    <>
      <PageHeader
        title={
          <span>
            <span className="font-mono text-base text-fg-muted">{o.code}</span> {o.name}
          </span>
        }
        subtitle={[o.term_name, o.section_name ? sectionName({ name: o.section_name, label: o.section_label }) : t('courses.open', 'Open enrolment'), o.staff.map((s) => s.name).join(', ')].filter(Boolean).join(' · ')}
        actions={
          open &&
          can('enrollments.manage') && (
            <Button onClick={() => setEnrolOpen(true)}>
              <UserPlus className="size-4" /> {t('courses.enrol', 'Enrol {{students}}', { students: term('student', true, { lower: true }) })}
            </Button>
          )
        }
      />
      {!open && <Alert tone="info" className="mb-4">{t('courses.wholeClassHelp', 'Everyone in the {{section}} takes this {{course}}. To change who takes it, move students between {{sections}}.', { section: term('section', false, { lower: true }), course: term('course', false, { lower: true }), sections: term('section', true, { lower: true }) })}</Alert>}
      {open && can('structure.manage') && (
        <form
          className="mb-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (cap !== null) capacity.mutate(cap);
          }}
        >
          <label className="text-sm">
            {t('courses.capacity', 'Capacity (open enrolment)')}
            <Input className="mt-1 w-32" type="number" min={1} value={cap ?? (o.capacity ? String(o.capacity) : '')} onChange={(e) => setCap(e.target.value)} placeholder={t('courses.unlimited', 'Unlimited')} />
          </label>
          <Button type="submit" variant="outline" loading={capacity.isPending} disabled={cap === null}>
            {t('common.save', 'Save')}
          </Button>
        </form>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">
            {t('courses.enrolled', 'Enrolled')} <span className="text-fg-muted">({active.length}{o.capacity ? ` / ${o.capacity}` : ''})</span>
          </h2>
          <ul className="divide-y divide-border">
            {active.map((s) => (
              <li key={s.student_id} className="flex items-center justify-between py-2 text-sm">
                <Link to={`/admin/students/${s.student_id}`} className="text-primary hover:underline">
                  {s.first_name} {s.last_name}
                </Link>
                {open && can('enrollments.manage') && (
                  <Button variant="ghost" size="sm" aria-label={t('courses.drop', 'Drop {{name}}', { name: s.first_name })} onClick={() => drop.mutate(s.student_id)}>
                    <UserMinus className="size-4" />
                  </Button>
                )}
              </li>
            ))}
            {active.length === 0 && <li className="py-2 text-sm text-fg-muted">{t('courses.nobody', 'Nobody yet')}</li>}
          </ul>
        </Card>
        {open && (
          <Card className="p-4">
            <h2 className="mb-3 font-semibold">
              {t('courses.waitlist', 'Waitlist')} <span className="text-fg-muted">({waiting.length})</span>
            </h2>
            <p className="mb-2 text-xs text-fg-muted">{t('courses.waitlistHelp', 'When a seat frees up, the first person in the queue takes it automatically.')}</p>
            <ol className="divide-y divide-border">
              {waiting.map((s) => (
                <li key={s.student_id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="me-2 text-fg-muted">{s.waitlist_position}.</span>
                    {s.first_name} {s.last_name}
                  </span>
                  {can('enrollments.manage') && (
                    <Button variant="ghost" size="sm" aria-label={t('courses.remove', 'Remove {{name}}', { name: s.first_name })} onClick={() => drop.mutate(s.student_id)}>
                      <UserMinus className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
              {waiting.length === 0 && <li className="py-2 text-sm text-fg-muted">{t('courses.noQueue', 'No queue')}</li>}
            </ol>
          </Card>
        )}
      </div>
      <EnrolDialog offeringId={Number(id)} open={enrolOpen} onClose={() => setEnrolOpen(false)} />
    </>
  );
}

// Setting up the institution: campuses / branches, departments, programs with their levels in
// order, and academic years with their terms. Labels follow the institution's terminology.
import { useState } from 'react';
import { FormDialog, nullIfEmpty, useFormDialog, type Values } from '@/components/FormDialog';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Building2, CalendarRange, GitBranch, Layers, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useTerms } from '@/lib/terms';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, Skeleton, StatusBadge, Tabs, useToast } from '@/components/ui';
import { useRefreshStructure, useStaffOptions, useStructure, type AcademicYear, type Campus, type Department, type Program } from './structure-data';

// ---------------------------------------------------------------- campuses

function Campuses({ campuses }: { campuses: Campus[] }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const refresh = useRefreshStructure();
  const dlg = useFormDialog();
  const [remove, setRemove] = useState<Campus | null>(null);
  const del = useMutation({
    mutationFn: (c: Campus) => api.delete(`/institution/campuses/${c.id}`),
    onSuccess: () => {
      setRemove(null);
      refresh();
      toast('success', t('structure.moved', 'Moved to the recycle bin'));
    },
  });
  const makeMain = useMutation({ mutationFn: (c: Campus) => api.post(`/institution/campuses/${c.id}/main`), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const manage = can('structure.manage');
  const fields = [
    { name: 'name', label: t('common.name', 'Name') },
    { name: 'code', label: t('common.code', 'Code'), dir: 'ltr' as const, hint: t('structure.codeHint', 'Short and unique, e.g. DHA') },
    { name: 'address', label: t('common.address', 'Address'), optional: true },
    { name: 'phone', label: t('common.phone', 'Phone'), optional: true, dir: 'ltr' as const },
  ];
  const save = (c: Campus | null) => async (v: Values) => {
    if (c) await api.patch(`/institution/campuses/${c.id}`, v);
    else await api.post('/institution/campuses', v);
    refresh();
  };
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">{t('structure.campusesHelp', 'Each {{campus}} has its own {{sections}}, staff and dashboard.', { campus: term('campus', false, { lower: true }), sections: term('section', true, { lower: true }) })}</p>
        {manage && (
          <Button size="sm" onClick={() => dlg.open({ title: t('structure.addCampus', 'Add a {{campus}}', { campus: term('campus', false, { lower: true }) }), initial: { name: '', code: '', address: '', phone: '' }, submit: save(null) })}>
            <Plus className="size-4" /> {t('structure.addCampus', 'Add a {{campus}}', { campus: term('campus', false, { lower: true }) })}
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {campuses.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  <Building2 className="size-4 text-fg-muted" aria-hidden /> {c.name}
                  {c.is_main && <Badge tone="info">{t('structure.main', 'Main')}</Badge>}
                </div>
                <div className="mt-0.5 font-mono text-xs text-fg-muted">{c.code}</div>
                {c.address && <div className="mt-1 text-sm text-fg-muted">{c.address}</div>}
              </div>
              {manage && (
                <div className="flex shrink-0 gap-1">
                  {!c.is_main && (
                    <Button variant="ghost" size="sm" aria-label={t('structure.makeMain', 'Make main')} onClick={() => makeMain.mutate(c)}>
                      <Star className="size-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" aria-label={t('common.edit', 'Edit')} onClick={() => dlg.open({ title: t('common.edit', 'Edit'), initial: { name: c.name, code: c.code, address: c.address, phone: c.phone }, submit: save(c) })}>
                    <Pencil className="size-4" />
                  </Button>
                  {!c.is_main && (
                    <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => setRemove(c)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-4 text-sm">
              <span>
                <strong>{c.sections}</strong> {term('section', c.sections !== 1, { lower: true })}
              </span>
              <span>
                <strong>{c.students}</strong> {term('student', c.students !== 1, { lower: true })}
              </span>
            </div>
          </Card>
        ))}
      </div>
      {dlg.state && <FormDialog open title={dlg.state.title} initial={dlg.state.initial} fields={fields} submitLabel={t('common.save', 'Save')} onSubmit={dlg.state.submit} onClose={dlg.close} />}
      <ConfirmDialog open={!!remove} title={t('structure.deleteCampus', 'Delete {{name}}?', { name: remove?.name })} confirmLabel={t('common.delete', 'Delete')} busy={del.isPending} error={del.error} onConfirm={() => remove && del.mutate(remove)} onClose={() => { setRemove(null); del.reset(); }}>
        {t('structure.deleteCampusHelp', 'It goes to the recycle bin and can be restored. A campus that still has classes cannot be deleted.')}
      </ConfirmDialog>
    </section>
  );
}

// ---------------------------------------------------------------- departments

function Departments({ departments, campuses }: { departments: Department[]; campuses: Campus[] }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const refresh = useRefreshStructure();
  const staff = useStaffOptions();
  const dlg = useFormDialog();
  const [remove, setRemove] = useState<Department | null>(null);
  const del = useMutation({ mutationFn: (d: Department) => api.delete(`/institution/departments/${d.id}`), onSuccess: () => { setRemove(null); refresh(); } });
  const fields = [
    { name: 'name', label: t('common.name', 'Name') },
    { name: 'code', label: t('common.code', 'Code'), dir: 'ltr' as const },
    { name: 'campus_id', label: t('structure.campus', 'Campus'), optional: true, options: [{ value: '', label: t('structure.allCampuses', 'All campuses') }, ...campuses.map((c) => ({ value: String(c.id), label: c.name }))] },
    {
      name: 'head_teacher_id',
      label: t('structure.head', 'Head'),
      optional: true,
      options: [{ value: '', label: '—' }, ...(staff.data ?? []).map((s) => ({ value: String(s.id), label: `${s.first_name} ${s.last_name}` }))],
    },
  ];
  const save = (d: Department | null) => async (v: Values) => {
    const body = { ...v, campus_id: nullIfEmpty(v.campus_id), head_teacher_id: nullIfEmpty(v.head_teacher_id) };
    if (d) await api.patch(`/institution/departments/${d.id}`, body);
    else await api.post('/institution/departments', body);
    refresh();
  };
  return (
    <section>
      <div className="mb-3 flex justify-end">
        {can('structure.manage') && (
          <Button size="sm" onClick={() => dlg.open({ title: t('structure.addDepartment', 'Add a department'), initial: { name: '', code: '', campus_id: '', head_teacher_id: '' }, submit: save(null) })}>
            <Plus className="size-4" /> {t('structure.addDepartment', 'Add a department')}
          </Button>
        )}
      </div>
      {departments.length === 0 ? (
        <EmptyState title={t('structure.noDepartments', 'No departments yet')} description={t('structure.departmentsHelp', 'Group staff and courses into departments or faculties (optional for schools).')} />
      ) : (
        <Card className="divide-y divide-border">
          {departments.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {d.name} <span className="ms-1 font-mono text-xs text-fg-muted">{d.code}</span>
                </div>
                <div className="text-sm text-fg-muted">{d.head_name ? t('structure.headedBy', 'Head: {{name}}', { name: d.head_name }) : t('structure.noHead', 'No head yet')}</div>
              </div>
              {can('structure.manage') && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" aria-label={t('common.edit', 'Edit')} onClick={() => dlg.open({ title: t('common.edit', 'Edit'), initial: { name: d.name, code: d.code, campus_id: d.campus_id ? String(d.campus_id) : '', head_teacher_id: d.head_teacher_id ? String(d.head_teacher_id) : '' }, submit: save(d) })}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => setRemove(d)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      {dlg.state && <FormDialog open title={dlg.state.title} initial={dlg.state.initial} fields={fields} submitLabel={t('common.save', 'Save')} onSubmit={dlg.state.submit} onClose={dlg.close} />}
      <ConfirmDialog open={!!remove} title={t('structure.deleteNamed', 'Delete {{name}}?', { name: remove?.name })} confirmLabel={t('common.delete', 'Delete')} busy={del.isPending} error={del.error} onConfirm={() => remove && del.mutate(remove)} onClose={() => { setRemove(null); del.reset(); }} />
    </section>
  );
}

// ---------------------------------------------------------------- programs & levels

function Programs({ programs, schemes, departments }: { programs: Program[]; schemes: { id: number; name: string; is_default: boolean }[]; departments: Department[] }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const refresh = useRefreshStructure();
  const dlg = useFormDialog();
  const manage = can('structure.manage');
  const fields = [
    { name: 'name', label: t('common.name', 'Name') },
    { name: 'code', label: t('common.code', 'Code'), dir: 'ltr' as const },
    { name: 'department_id', label: t('structure.department', 'Department'), optional: true, options: [{ value: '', label: '—' }, ...departments.map((d) => ({ value: String(d.id), label: d.name }))] },
    {
      name: 'grading_scheme_id',
      label: t('structure.grading', 'Grading scheme'),
      optional: true,
      options: [{ value: '', label: t('structure.defaultScheme', 'Institution default') }, ...schemes.map((s) => ({ value: String(s.id), label: s.name }))],
    },
    { name: 'credits_required', label: t('structure.credits', 'Credits to complete'), optional: true, type: 'number' },
  ];
  const create = async (v: Values & { levels?: string }) => {
    await api.post('/institution/programs', {
      ...v,
      department_id: nullIfEmpty(v.department_id),
      grading_scheme_id: nullIfEmpty(v.grading_scheme_id),
      credits_required: nullIfEmpty(v.credits_required),
      levels: (v.levels ?? '').split(/\n|,/).map((s) => s.trim()).filter(Boolean),
    });
    refresh();
  };
  const update = (p: Program) => async (v: Values) => {
    await api.patch(`/institution/programs/${p.id}`, { ...v, department_id: nullIfEmpty(v.department_id), grading_scheme_id: nullIfEmpty(v.grading_scheme_id), credits_required: nullIfEmpty(v.credits_required) });
    refresh();
  };
  const reorder = useMutation({
    mutationFn: ({ p, ids }: { p: Program; ids: number[] }) => api.put(`/institution/programs/${p.id}/levels/order`, { level_ids: ids }),
    onSuccess: refresh,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const addLevel = useMutation({
    mutationFn: ({ p, name }: { p: Program; name: string }) => api.post(`/institution/programs/${p.id}/levels`, { name }),
    onSuccess: refresh,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const delLevel = useMutation({ mutationFn: (id: number) => api.delete(`/institution/levels/${id}`), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const [newLevel, setNewLevel] = useState<Record<number, string>>({});
  const move = (p: Program, i: number, d: -1 | 1) => {
    const ids = p.levels.map((l) => l.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    reorder.mutate({ p, ids });
  };
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">{t('structure.programsHelp', 'Levels are in promotion order: at year end students move to the next level.')}</p>
        {manage && (
          <Button size="sm" onClick={() => dlg.open({ title: t('structure.addProgram', 'Add a {{program}}', { program: term('program', false, { lower: true }) }), initial: { name: '', code: '', department_id: '', grading_scheme_id: '', credits_required: '', levels: '' }, submit: create })}>
            <Plus className="size-4" /> {t('structure.addProgram', 'Add a {{program}}', { program: term('program', false, { lower: true }) })}
          </Button>
        )}
      </div>
      {programs.length === 0 && <EmptyState title={t('structure.noPrograms', 'Nothing set up yet')} />}
      <div className="grid gap-4 lg:grid-cols-2">
        {programs.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 font-semibold">
                  <Layers className="size-4 text-fg-muted" aria-hidden /> {p.name}
                </div>
                <div className="font-mono text-xs text-fg-muted">{p.code}</div>
              </div>
              {manage && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('common.edit', 'Edit')}
                  onClick={() =>
                    dlg.open({
                      title: t('common.edit', 'Edit'),
                      initial: { name: p.name, code: p.code, department_id: p.department_id ? String(p.department_id) : '', grading_scheme_id: p.grading_scheme_id ? String(p.grading_scheme_id) : '', credits_required: p.credits_required ?? '' },
                      submit: update(p),
                    })
                  }
                >
                  <Pencil className="size-4" />
                </Button>
              )}
            </div>
            <ol className="mt-3 space-y-1">
              {p.levels.map((l, i) => (
                <li key={l.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm">
                  <span>
                    <span className="me-2 text-xs text-fg-muted">{i + 1}.</span>
                    {l.name}
                    {l.sections > 0 && <span className="ms-2 text-xs text-fg-muted">({l.sections} {term('section', l.sections !== 1, { lower: true })})</span>}
                  </span>
                  {manage && (
                    <span className="flex gap-0.5">
                      <Button variant="ghost" size="sm" disabled={i === 0} aria-label={t('structure.moveUp', 'Move up')} onClick={() => move(p, i, -1)}>
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={i === p.levels.length - 1} aria-label={t('structure.moveDown', 'Move down')} onClick={() => move(p, i, 1)}>
                        <ArrowDown className="size-3.5" />
                      </Button>
                      {l.sections === 0 && (
                        <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => delLevel.mutate(l.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {manage && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = (newLevel[p.id] ?? '').trim();
                  if (name) addLevel.mutate({ p, name }, { onSuccess: () => setNewLevel({ ...newLevel, [p.id]: '' }) });
                }}
              >
                <Input value={newLevel[p.id] ?? ''} onChange={(e) => setNewLevel({ ...newLevel, [p.id]: e.target.value })} placeholder={t('structure.newLevel', 'Add a {{level}}…', { level: term('level', false, { lower: true }) })} aria-label={t('structure.newLevel', 'Add a {{level}}…', { level: term('level', false, { lower: true }) })} />
                <Button type="submit" variant="outline" loading={addLevel.isPending && addLevel.variables?.p.id === p.id}>
                  <Plus className="size-4" />
                </Button>
              </form>
            )}
          </Card>
        ))}
      </div>
      {dlg.state && (
        <FormDialog
          open
          title={dlg.state.title}
          initial={dlg.state.initial}
          fields={'levels' in dlg.state.initial ? [...fields, { name: 'levels', label: t('structure.levels', '{{levels}} in order (one per line or comma-separated)', { levels: term('level', true) }), optional: true }] : fields}
          submitLabel={t('common.save', 'Save')}
          onSubmit={dlg.state.submit}
          onClose={dlg.close}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- academic years & terms

function Years({ years }: { years: AcademicYear[] }) {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const refresh = useRefreshStructure();
  const dlg = useFormDialog();
  const manage = can('structure.manage');
  const makeCurrent = useMutation({ mutationFn: (y: AcademicYear) => api.patch(`/institution/academic-years/${y.id}`, { is_current: true }), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const delTerm = useMutation({ mutationFn: (id: number) => api.delete(`/institution/terms/${id}`), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const yearFields = [
    { name: 'name', label: t('common.name', 'Name'), hint: '2027–28' },
    { name: 'starts_on', label: t('common.starts', 'Starts'), type: 'date' },
    { name: 'ends_on', label: t('common.ends', 'Ends'), type: 'date' },
  ];
  const termFields = [
    { name: 'name', label: t('common.name', 'Name') },
    { name: 'kind', label: t('structure.kind', 'Kind'), options: ['annual', 'semester', 'trimester', 'quarter', 'rolling', 'custom'].map((k) => ({ value: k, label: t(`termKind.${k}`, k) })) },
    { name: 'starts_on', label: t('common.starts', 'Starts'), type: 'date' },
    { name: 'ends_on', label: t('common.ends', 'Ends'), type: 'date', optional: true, hint: t('structure.rollingHint', 'Leave empty for rolling / self-paced') },
  ];
  return (
    <section>
      <div className="mb-3 flex justify-end">
        {manage && (
          <Button
            size="sm"
            onClick={() =>
              dlg.open({
                title: t('structure.addYear', 'Add an {{year}}', { year: term('academicYear', false, { lower: true }) }),
                initial: { name: '', starts_on: '', ends_on: '' },
                submit: async (v) => {
                  await api.post('/institution/academic-years', v);
                  refresh();
                },
              })
            }
          >
            <Plus className="size-4" /> {t('structure.addYear', 'Add an {{year}}', { year: term('academicYear', false, { lower: true }) })}
          </Button>
        )}
      </div>
      <div className="space-y-3">
        {years.map((y) => (
          <Card key={y.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CalendarRange className="size-4 text-fg-muted" aria-hidden />
                <span className="font-semibold">{y.name}</span>
                <span className="text-sm text-fg-muted">
                  {formatDate(y.starts_on)} – {formatDate(y.ends_on)}
                </span>
                {y.is_current && <Badge tone="success">{t('structure.current', 'Current')}</Badge>}
                {y.status === 'archived' && <StatusBadge value="inactive" label={t('structure.archived', 'Archived · read-only')} />}
              </div>
              {manage && y.status !== 'archived' && (
                <div className="flex gap-1">
                  {!y.is_current && (
                    <Button variant="outline" size="sm" loading={makeCurrent.isPending} onClick={() => makeCurrent.mutate(y)}>
                      {t('structure.makeCurrent', 'Make current')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      dlg.open({
                        title: t('structure.addTerm', 'Add a {{term}}', { term: term('term', false, { lower: true }) }),
                        initial: { name: '', kind: y.terms[0]?.kind ?? 'semester', starts_on: '', ends_on: '' },
                        submit: async (v) => {
                          await api.post(`/institution/academic-years/${y.id}/terms`, { ...v, ends_on: nullIfEmpty(v.ends_on) });
                          refresh();
                        },
                      })
                    }
                  >
                    <Plus className="size-4" /> {term('term')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('common.edit', 'Edit')}
                    onClick={() =>
                      dlg.open({
                        title: t('common.edit', 'Edit'),
                        initial: { name: y.name, starts_on: y.starts_on, ends_on: y.ends_on },
                        submit: async (v) => {
                          await api.patch(`/institution/academic-years/${y.id}`, v);
                          refresh();
                        },
                      })
                    }
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              )}
            </div>
            {y.terms.length > 0 && (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {y.terms.map((tm) => (
                  <li key={tm.id} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{tm.name}</span>
                      {manage && tm.status !== 'archived' && (
                        <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => delTerm.mutate(tm.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted">
                      {formatDate(tm.starts_on)} – {tm.ends_on ? formatDate(tm.ends_on) : t('structure.rolling', 'rolling')} · {t(`termKind.${tm.kind}`, tm.kind)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      {dlg.state && (
        <FormDialog
          open
          title={dlg.state.title}
          initial={dlg.state.initial}
          fields={'kind' in dlg.state.initial ? termFields : yearFields}
          submitLabel={t('common.save', 'Save')}
          onSubmit={dlg.state.submit}
          onClose={dlg.close}
        />
      )}
    </section>
  );
}

export function AdminStructure() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const s = useStructure();
  return (
    <>
      <PageHeader title={t('nav.structure', 'Structure')} subtitle={t('structure.subtitle', 'How your institution is organised')} />
      {s.isPending ? (
        <Skeleton className="h-64" />
      ) : s.error ? (
        <ErrorState error={s.error} onRetry={() => s.refetch()} />
      ) : (
        <Tabs
          tabs={[
            { id: 'campuses', label: <><Building2 className="me-1.5 inline size-4" aria-hidden />{term('campus', true)}</>, content: () => <Campuses campuses={s.data.campuses} /> },
            { id: 'programs', label: <><Layers className="me-1.5 inline size-4" aria-hidden />{term('program', true)}</>, content: () => <Programs programs={s.data.programs} schemes={s.data.grading_schemes} departments={s.data.departments} /> },
            { id: 'departments', label: <><GitBranch className="me-1.5 inline size-4" aria-hidden />{term('department', true)}</>, content: () => <Departments departments={s.data.departments} campuses={s.data.campuses} /> },
            { id: 'years', label: <><CalendarRange className="me-1.5 inline size-4" aria-hidden />{term('academicYear', true)}</>, content: () => <Years years={s.data.academic_years} /> },
          ]}
        />
      )}
      {s.data && s.data.academic_years.length === 0 && <Alert tone="warning" className="mt-4">{t('structure.noYear', 'Add an academic year so classes and attendance have a calendar.')}</Alert>}
    </>
  );
}

// Outcome-based education: program outcomes and the CLO → PLO matrix (academic office),
// course outcomes with alignment and class attainment (teachers), program attainment and the
// accreditation report.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Select, Spinner, Tabs, Textarea, useToast } from '@/components/ui';
import { DownloadButton, useInvalidate, useStructure } from './common';

interface Outcome {
  id: number;
  level: 'program' | 'course';
  program_id: number | null;
  course_id: number | null;
  code: string;
  description: string;
  bloom_level: string | null;
  pass_percent: string;
  target_percent: string;
  course: string | null;
}
interface Attainment {
  outcome_id: number;
  code: string;
  description: string;
  students: number;
  attained: number;
  attainment_percent: number | null;
  average_percent: number | null;
  target_percent: number;
  met: boolean | null;
}

const BLOOM = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

export function OutcomesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title={t('nav.outcomes', 'Learning outcomes')} subtitle={t('obe.subtitle', 'CLOs, PLOs, mapping and attainment (OBE)')} />
      <Tabs
        tabs={[
          { id: 'course', label: t('obe.courseOutcomes', 'Course outcomes'), content: () => <CourseTab /> },
          { id: 'program', label: t('obe.programOutcomes', 'Program outcomes'), content: () => <ProgramTab />, hidden: !can('outcomes.manage') && !can('academics.read') },
        ]}
      />
    </>
  );
}

function OutcomeDialog({ level, ownerId, outcome, onClose }: { level: 'program' | 'course'; ownerId: number; outcome?: Outcome; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [v, setV] = useState({ code: outcome?.code ?? '', description: outcome?.description ?? '', bloom_level: outcome?.bloom_level ?? '', pass_percent: outcome?.pass_percent ?? '50', target_percent: outcome?.target_percent ?? '70' });
  const m = useMutation({
    mutationFn: () => {
      const body = { code: v.code, description: v.description, bloom_level: v.bloom_level || null, pass_percent: Number(v.pass_percent), target_percent: Number(v.target_percent) };
      return outcome ? api.patch(`/outcomes/${outcome.id}`, body) : api.post('/outcomes', { ...body, level, [level === 'program' ? 'program_id' : 'course_id']: ownerId });
    },
    onSuccess: async () => { await invalidate('/outcomes'); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={outcome ? outcome.code : level === 'program' ? t('obe.newPlo', 'New program outcome') : t('obe.newClo', 'New course outcome')}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label={t('obe.code', 'Code')}>{(a) => <Input {...a} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder={level === 'program' ? 'PLO1' : 'CLO1'} />}</Field>
          <Field label={t('obe.bloom', 'Bloom level')} optional>
            {(a) => <Select {...a} value={v.bloom_level} onChange={(e) => setV({ ...v, bloom_level: e.target.value })}><option value="">—</option>{BLOOM.map((b) => <option key={b} value={b}>{b}</option>)}</Select>}
          </Field>
        </div>
        <Field label={t('obe.statement', 'Students will be able to…')}>{(a) => <Textarea {...a} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('obe.passPercent', 'A student attains it at (%)')}>{(a) => <Input {...a} type="number" value={v.pass_percent} onChange={(e) => setV({ ...v, pass_percent: e.target.value })} />}</Field>
          <Field label={t('obe.targetPercent', 'Target: share of students (%)')}>{(a) => <Input {...a} type="number" value={v.target_percent} onChange={(e) => setV({ ...v, target_percent: e.target.value })} />}</Field>
        </div>
        <MutationError error={m.error} />
        <div className="flex justify-end"><Button loading={m.isPending} disabled={!v.code || !v.description} onClick={() => m.mutate()}>{t('common.save', 'Save')}</Button></div>
      </div>
    </Dialog>
  );
}

function OutcomeList({ items, onEdit, onDelete, canEdit }: { items: Outcome[]; onEdit: (o: Outcome) => void; onDelete: (o: Outcome) => void; canEdit: boolean }) {
  const { t } = useTranslation();
  if (!items.length) return <EmptyState title={t('obe.none', 'No outcomes yet')} />;
  return (
    <ul className="divide-y divide-border">
      {items.map((o) => (
        <li key={o.id} className="flex items-start justify-between gap-3 py-2 text-sm">
          <div>
            <span className="font-semibold">{o.code}</span> {o.bloom_level && <Badge className="ms-1">{o.bloom_level}</Badge>}
            <p className="text-fg-muted">{o.description}</p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => onEdit(o)}>{t('common.edit', 'Edit')}</Button>
              <Button size="icon" variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => onDelete(o)}><Trash2 className="size-4" /></Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function AttainmentTable({ rows }: { rows: Attainment[] | undefined }) {
  const { t } = useTranslation();
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.outcome_id}
      empty={t('obe.noData', 'Nothing measured yet — align work to the outcomes and grade it')}
      columns={[
        { key: 'code', header: t('obe.code', 'Code'), cell: (r) => <span className="font-semibold">{r.code}</span> },
        { key: 'desc', header: t('obe.outcome', 'Outcome'), cell: (r) => <span className="text-sm">{r.description}</span>, hideOnMobile: true },
        { key: 'avg', header: t('obe.average', 'Average'), cell: (r) => (r.average_percent == null ? '—' : `${r.average_percent}%`) },
        { key: 'att', header: t('obe.attained', 'Attained'), cell: (r) => (r.attainment_percent == null ? '—' : `${r.attained}/${r.students} (${r.attainment_percent}%)`) },
        { key: 'met', header: t('obe.target', 'Target'), cell: (r) => (r.met == null ? `${r.target_percent}%` : <Badge tone={r.met ? 'success' : 'danger'}>{r.met ? t('obe.met', 'Met') : t('obe.notMet', 'Not met')} · {r.target_percent}%</Badge>) },
      ]}
    />
  );
}

function CourseTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const invalidate = useInvalidate();
  const classes = useQuery({ queryKey: ['/courses', 'obe'], queryFn: () => api.all<{ id: number; course_id: number; code: string | null; name: string; section_name: string | null }>('/courses') });
  const [offering, setOffering] = useState<number | ''>('');
  const cls = classes.data?.find((c) => c.id === offering);
  const clos = useQuery({ queryKey: ['/outcomes', 'course', cls?.course_id], queryFn: () => api.get<Outcome[]>('/outcomes', { course_id: cls!.course_id }), enabled: !!cls });
  const work = useQuery({ queryKey: ['/courses/assessments', offering], queryFn: () => api.get<{ id: number; title: string; kind: string; points: string }[]>(`/courses/${offering}/assessments`), enabled: !!offering });
  const aligned = useQuery({ queryKey: ['/outcomes/alignments', offering], queryFn: () => api.get<{ clo_id: number; target_type: string; target_id: number }[]>('/outcomes/alignments', { offering_id: offering }), enabled: !!offering });
  const att = useQuery({ queryKey: ['/outcomes/attainment', offering], queryFn: () => api.get<{ clos: Attainment[] }>(`/outcomes/attainment/offering/${offering}`), enabled: !!offering });
  const [dlg, setDlg] = useState<Outcome | 'new' | null>(null);
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/outcomes/${id}`), onSuccess: () => invalidate('/outcomes') });
  const align = useMutation({
    mutationFn: ({ target, cloIds }: { target: number; cloIds: number[] }) => api.put('/outcomes/alignments', { target_type: 'assessment', target_id: target, clo_ids: cloIds }),
    onSuccess: async () => { await invalidate('/outcomes'); toast('success', t('common.saved', 'Saved')); },
  });
  const cloIdsFor = (target: number) => (aligned.data ?? []).filter((a) => a.target_type === 'assessment' && a.target_id === target).map((a) => a.clo_id);
  return (
    <div className="space-y-4">
      <Field label={t('obe.pickClass', 'Course and class')}>
        {(a) => (
          <Select {...a} value={offering} onChange={(e) => setOffering(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{t('common.choose', 'Choose…')}</option>
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.code ? `${c.code} ` : ''}{c.name}{c.section_name ? ` · ${c.section_name}` : ''}</option>)}
          </Select>
        )}
      </Field>
      {!cls ? (
        <EmptyState title={t('obe.pickHelp', 'Pick one of your classes to set and measure its outcomes')} />
      ) : (
        <>
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">{t('obe.closFor', 'Outcomes of {{course}}', { course: cls.name })}</h3>
              <Button size="sm" onClick={() => setDlg('new')}><Plus className="size-4" /> {t('obe.addClo', 'Add CLO')}</Button>
            </div>
            {clos.error ? <ErrorState error={clos.error} /> : !clos.data ? <Spinner /> : <OutcomeList items={clos.data} canEdit onEdit={(o) => setDlg(o)} onDelete={(o) => remove.mutate(o.id)} />}
          </Card>
          {clos.data && clos.data.length > 0 && (
            <Card className="overflow-x-auto p-4">
              <h3 className="mb-1 font-semibold">{t('obe.alignment', 'What measures each outcome')}</h3>
              <p className="mb-3 text-sm text-fg-muted">{t('obe.alignmentHelp', 'Tick the outcomes each piece of work measures. Questions, rubric criteria and paper exams can be aligned too.')}</p>
              {work.data?.length === 0 ? <EmptyState title={t('obe.noWork', 'No assessments in this class yet')} /> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-fg-muted"><th className="py-1 text-start">{t('obe.work', 'Work')}</th>{clos.data.map((c) => <th key={c.id} className="px-2 py-1">{c.code}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border">
                    {work.data?.map((w) => {
                      const ids = cloIdsFor(w.id);
                      return (
                        <tr key={w.id}>
                          <td className="py-1.5">{w.title} <span className="text-fg-muted">({w.kind}, {Number(w.points)})</span></td>
                          {clos.data!.map((c) => (
                            <td key={c.id} className="px-2 text-center">
                              <input type="checkbox" aria-label={`${w.title} → ${c.code}`} checked={ids.includes(c.id)} onChange={(e) => align.mutate({ target: w.id, cloIds: e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id) })} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <MutationError error={align.error} />
            </Card>
          )}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t('obe.classAttainment', 'Attainment in this class')}</h3>
            <DownloadButton path={`/outcomes/attainment/offering/${offering}?format=xlsx`} filename="clo-attainment.xlsx">Excel</DownloadButton>
          </div>
          {att.error ? <ErrorState error={att.error} /> : <AttainmentTable rows={att.data?.clos} />}
        </>
      )}
      {dlg && cls && <OutcomeDialog level="course" ownerId={cls.course_id} outcome={dlg === 'new' ? undefined : dlg} onClose={() => setDlg(null)} />}
    </div>
  );
}

function ProgramTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const structure = useStructure();
  const [program, setProgram] = useState<number | ''>('');
  const plos = useQuery({ queryKey: ['/outcomes', 'program', program], queryFn: () => api.get<Outcome[]>('/outcomes', { program_id: program }), enabled: !!program });
  const matrix = useQuery({ queryKey: ['/outcomes/matrix', program], queryFn: () => api.get<{ plos: Outcome[]; clos: (Outcome & { course: string })[]; mappings: { clo_id: number; plo_id: number; strength: number }[] }>('/outcomes/matrix', { program_id: program }), enabled: !!program });
  const att = useQuery({ queryKey: ['/outcomes/attainment/program', program], queryFn: () => api.get<{ plos: Attainment[] }>(`/outcomes/attainment/program/${program}`), enabled: !!program });
  const [edits, setEdits] = useState<Record<string, number> | null>(null);
  const [dlg, setDlg] = useState<Outcome | 'new' | null>(null);
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/outcomes/${id}`), onSuccess: () => invalidate('/outcomes') });
  const cell = (clo: number, plo: number) => edits?.[`${clo}:${plo}`] ?? matrix.data?.mappings.find((m) => m.clo_id === clo && m.plo_id === plo)?.strength ?? 0;
  const save = useMutation({
    mutationFn: () => {
      const all = new Map<string, number>();
      for (const m of matrix.data!.mappings) all.set(`${m.clo_id}:${m.plo_id}`, m.strength);
      for (const [k, v] of Object.entries(edits ?? {})) all.set(k, v);
      const mappings = [...all.entries()].filter(([, s]) => s > 0).map(([k, s]) => ({ clo_id: Number(k.split(':')[0]), plo_id: Number(k.split(':')[1]), strength: s }));
      return api.put(`/outcomes/matrix?program_id=${program}`, { mappings });
    },
    onSuccess: async () => { setEdits(null); await invalidate('/outcomes'); toast('success', t('common.saved', 'Saved')); },
  });
  return (
    <div className="space-y-4">
      <Field label={t('common.program', 'Program')}>
        {(a) => (
          <Select {...a} value={program} onChange={(e) => { setProgram(e.target.value ? Number(e.target.value) : ''); setEdits(null); }}>
            <option value="">{t('common.choose', 'Choose…')}</option>
            {structure.data?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
      </Field>
      {!program ? <EmptyState title={t('obe.pickProgram', 'Pick a program')} /> : (
        <>
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">{t('obe.programOutcomes', 'Program outcomes')}</h3>
              {can('outcomes.manage') && <Button size="sm" onClick={() => setDlg('new')}><Plus className="size-4" /> {t('obe.addPlo', 'Add PLO')}</Button>}
            </div>
            {plos.error ? <ErrorState error={plos.error} /> : !plos.data ? <Spinner /> : <OutcomeList items={plos.data} canEdit={can('outcomes.manage')} onEdit={(o) => setDlg(o)} onDelete={(o) => remove.mutate(o.id)} />}
          </Card>
          {matrix.data && matrix.data.plos.length > 0 && (
            <Card className="overflow-x-auto p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-semibold">{t('obe.matrix', 'CLO → PLO mapping (0 none, 1 low, 2 medium, 3 high)')}</h3>
                {can('outcomes.manage') && <Button size="sm" disabled={!edits} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>}
              </div>
              {matrix.data.clos.length === 0 ? <Alert>{t('obe.noClos', 'No course outcomes yet in the courses of this program.')}</Alert> : (
                <table className="text-sm">
                  <thead><tr className="text-xs text-fg-muted"><th className="py-1 pe-3 text-start">CLO</th>{matrix.data.plos.map((p) => <th key={p.id} className="px-2 py-1">{p.code}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border">
                    {matrix.data.clos.map((c) => (
                      <tr key={c.id}>
                        <td className="py-1 pe-3"><span className="font-medium">{c.course}</span> · {c.code}</td>
                        {matrix.data!.plos.map((p) => (
                          <td key={p.id} className="px-1">
                            <Select aria-label={`${c.code} → ${p.code}`} className="h-8 w-14 px-1" disabled={!can('outcomes.manage')} value={cell(c.id, p.id)} onChange={(e) => setEdits({ ...(edits ?? {}), [`${c.id}:${p.id}`]: Number(e.target.value) })}>
                              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n || '·'}</option>)}
                            </Select>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <MutationError error={save.error} />
            </Card>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{t('obe.programAttainment', 'Program attainment')}</h3>
            <div className="flex gap-2">
              <DownloadButton path={`/outcomes/report/${program}`} filename="obe-report.xlsx">Excel</DownloadButton>
              <DownloadButton path={`/outcomes/report/${program}?format=pdf`} filename="obe-report.pdf">PDF</DownloadButton>
            </div>
          </div>
          {att.error ? <ErrorState error={att.error} /> : <AttainmentTable rows={att.data?.plos} />}
        </>
      )}
      {dlg && program && <OutcomeDialog level="program" ownerId={program} outcome={dlg === 'new' ? undefined : dlg} onClose={() => setDlg(null)} />}
    </div>
  );
}

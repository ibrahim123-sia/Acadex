// Exams: the office (series, date sheet, seating, invigilation, admit cards, results and
// publishing), marks entry and approvals for teachers / heads of department / the
// controller, and the student's and family's exams page (papers, admit cards, results,
// transcript, skills).
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarRange, CheckCircle2, Plus, Send, Undo2, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, todayISO } from '@/lib/format';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Select, Spinner, Tabs, Textarea, useToast } from '@/components/ui';
import { DownloadButton, useInvalidate, useSections, useStructure } from './common';

interface Series {
  id: number;
  name: string;
  kind: string;
  result_style: 'board' | 'university';
  status: string;
  term: string | null;
  papers: number;
  approved: number;
  starts_on: string | null;
  ends_on: string | null;
  eligibility: { attendance: boolean; fees: boolean };
  instructions: string;
}

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success'> = { planning: 'neutral', scheduled: 'info', in_progress: 'info', marking: 'warning', published: 'success' };
const PAPER_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success'> = { scheduled: 'neutral', marks_entry: 'info', submitted: 'warning', hod_approved: 'warning', approved: 'success' };

function usePaperLabels() {
  const { t } = useTranslation();
  return {
    scheduled: t('exams.paperScheduled', 'Scheduled'),
    marks_entry: t('exams.marksEntry', 'Marks entry'),
    submitted: t('exams.submitted', 'Submitted'),
    hod_approved: t('exams.hodApproved', 'HOD approved'),
    approved: t('exams.approved', 'Approved'),
  } as Record<string, string>;
}

export function ExamsOfficePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['/exams/series'], queryFn: () => api.get<Series[]>('/exams/series') });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title={t('nav.examsOffice', 'Exams office')}
        subtitle={t('exams.officeSubtitle', 'Date sheets, seating, admit cards, marks and results')}
        actions={can('exams.manage') && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> {t('exams.newSeries', 'New exam series')}</Button>}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Spinner />
      ) : q.data.length === 0 ? (
        <EmptyState title={t('exams.noSeries', 'No exam series yet')} description={t('exams.noSeriesHelp', 'Create one (e.g. "Mid-term examinations") and lay out its date sheet.')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((s) => (
            <Link key={s.id} to={`/exams/office/${s.id}`}>
              <Card className="h-full p-5 transition hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{s.name}</h3>
                  <Badge tone={STATUS_TONE[s.status]}>{s.status.replace('_', ' ')}</Badge>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{s.starts_on ? `${formatDate(s.starts_on)} – ${formatDate(s.ends_on)}` : t('exams.noDates', 'No papers yet')}</p>
                <p className="mt-2 text-sm">{t('exams.papersApproved', '{{approved}} of {{papers}} papers approved', { approved: s.approved, papers: s.papers })}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {creating && <SeriesDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function SeriesDialog({ series, onClose }: { series?: Series; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const structure = useStructure();
  const terms = structure.data?.academic_years.flatMap((y) => y.terms.map((tm) => ({ ...tm, year: y.name }))) ?? [];
  const [v, setV] = useState({
    name: series?.name ?? '',
    kind: series?.kind ?? 'final',
    result_style: series?.result_style ?? 'board',
    term_id: '' as string,
    attendance: series?.eligibility.attendance ?? true,
    fees: series?.eligibility.fees ?? false,
    instructions: series?.instructions ?? '',
  });
  const m = useMutation({
    mutationFn: () => {
      const body = { name: v.name, kind: v.kind, result_style: v.result_style, term_id: v.term_id || null, eligibility: { attendance: v.attendance, fees: v.fees }, instructions: v.instructions };
      return series ? api.patch(`/exams/series/${series.id}`, body) : api.post('/exams/series', body);
    },
    onSuccess: async () => { await invalidate('/exams'); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={series ? series.name : t('exams.newSeries', 'New exam series')}>
      <div className="space-y-4">
        <Field label={t('common.name', 'Name')}>{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('exams.nameExample', 'e.g. Mid-term examinations, October 2026')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('exams.kind', 'Kind')}>
            {(a) => (
              <Select {...a} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
                {['midterm', 'final', 'monthly', 'board', 'supplementary', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('exams.resultStyle', 'Result style')}>
            {(a) => (
              <Select {...a} value={v.result_style} onChange={(e) => setV({ ...v, result_style: e.target.value as 'board' })}>
                <option value="board">{t('exams.board', 'Result card with positions')}</option>
                <option value="university">{t('exams.university', 'Grade sheet with SGPA')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('common.term', 'Term')} optional>
            {(a) => (
              <Select {...a} value={v.term_id} onChange={(e) => setV({ ...v, term_id: e.target.value })}>
                <option value="">—</option>
                {terms.map((tm) => <option key={tm.id} value={tm.id}>{tm.year} · {tm.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium">{t('exams.eligibility', 'Who gets an admit card')}</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.attendance} onChange={(e) => setV({ ...v, attendance: e.target.checked })} /> {t('exams.eligAttendance', 'Attendance at or above the threshold')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.fees} onChange={(e) => setV({ ...v, fees: e.target.checked })} /> {t('exams.eligFees', 'No overdue fees')}</label>
        </fieldset>
        <Field label={t('exams.instructions', 'Instructions on the admit card')} optional>{(a) => <Textarea {...a} value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} />}</Field>
        <MutationError error={m.error} />
        <div className="flex justify-end"><Button loading={m.isPending} disabled={!v.name} onClick={() => m.mutate()}>{t('common.save', 'Save')}</Button></div>
      </div>
    </Dialog>
  );
}

interface Paper {
  id: number;
  offering_id: number;
  course: string;
  code: string | null;
  section_name: string | null;
  date: string;
  starts_at: string;
  ends_at: string;
  total_marks: string;
  pass_marks: string;
  status: string;
  marks_entered: number;
  candidates: number;
  seated: number;
  invigilators: number;
}

export function SeriesPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { can } = useAuth();
  const q = useQuery({ queryKey: [`/exams/series/${id}`], queryFn: () => api.get<Series & { sessions: Paper[] }>(`/exams/series/${id}`) });
  const [editing, setEditing] = useState(false);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner className="h-full" />;
  const s = q.data;
  return (
    <>
      <Link to="/exams/office" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> {t('nav.examsOffice', 'Exams office')}</Link>
      <PageHeader
        title={s.name}
        subtitle={<Badge tone={STATUS_TONE[s.status]}>{s.status.replace('_', ' ')}</Badge>}
        actions={can('exams.manage') && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{t('common.edit', 'Edit')}</Button>}
      />
      <Tabs
        tabs={[
          { id: 'papers', label: t('exams.papers', 'Date sheet'), content: () => <PapersTab s={s} /> },
          { id: 'seating', label: t('exams.seating', 'Seating'), content: () => <SeatingTab s={s} />, hidden: !can('exams.manage') && !can('academics.read') },
          { id: 'duties', label: t('exams.invigilation', 'Invigilation'), content: () => <DutiesTab s={s} /> },
          { id: 'admit', label: t('exams.admitCards', 'Admit cards'), content: () => <AdmitTab s={s} /> },
          { id: 'results', label: t('exams.results', 'Results'), content: () => <ResultsTab s={s} /> },
        ]}
      />
      {editing && <SeriesDialog series={s} onClose={() => setEditing(false)} />}
    </>
  );
}

function PapersTab({ s }: { s: Series & { sessions: Paper[] } }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const labels = usePaperLabels();
  const [gen, setGen] = useState(false);
  return (
    <div className="space-y-4">
      {can('exams.manage') && s.status !== 'published' && (
        <div className="flex justify-end">
          <Button onClick={() => setGen(true)}><Wand2 className="size-4" /> {t('exams.layOut', 'Lay out a date sheet')}</Button>
        </div>
      )}
      <DataTable
        rows={s.sessions}
        rowKey={(p) => p.id}
        empty={t('exams.noPapers', 'No papers yet')}
        columns={[
          { key: 'date', header: t('common.date', 'Date'), cell: (p) => <span>{formatDate(p.date)} <span className="text-fg-muted">{p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)}</span></span> },
          { key: 'course', header: t('common.course', 'Course'), cell: (p) => <span className="font-medium">{p.course}</span> },
          { key: 'class', header: t('common.class', 'Class'), cell: (p) => p.section_name ?? '—', hideOnMobile: true },
          { key: 'marks', header: t('exams.totalPass', 'Total / pass'), cell: (p) => `${Number(p.total_marks)} / ${Number(p.pass_marks)}`, hideOnMobile: true },
          { key: 'cands', header: t('exams.candidates', 'Candidates'), cell: (p) => `${p.candidates} · ${t('exams.seatedN', '{{n}} seated', { n: p.seated })}`, hideOnMobile: true },
          { key: 'status', header: t('common.status', 'Status'), cell: (p) => <Link to={`/exams/marks/${p.id}`}><Badge tone={PAPER_TONE[p.status]}>{labels[p.status]}</Badge></Link> },
        ]}
      />
      {gen && <DateSheetDialog seriesId={s.id} onClose={() => setGen(false)} />}
    </div>
  );
}

function DateSheetDialog({ seriesId, onClose }: { seriesId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const sections = useSections();
  const [picked, setPicked] = useState<number[]>([]);
  const [v, setV] = useState({ from: todayISO(), starts_at: '09:00', ends_at: '12:00', second: false, starts2: '13:00', ends2: '15:00', gap_days: '0', total_marks: '100', pass_marks: '33' });
  const body = (commit: boolean) => ({
    section_ids: picked,
    from: v.from,
    slots: [{ starts_at: v.starts_at, ends_at: v.ends_at }, ...(v.second ? [{ starts_at: v.starts2, ends_at: v.ends2 }] : [])],
    days_off: [0],
    gap_days: Number(v.gap_days),
    total_marks: Number(v.total_marks),
    pass_marks: Number(v.pass_marks),
    commit,
  });
  const preview = useMutation({ mutationFn: () => api.post<{ papers: number; plan: { course: string; date: string; starts_at: string; section_id: number }[] }>(`/exams/series/${seriesId}/timetable`, body(false)) });
  const commit = useMutation({ mutationFn: () => api.post(`/exams/series/${seriesId}/timetable`, body(true)), onSuccess: async () => { await invalidate('/exams'); onClose(); } });
  return (
    <Dialog open onClose={onClose} title={t('exams.layOut', 'Lay out a date sheet')} description={t('exams.layOutHelp', 'One paper a day for each class; a course shared by several classes is on the same day. Sundays and holidays are skipped.')} className="max-w-2xl">
      <div className="space-y-4">
        <Field label={t('common.classes', 'Classes')}>
          {() => (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {sections.data?.map((sec) => (
                <label key={sec.id} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm">
                  <input type="checkbox" checked={picked.includes(sec.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, sec.id] : picked.filter((x) => x !== sec.id))} />
                  {sec.name} {sec.label}
                </label>
              ))}
            </div>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('exams.startOn', 'Start on')}>{(a) => <Input {...a} type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />}</Field>
          <Field label={t('exams.from', 'From')}>{(a) => <Input {...a} type="time" value={v.starts_at} onChange={(e) => setV({ ...v, starts_at: e.target.value })} />}</Field>
          <Field label={t('exams.until', 'Until')}>{(a) => <Input {...a} type="time" value={v.ends_at} onChange={(e) => setV({ ...v, ends_at: e.target.value })} />}</Field>
          <Field label={t('exams.gapDays', 'Days between papers')}>{(a) => <Input {...a} type="number" min={0} max={5} value={v.gap_days} onChange={(e) => setV({ ...v, gap_days: e.target.value })} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.second} onChange={(e) => setV({ ...v, second: e.target.checked })} /> {t('exams.secondSitting', 'A second sitting each day')}</label>
        {v.second && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('exams.from', 'From')}>{(a) => <Input {...a} type="time" value={v.starts2} onChange={(e) => setV({ ...v, starts2: e.target.value })} />}</Field>
            <Field label={t('exams.until', 'Until')}>{(a) => <Input {...a} type="time" value={v.ends2} onChange={(e) => setV({ ...v, ends2: e.target.value })} />}</Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('exams.totalMarks', 'Total marks')}>{(a) => <Input {...a} type="number" value={v.total_marks} onChange={(e) => setV({ ...v, total_marks: e.target.value })} />}</Field>
          <Field label={t('exams.passMarks', 'Pass marks')}>{(a) => <Input {...a} type="number" value={v.pass_marks} onChange={(e) => setV({ ...v, pass_marks: e.target.value })} />}</Field>
        </div>
        {preview.data && (
          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded border border-border text-sm">
            {preview.data.plan.map((p, i) => <li key={i} className="flex justify-between px-3 py-1.5"><span>{p.course}</span><span className="text-fg-muted">{formatDate(p.date)} {p.starts_at}</span></li>)}
          </ul>
        )}
        <MutationError error={preview.error ?? commit.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={!picked.length} loading={preview.isPending} onClick={() => preview.mutate()}><CalendarRange className="size-4" /> {t('exams.preview', 'Preview')}</Button>
          <Button disabled={!preview.data?.papers} loading={commit.isPending} onClick={() => commit.mutate()}>{t('exams.createPapers', 'Create {{n}} papers', { n: preview.data?.papers ?? 0 })}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function SeatingTab({ s }: { s: Series & { sessions: Paper[] } }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const dates = [...new Set(s.sessions.map((p) => p.date))];
  const [date, setDate] = useState(dates[0] ?? '');
  const rooms = useQuery({ queryKey: ['/timetable/rooms'], queryFn: () => api.get<{ id: number; code: string; name: string; capacity: number | null }[]>('/timetable/rooms') });
  const [picked, setPicked] = useState<number[]>([]);
  const plan = useQuery({ queryKey: ['seating', s.id, date], queryFn: () => api.get<{ room: string; seat_no: number; name: string; roll_no: string | null; course: string; starts_at: string }[]>(`/exams/series/${s.id}/seating`, { date }), enabled: !!date });
  const invalidate = useInvalidate();
  const make = useMutation({ mutationFn: () => api.post(`/exams/series/${s.id}/seating`, { date, room_ids: picked }), onSuccess: async () => { await invalidate('seating'); await invalidate('/exams'); } });
  if (!dates.length) return <EmptyState title={t('exams.noPapers', 'No papers yet')} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.date', 'Date')}>
          {(a) => <Select {...a} value={date} onChange={(e) => setDate(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}</Select>}
        </Field>
        <DownloadButton path={`/exams/series/${s.id}/seating.pdf?date=${date}`} filename={`seating-${date}.pdf`}>{t('exams.seatingPdf', 'Seating charts')}</DownloadButton>
      </div>
      {can('exams.manage') && (
        <Card className="space-y-3 p-4">
          <p className="text-sm text-fg-muted">{t('exams.seatingHelp', 'Pick rooms in the order to fill them. Candidates of different papers sit next to each other.')}</p>
          <div className="flex flex-wrap gap-2">
            {rooms.data?.length === 0 && <span className="text-sm">{t('exams.noRooms', 'Add rooms in Timetable → Rooms first.')}</span>}
            {rooms.data?.map((r) => (
              <label key={r.id} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm">
                <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id] : picked.filter((x) => x !== r.id))} />
                {r.code} <span className="text-fg-muted">({r.capacity ?? 30})</span>
              </label>
            ))}
          </div>
          <MutationError error={make.error} />
          <Button size="sm" disabled={!picked.length} loading={make.isPending} onClick={() => make.mutate()}>{t('exams.makeSeating', 'Seat candidates')}</Button>
        </Card>
      )}
      <DataTable
        rows={plan.data}
        loading={plan.isPending}
        error={plan.error}
        rowKey={(r, i) => i}
        empty={t('exams.noSeating', 'No seating plan for this date yet')}
        columns={[
          { key: 'room', header: t('exams.room', 'Room'), cell: (r) => `${r.room} · ${r.starts_at.slice(0, 5)}` },
          { key: 'seat', header: t('exams.seat', 'Seat'), cell: (r) => r.seat_no },
          { key: 'who', header: t('common.student', 'Student'), cell: (r) => `${r.name} ${r.roll_no ? `(${r.roll_no})` : ''}` },
          { key: 'paper', header: t('exams.paper', 'Paper'), cell: (r) => r.course, hideOnMobile: true },
        ]}
      />
    </div>
  );
}

function DutiesTab({ s }: { s: Series & { sessions: Paper[] } }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const dates = [...new Set(s.sessions.map((p) => p.date))];
  const [date, setDate] = useState(dates[0] ?? '');
  const q = useQuery({ queryKey: [`/exams/series/${s.id}/duties`], queryFn: () => api.get<{ id: number; date: string; starts_at: string; room: string; teacher: string; role: string; course: string }[]>(`/exams/series/${s.id}/duties`) });
  const auto = useMutation({
    mutationFn: () => api.post<{ assigned: number; short: string[] }>(`/exams/series/${s.id}/duties/auto`, { date }),
    onSuccess: async (r) => { await invalidate(`/exams/series/${s.id}`); toast(r.short.length ? 'error' : 'success', r.short.length ? t('exams.dutiesShort', '{{n}} assigned; not enough free staff for {{m}} rooms', { n: r.assigned, m: r.short.length }) : t('exams.dutiesDone', '{{n}} invigilators assigned', { n: r.assigned })); },
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/exams/duties/${id}`), onSuccess: () => invalidate(`/exams/series/${s.id}`) });
  return (
    <div className="space-y-4">
      {can('exams.manage') && dates.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('common.date', 'Date')}>{(a) => <Select {...a} value={date} onChange={(e) => setDate(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}</Select>}</Field>
          <Button loading={auto.isPending} onClick={() => auto.mutate()}><Wand2 className="size-4" /> {t('exams.autoDuties', 'Assign invigilators')}</Button>
        </div>
      )}
      <MutationError error={auto.error} />
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        rowKey={(r) => r.id}
        empty={t('exams.noDuties', 'No invigilation duties yet')}
        columns={[
          { key: 'when', header: t('common.date', 'Date'), cell: (r) => `${formatDate(r.date)} ${r.starts_at.slice(0, 5)}` },
          { key: 'room', header: t('exams.room', 'Room'), cell: (r) => r.room },
          { key: 'who', header: t('exams.invigilator', 'Invigilator'), cell: (r) => <span>{r.teacher} {r.role === 'chief' && <Badge tone="info">{t('exams.chief', 'chief')}</Badge>}</span> },
          { key: 'x', header: '', cell: (r) => can('exams.manage') && <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)}>{t('common.remove', 'Remove')}</Button> },
        ]}
      />
    </div>
  );
}

function AdmitTab({ s }: { s: Series }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: [`/exams/series/${s.id}/admit-cards`], queryFn: () => api.get<{ id: number; student_id: number; name: string; roll_no: string | null; section_name: string | null; eligible: boolean; blocked_reason: string | null; overridden: boolean }[]>(`/exams/series/${s.id}/admit-cards`) });
  const issue = useMutation({ mutationFn: () => api.post<{ issued: number; blocked: number }>(`/exams/series/${s.id}/admit-cards`), onSuccess: async (r) => { await invalidate(`/exams/series/${s.id}`); toast('success', t('exams.issued', '{{n}} admit cards, {{b}} held back', { n: r.issued, b: r.blocked })); } });
  const [override, setOverride] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const allow = useMutation({ mutationFn: () => api.post(`/exams/admit-cards/${override}/override`, { reason }), onSuccess: async () => { await invalidate(`/exams/series/${s.id}`); setOverride(null); setReason(''); } });
  return (
    <div className="space-y-4">
      {can('exams.manage') && <div className="flex justify-end"><Button loading={issue.isPending} onClick={() => issue.mutate()}>{t('exams.issueCards', 'Issue admit cards')}</Button></div>}
      <MutationError error={issue.error} />
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        rowKey={(r) => r.id}
        empty={t('exams.noCards', 'No admit cards issued yet')}
        columns={[
          { key: 'who', header: t('common.student', 'Student'), cell: (r) => `${r.name} ${r.roll_no ? `(${r.roll_no})` : ''}` },
          { key: 'class', header: t('common.class', 'Class'), cell: (r) => r.section_name ?? '—', hideOnMobile: true },
          { key: 'ok', header: t('common.status', 'Status'), cell: (r) => (r.eligible ? <Badge tone="success">{r.overridden ? t('exams.allowed', 'Allowed') : t('exams.eligible', 'Eligible')}</Badge> : <span><Badge tone="danger">{t('exams.held', 'Held back')}</Badge> <span className="text-xs text-fg-muted">{r.blocked_reason}</span></span>) },
          {
            key: 'x',
            header: '',
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <DownloadButton variant="ghost" path={`/exams/series/${s.id}/admit-cards/${r.student_id}.pdf`} filename={`admit-${r.roll_no ?? r.student_id}.pdf`}>PDF</DownloadButton>
                {!r.eligible && can('exams.manage') && <Button size="sm" variant="ghost" onClick={() => setOverride(r.id)}>{t('exams.allow', 'Allow')}</Button>}
              </div>
            ),
          },
        ]}
      />
      <Dialog open={override != null} onClose={() => setOverride(null)} title={t('exams.allowTitle', 'Allow this student to sit')}>
        <div className="space-y-3">
          <Field label={t('common.reason', 'Reason')}>{(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <MutationError error={allow.error} />
          <div className="flex justify-end"><Button disabled={!reason} loading={allow.isPending} onClick={() => allow.mutate()}>{t('exams.allow', 'Allow')}</Button></div>
        </div>
      </Dialog>
    </div>
  );
}

interface ResultRow {
  student_id: number;
  name: string;
  roll_no: string | null;
  section_name: string | null;
  obtained: number;
  total: number;
  percent: number;
  grade: string;
  passed: boolean;
  gpa: number | null;
  position: number | null;
  papers: { session_id: number; course: string; obtained: number; absent: boolean; passed: boolean }[];
}

function ResultsTab({ s }: { s: Series & { sessions: Paper[] } }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: [`/exams/series/${s.id}/results`], queryFn: () => api.get<{ results: ResultRow[] }>(`/exams/series/${s.id}/results`) });
  const merit = useQuery({ queryKey: [`/exams/series/${s.id}/merit`], queryFn: () => api.get<{ group: string; list: { position: number; name: string; percent: number; section_name: string | null }[] }[]>(`/exams/series/${s.id}/merit`, { scope: 'all', top: 10 }) });
  const publish = useMutation({ mutationFn: () => api.post<{ students: number }>(`/exams/series/${s.id}/publish`), onSuccess: async (r) => { await invalidate('/exams'); toast('success', t('exams.publishedMsg', 'Published to {{n}} students and their families', { n: r.students })); } });
  const [withdrawing, setWithdrawing] = useState(false);
  const [note, setNote] = useState('');
  const withdraw = useMutation({ mutationFn: () => api.post(`/exams/series/${s.id}/withdraw`, { note }), onSuccess: async () => { await invalidate('/exams'); setWithdrawing(false); } });
  const pending = s.sessions.filter((p) => p.status !== 'approved').length;
  const uni = s.result_style === 'university';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DownloadButton path={`/exams/series/${s.id}/results?format=xlsx`} filename={`results-${s.name}.xlsx`}>Excel</DownloadButton>
        {can('exams.publish') && s.status !== 'published' && (
          <Button size="sm" disabled={pending > 0 || !s.sessions.length} loading={publish.isPending} onClick={() => publish.mutate()}><Send className="size-4" /> {t('exams.publish', 'Publish results')}</Button>
        )}
        {can('exams.publish') && s.status === 'published' && <Button size="sm" variant="outline" onClick={() => setWithdrawing(true)}><Undo2 className="size-4" /> {t('exams.withdraw', 'Withdraw results')}</Button>}
        {pending > 0 && <span className="text-sm text-fg-muted">{t('exams.pendingPapers', '{{n}} papers still need approval', { n: pending })}</span>}
      </div>
      <MutationError error={publish.error} />
      {merit.data?.[0]?.list.length ? (
        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t('exams.merit', 'Merit list')}</h3>
          <ol className="grid gap-1 text-sm sm:grid-cols-2">{merit.data[0].list.map((m) => <li key={m.name}>{m.position}. {m.name} <span className="text-fg-muted">{m.section_name} · {m.percent}%</span></li>)}</ol>
        </Card>
      ) : null}
      <DataTable
        rows={q.data?.results}
        loading={q.isPending}
        error={q.error}
        rowKey={(r) => r.student_id}
        empty={t('exams.noResults', 'No marks yet')}
        columns={[
          { key: 'who', header: t('common.student', 'Student'), cell: (r) => <span>{r.name} <span className="text-fg-muted">{r.roll_no}</span></span> },
          { key: 'class', header: t('common.class', 'Class'), cell: (r) => r.section_name ?? '—', hideOnMobile: true },
          { key: 'total', header: t('exams.total', 'Total'), cell: (r) => `${r.obtained}/${r.total}`, hideOnMobile: true },
          { key: 'pct', header: '%', cell: (r) => r.percent },
          { key: 'grade', header: uni ? 'SGPA' : t('exams.grade', 'Grade'), cell: (r) => (uni ? (r.gpa?.toFixed(2) ?? '—') : r.grade) },
          { key: 'pos', header: uni ? t('exams.grade', 'Grade') : t('exams.position', 'Position'), cell: (r) => (uni ? r.grade : (r.position ?? '—')), hideOnMobile: true },
          { key: 'res', header: t('exams.result', 'Result'), cell: (r) => <Badge tone={r.passed ? 'success' : 'danger'}>{r.passed ? t('exams.pass', 'Pass') : t('exams.fail', 'Fail')}</Badge> },
          { key: 'card', header: '', cell: (r) => <DownloadButton variant="ghost" path={`/exams/series/${s.id}/result-card/${r.student_id}.pdf`} filename={`result-${r.roll_no ?? r.student_id}.pdf`}>PDF</DownloadButton> },
        ]}
      />
      <Dialog open={withdrawing} onClose={() => setWithdrawing(false)} title={t('exams.withdraw', 'Withdraw results')}>
        <div className="space-y-3">
          <Alert tone="warning">{t('exams.withdrawHelp', 'Students and families stop seeing these results until you publish again.')}</Alert>
          <Field label={t('common.reason', 'Reason')}>{(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <MutationError error={withdraw.error} />
          <div className="flex justify-end"><Button variant="danger" disabled={!note} loading={withdraw.isPending} onClick={() => withdraw.mutate()}>{t('exams.withdraw', 'Withdraw results')}</Button></div>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- marks

export function MyPapersPage() {
  const { t } = useTranslation();
  const labels = usePaperLabels();
  const q = useQuery({ queryKey: ['/exams/my-papers'], queryFn: () => api.get<{ id: number; date: string; series: string; course: string; section_name: string | null; status: string; marks_entered: number; candidates: number; i_am_hod: boolean }[]>('/exams/my-papers') });
  return (
    <>
      <PageHeader title={t('nav.examMarks', 'Exam marks')} subtitle={t('exams.marksSubtitle', 'Enter marks for your papers; heads of department approve them')} />
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.id}
        empty={t('exams.noMyPapers', 'No papers waiting for you')}
        columns={[
          { key: 'paper', header: t('exams.paper', 'Paper'), cell: (r) => <Link className="font-medium text-primary hover:underline" to={`/exams/marks/${r.id}`}>{r.course} {r.section_name && `· ${r.section_name}`}</Link> },
          { key: 'series', header: t('exams.series', 'Series'), cell: (r) => r.series, hideOnMobile: true },
          { key: 'date', header: t('common.date', 'Date'), cell: (r) => formatDate(r.date), hideOnMobile: true },
          { key: 'n', header: t('exams.entered', 'Entered'), cell: (r) => `${r.marks_entered}/${r.candidates}` },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <span><Badge tone={PAPER_TONE[r.status]}>{labels[r.status]}</Badge> {r.i_am_hod && r.status === 'submitted' && <Badge tone="warning">{t('exams.yourApproval', 'needs you')}</Badge>}</span> },
        ]}
      />
    </>
  );
}

interface MarksData {
  session: { id: number; course: string; series: string; date: string; total_marks: string; pass_marks: string; status: string };
  students: { student_id: number; name: string; roll_no: string | null; marks: string | null; absent: boolean | null; adjustment: string | null; remarks: string | null }[];
  history: { action: string; from_status: string; to_status: string; note: string; created_at: string; by: string | null; change: unknown }[];
  can_enter: boolean;
  can_approve: boolean;
}

export function MarksEntryPage() {
  const { t } = useTranslation();
  const { sessionId } = useParams();
  const toast = useToast();
  const invalidate = useInvalidate();
  const labels = usePaperLabels();
  const q = useQuery({ queryKey: [`/exams/sessions/${sessionId}/marks`], queryFn: () => api.get<MarksData>(`/exams/sessions/${sessionId}/marks`) });
  const [edits, setEdits] = useState<Record<number, { marks: string; absent: boolean }>>({});
  const [dlg, setDlg] = useState<null | 'return' | 'moderate'>(null);
  const [note, setNote] = useState('');
  const [add, setAdd] = useState('');
  const refresh = () => invalidate('/exams');
  const save = useMutation({
    mutationFn: () => api.put(`/exams/sessions/${sessionId}/marks`, { marks: Object.entries(edits).map(([sid, e]) => ({ student_id: Number(sid), absent: e.absent, marks: e.absent || e.marks === '' ? null : Number(e.marks) })) }),
    onSuccess: async () => { setEdits({}); await refresh(); toast('success', t('common.saved', 'Saved')); },
  });
  const act = useMutation({
    mutationFn: (what: 'submit' | 'approve' | 'return' | 'moderate') =>
      api.post(`/exams/sessions/${sessionId}/${what}`, what === 'return' ? { note } : what === 'moderate' ? { add: Number(add), note } : {}),
    onSuccess: async () => { setDlg(null); setNote(''); await refresh(); },
  });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner className="h-full" />;
  const d = q.data;
  const editable = d.can_enter && ['scheduled', 'marks_entry'].includes(d.session.status);
  const total = Number(d.session.total_marks);
  const row = (s: MarksData['students'][number]) => edits[s.student_id] ?? { marks: s.marks == null ? '' : String(Number(s.marks)), absent: !!s.absent };
  return (
    <>
      <Link to="/exams/marks" className="mb-3 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"><ArrowLeft className="size-4" /> {t('nav.examMarks', 'Exam marks')}</Link>
      <PageHeader
        title={`${d.session.course} — ${d.session.series}`}
        subtitle={<span>{formatDate(d.session.date)} · {t('exams.outOf', 'out of {{n}}, pass {{p}}', { n: total, p: Number(d.session.pass_marks) })} · <Badge tone={PAPER_TONE[d.session.status]}>{labels[d.session.status]}</Badge></span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {editable && <Button size="sm" variant="outline" disabled={!Object.keys(edits).length} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>}
            {d.can_enter && d.session.status === 'marks_entry' && <Button size="sm" loading={act.isPending} disabled={!!Object.keys(edits).length} onClick={() => act.mutate('submit')}><Send className="size-4" /> {t('exams.submit', 'Submit for approval')}</Button>}
            {d.can_approve && ['submitted', 'hod_approved'].includes(d.session.status) && (
              <>
                <Button size="sm" loading={act.isPending} onClick={() => act.mutate('approve')}><CheckCircle2 className="size-4" /> {t('exams.approve', 'Approve')}</Button>
                <Button size="sm" variant="outline" onClick={() => setDlg('moderate')}>{t('exams.moderate', 'Moderate')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setDlg('return')}>{t('exams.return', 'Return')}</Button>
              </>
            )}
          </div>
        }
      />
      <MutationError error={save.error ?? act.error} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-xs uppercase text-fg-muted">
              <th className="px-3 py-2 text-start">{t('common.student', 'Student')}</th>
              <th className="px-3 py-2 text-start">{t('exams.marks', 'Marks')}</th>
              <th className="px-3 py-2 text-start">{t('exams.absent', 'Absent')}</th>
              <th className="px-3 py-2 text-start">{t('exams.moderation', 'Moderation')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.students.map((s, i) => {
              const r = row(s);
              const bad = r.marks !== '' && (Number(r.marks) > total || Number(r.marks) < 0);
              return (
                <tr key={s.student_id}>
                  <td className="px-3 py-2">{s.name} <span className="text-fg-muted">{s.roll_no}</span></td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={t('exams.marksFor', 'Marks for {{name}}', { name: s.name })}
                      className={`w-24 ${bad ? 'border-danger' : ''}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={total}
                      disabled={!editable || r.absent}
                      value={r.marks}
                      // Enter moves down the column, like a spreadsheet
                      onKeyDown={(e) => { if (e.key === 'Enter') (document.querySelectorAll<HTMLInputElement>('input[data-marks]')[i + 1])?.focus(); }}
                      data-marks
                      onChange={(e) => setEdits({ ...edits, [s.student_id]: { ...r, marks: e.target.value } })}
                    />
                  </td>
                  <td className="px-3 py-2"><input type="checkbox" aria-label={t('exams.absentFor', '{{name}} was absent', { name: s.name })} disabled={!editable} checked={r.absent} onChange={(e) => setEdits({ ...edits, [s.student_id]: { ...r, absent: e.target.checked } })} /></td>
                  <td className="px-3 py-2 text-fg-muted">{s.adjustment && Number(s.adjustment) ? `${Number(s.adjustment) > 0 ? '+' : ''}${Number(s.adjustment)}` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {d.students.length === 0 && <EmptyState title={t('exams.noCandidates', 'No candidates for this paper')} />}
      </Card>
      {d.history.length > 0 && (
        <Card className="mt-4 p-4">
          <h3 className="mb-2 font-semibold">{t('exams.history', 'History')}</h3>
          <ul className="space-y-1 text-sm">
            {d.history.map((h, i) => <li key={i}><span className="text-fg-muted">{formatDateTime(h.created_at)}</span> · {h.by} · {h.action} → {labels[h.to_status] ?? h.to_status}{h.note && ` — ${h.note}`}</li>)}
          </ul>
        </Card>
      )}
      <Dialog open={dlg != null} onClose={() => setDlg(null)} title={dlg === 'return' ? t('exams.return', 'Return') : t('exams.moderate', 'Moderate')}>
        <div className="space-y-3">
          {dlg === 'moderate' && <Field label={t('exams.addMarks', 'Add marks to everyone who sat (negative to deduct)')}>{(a) => <Input {...a} type="number" value={add} onChange={(e) => setAdd(e.target.value)} />}</Field>}
          <Field label={t('common.reason', 'Reason')}>{(a) => <Textarea {...a} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <MutationError error={act.error} />
          <div className="flex justify-end"><Button disabled={!note || (dlg === 'moderate' && !add)} loading={act.isPending} onClick={() => act.mutate(dlg!)}>{t('common.confirm', 'Confirm')}</Button></div>
        </div>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------- students and families

interface MyExams {
  student_id: number;
  name: string;
  upcoming: { series_id: number; series: string; course: string; date: string; starts_at: string; ends_at: string; room: string | null; seat_no: number | null }[];
  admit_cards: { series_id: number; series: string; eligible: boolean; blocked_reason: string | null }[];
  results: { series_id: number; series: string; percent: number; grade: string; passed: boolean; gpa: number | null; papers: { course: string; obtained: number; total: number; grade: string; passed: boolean }[] }[];
}

export function MyExamsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/exams/my'], queryFn: () => api.get<MyExams[]>('/exams/my') });
  return (
    <>
      <PageHeader title={t('nav.exams', 'Exams')} subtitle={t('exams.mySubtitle', 'Date sheet, admit cards and results')} />
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Spinner /> : q.data.length === 0 ? <EmptyState title={t('exams.nothing', 'Nothing here yet')} /> : (
        <div className="space-y-8">
          {q.data.map((k) => (
            <section key={k.student_id} className="space-y-4">
              {q.data.length > 1 && <h2 className="text-lg font-semibold">{k.name}</h2>}
              {k.admit_cards.map((c) => (
                <Alert key={c.series_id} tone={c.eligible ? 'success' : 'danger'} title={c.series}>
                  {c.eligible ? (
                    <DownloadButton path={`/exams/series/${c.series_id}/admit-cards/${k.student_id}.pdf`} filename="admit-card.pdf">{t('exams.admitCard', 'Admit card')}</DownloadButton>
                  ) : (
                    t('exams.heldBack', 'Admit card withheld: {{reason}}. Please see the exams office.', { reason: c.blocked_reason })
                  )}
                </Alert>
              ))}
              <Card className="p-4">
                <h3 className="mb-2 font-semibold">{t('exams.upcoming', 'Coming up')}</h3>
                {k.upcoming.length === 0 ? <p className="text-sm text-fg-muted">{t('exams.noUpcoming', 'No papers scheduled.')}</p> : (
                  <ul className="divide-y divide-border text-sm">
                    {k.upcoming.map((p, i) => (
                      <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                        <span className="font-medium">{p.course}</span>
                        <span className="text-fg-muted">{formatDate(p.date)} {p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)}{p.room && ` · ${t('exams.roomSeat', 'room {{room}}, seat {{seat}}', { room: p.room, seat: p.seat_no })}`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {k.results.map((r) => (
                <Card key={r.series_id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{r.series}</h3>
                    <div className="flex items-center gap-2">
                      <Badge tone={r.passed ? 'success' : 'danger'}>{r.percent}% · {r.gpa != null ? `SGPA ${r.gpa.toFixed(2)}` : r.grade}</Badge>
                      <DownloadButton variant="ghost" path={`/exams/series/${r.series_id}/result-card/${k.student_id}.pdf`} filename="result.pdf">{t('exams.resultCard', 'Result card')}</DownloadButton>
                    </div>
                  </div>
                  <ul className="grid gap-1 text-sm sm:grid-cols-2">{r.papers.map((p) => <li key={p.course} className="flex justify-between"><span>{p.course}</span><span className={p.passed ? '' : 'text-danger'}>{p.obtained}/{p.total} · {p.grade}</span></li>)}</ul>
                </Card>
              ))}
              <Mastery studentId={k.student_id} />
              <div className="flex flex-wrap gap-2">
                <DownloadButton path={`/exams/transcript/${k.student_id}.pdf`} filename="transcript.pdf">{t('exams.transcript', 'Transcript')}</DownloadButton>
                <DownloadButton path={`/outcomes/students/${k.student_id}/skills.pdf`} filename="skills.pdf">{t('exams.skills', 'Skills transcript')}</DownloadButton>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

interface MasteryData {
  courses: { course: string; clos: { code: string; description: string; percent: number | null; attained: boolean | null }[] }[];
  programs: { code: string; description: string; percent: number | null; attained: boolean | null }[];
}

/** Skills: how far the student has reached each course and program outcome (released grades). */
function Mastery({ studentId }: { studentId: number }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/outcomes/students', studentId], queryFn: () => api.get<MasteryData>(`/outcomes/students/${studentId}`) });
  const rows = [...(q.data?.programs ?? []).map((p) => ({ group: t('obe.programOutcomes', 'Program outcomes'), ...p })), ...(q.data?.courses ?? []).flatMap((c) => c.clos.map((o) => ({ group: c.course, ...o })))].filter((r) => r.percent != null);
  if (!rows.length) return null;
  return (
    <Card className="p-4">
      <h3 className="mb-3 font-semibold">{t('exams.skills', 'Skills')}</h3>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="text-sm">
            <div className="flex justify-between gap-2">
              <span><span className="font-medium">{r.code}</span> <span className="text-fg-muted">· {r.group} · {r.description}</span></span>
              <span className="tabular-nums">{r.percent}%</span>
            </div>
            <div className="mt-1 h-2 rounded bg-surface-2">
              <div className={`h-2 rounded ${r.attained ? 'bg-success' : 'bg-warning'}`} style={{ width: `${Math.min(100, r.percent ?? 0)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Work in a course: the list, setting up an assignment / quiz / exam / project, a student's view
// (instructions, hand-in with drafts and versions, grade and feedback, quiz attempts) and the
// teacher's grading (rubric, points, feedback files, release, missing, extensions).
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Check, ClipboardList, Download, Eye, FileUp, ListChecks, Plus, Send, Timer, Upload } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { KIND_LABEL, dueLabel, type Assessment, type CourseRole } from '@/lib/lms';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { AiGradingTools, useActivityTracker } from '@/pages/ai/CourseAi';
import { RichEditor, RichText } from '@/components/RichText';

interface WorkRow {
  id: number;
  kind: Assessment['kind'];
  title: string;
  points: string;
  due_at: string | null;
  status: string;
  category: string | null;
  // staff
  students?: number;
  submitted?: number;
  graded?: number;
  unreleased?: number;
  // students
  submission_status?: string | null;
  attempts?: number;
  score?: string | null;
  excused?: boolean;
  missing?: boolean;
}

export function WorkList({ courseId, role, canEdit }: { courseId: number; role: CourseRole; canEdit: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['work', courseId], queryFn: () => api.get<WorkRow[]>(`/courses/${courseId}/assessments`) });
  const staff = role === 'staff';
  return (
    <div className="space-y-3">
      {staff && canEdit && (
        <Link to="work/new">
          <Button>
            <Plus className="size-4" /> {t('lms.newWork', 'New assignment or quiz')}
          </Button>
        </Link>
      )}
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.id}
        empty={t('lms.noWork', 'No work set yet')}
        columns={[
          {
            key: 'title',
            header: t('common.title', 'Title'),
            cell: (r) => (
              <Link to={`work/${r.id}`} className="font-medium text-primary hover:underline">
                {r.title}
              </Link>
            ),
          },
          { key: 'kind', header: t('lms.kindOf', 'Kind'), cell: (r) => t(`lms.kinds.${r.kind}`, KIND_LABEL[r.kind]), hideOnMobile: true },
          { key: 'due', header: t('lms.due', 'Due'), cell: (r) => (r.due_at ? formatDateTime(r.due_at) : '—') },
          staff
            ? {
                key: 'progress',
                header: t('lms.handedIn', 'Handed in'),
                cell: (r) => (
                  <span className="tabular-nums">
                    {r.submitted}/{r.students}
                    {!!r.unreleased && <Badge tone="warning" className="ms-2">{t('lms.toRelease', '{{n}} to release', { n: r.unreleased })}</Badge>}
                    {r.status === 'draft' && <Badge className="ms-2">{t('lms.draft', 'Draft')}</Badge>}
                  </span>
                ),
              }
            : {
                key: 'mine',
                header: t('lms.status', 'Status'),
                cell: (r) =>
                  r.excused ? (
                    <Badge>{t('lms.excused', 'Excused')}</Badge>
                  ) : r.score != null ? (
                    <Badge tone="success">
                      {Number(r.score)}/{Number(r.points)}
                    </Badge>
                  ) : r.missing ? (
                    <Badge tone="danger">{t('lms.missing', 'Missing')}</Badge>
                  ) : r.submission_status || r.attempts ? (
                    <Badge tone="info">{t('lms.submitted', 'Handed in')}</Badge>
                  ) : (
                    <Badge tone={dueLabel(r.due_at).tone === 'neutral' ? 'neutral' : dueLabel(r.due_at).tone}>{t('lms.todo', 'To do')}</Badge>
                  ),
              },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------- editor

const toLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export function WorkEditorPage() {
  const { t } = useTranslation();
  const params = useParams();
  const courseId = Number(params.courseId);
  const workId = params.workId ? Number(params.workId) : null;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['assessment', workId], queryFn: () => api.get<Assessment>(`/assessments/${workId}`), enabled: !!workId });
  const cats = useQuery({ queryKey: ['categories', courseId], queryFn: () => api.get<{ id: number; name: string }[]>(`/courses/${courseId}/grade-categories`) });
  const rubrics = useQuery({ queryKey: ['rubrics', courseId], queryFn: () => api.get<{ id: number; title: string }[]>('/rubrics', { offering_id: courseId }) });
  const groupSets = useQuery({ queryKey: ['group-sets', courseId], queryFn: () => api.get<{ id: number; name: string }[]>(`/courses/${courseId}/group-sets`) });
  const [f, setF] = useState({
    kind: 'assignment' as Assessment['kind'],
    title: '',
    instructions_html: '',
    points: '100',
    due_at: '',
    available_from: '',
    available_until: '',
    category_id: '',
    rubric_id: '',
    group_set_id: '',
    submission_types: ['text', 'file'] as string[],
    allowed_attempts: '1',
    late_mode: 'allow',
    penalty: '10',
    release_mode: 'manual',
    ai_policy: 'allowed',
    time_limit: '',
    shuffle: true,
    show_results: 'after_release',
    peer: false,
  });
  useEffect(() => {
    const a = existing.data;
    if (!a) return;
    setF({
      kind: a.kind,
      title: a.title,
      instructions_html: a.instructions_html,
      points: String(Number(a.points)),
      due_at: toLocal(a.due_at),
      available_from: toLocal(a.available_from),
      available_until: toLocal(a.available_until),
      category_id: a.category_id ? String(a.category_id) : '',
      rubric_id: a.rubric_id ? String(a.rubric_id) : '',
      group_set_id: a.group_set_id ? String(a.group_set_id) : '',
      submission_types: a.submission_types,
      allowed_attempts: a.allowed_attempts == null ? '' : String(a.allowed_attempts),
      late_mode: a.late_policy.mode,
      penalty: String(a.late_policy.penalty_percent_per_day ?? 10),
      release_mode: a.release_mode,
      ai_policy: a.ai_policy,
      time_limit: a.quiz?.time_limit_minutes ? String(a.quiz.time_limit_minutes) : '',
      shuffle: a.quiz?.shuffle_questions ?? true,
      show_results: a.quiz?.show_results ?? 'after_release',
      peer: !!a.peer_review,
    });
  }, [existing.data]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const isQuiz = f.kind === 'quiz' || f.kind === 'exam';
  const body = (status?: string) => ({
    kind: f.kind,
    title: f.title,
    instructions_html: f.instructions_html,
    points: Number(f.points),
    due_at: fromLocal(f.due_at),
    available_from: fromLocal(f.available_from),
    available_until: fromLocal(f.available_until),
    category_id: f.category_id ? Number(f.category_id) : null,
    rubric_id: f.rubric_id ? Number(f.rubric_id) : null,
    group_set_id: f.group_set_id ? Number(f.group_set_id) : null,
    submission_types: isQuiz ? ['none'] : f.submission_types,
    allowed_attempts: f.allowed_attempts ? Number(f.allowed_attempts) : null,
    late_policy: { mode: f.late_mode, penalty_percent_per_day: Number(f.penalty), max_penalty_percent: 50 },
    release_mode: f.release_mode,
    ai_policy: f.ai_policy,
    quiz: isQuiz ? { time_limit_minutes: f.time_limit ? Number(f.time_limit) : null, shuffle_questions: f.shuffle, shuffle_options: true, one_at_a_time: false, show_results: f.show_results, scoring: 'highest' } : null,
    peer_review: f.peer ? { reviews_per_student: 2, anonymous: true } : null,
    ...(status ? { status } : {}),
    ...(!workId && search.get('module') ? { module_id: Number(search.get('module')) } : {}),
  });
  const save = useMutation({
    mutationFn: (status?: string) => (workId ? api.patch<Assessment>(`/assessments/${workId}`, body(status)) : api.post<Assessment>(`/courses/${courseId}/assessments`, body(status ?? 'draft'))),
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: ['work', courseId] });
      void qc.invalidateQueries({ queryKey: ['course', courseId] });
      void qc.invalidateQueries({ queryKey: ['assessment', a.id] });
      toast('success', t('common.saved', 'Saved'));
      // /…/courses/3/work/new or /…/work/12/edit → /…/courses/3
      const base = location.pathname.replace(/\/work\/(new|\d+\/edit)\/?$/, '');
      navigate(`${base}/work/${a.id}${isQuiz && !workId ? '/questions' : ''}`);
    },
    onError: (e) => {
      const details = (e as { details?: { suggested_date?: string } }).details;
      toast('error', details?.suggested_date ? `${errorMessage(e)} — ${t('lms.tryDate', 'try {{date}}', { date: formatDate(details.suggested_date) })}` : errorMessage(e));
    },
  });
  if (workId && existing.isPending) return <Spinner />;
  const TYPES = ['text', 'file', 'link', 'audio', 'video'];
  return (
    <>
      <PageHeader title={workId ? t('lms.editWork', 'Edit {{title}}', { title: existing.data?.title }) : t('lms.newWork', 'New assignment or quiz')} />
      <form
        className="grid gap-4 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Card className="space-y-4 p-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('lms.kindOf', 'Kind')}>
              {(a) => (
                <Select {...a} value={f.kind} onChange={(e) => set('kind', e.target.value as Assessment['kind'])} disabled={!!workId}>
                  {(['assignment', 'quiz', 'exam', 'project', 'participation'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`lms.kinds.${k}`, KIND_LABEL[k])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('common.title', 'Title')} className="sm:col-span-2">
              {(a) => <Input {...a} required value={f.title} onChange={(e) => set('title', e.target.value)} />}
            </Field>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium">{t('lms.instructions', 'Instructions')}</div>
            <RichEditor label={t('lms.instructions', 'Instructions')} value={f.instructions_html} onChange={(v) => set('instructions_html', v)} />
          </div>
          {!isQuiz && f.kind !== 'participation' && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t('lms.handInAs', 'Students hand in')}</legend>
              <div className="flex flex-wrap gap-3">
                {TYPES.map((ty) => (
                  <label key={ty} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={f.submission_types.includes(ty)}
                      onChange={(e) => set('submission_types', e.target.checked ? [...f.submission_types, ty] : f.submission_types.filter((x) => x !== ty))}
                    />
                    {t(`lms.handInType.${ty}`, ty)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {isQuiz && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('lms.timeLimit', 'Time limit (minutes)')} optional>
                {(a) => <Input {...a} type="number" min={1} value={f.time_limit} onChange={(e) => set('time_limit', e.target.value)} />}
              </Field>
              <Field label={t('lms.showResults', 'Show answers')}>
                {(a) => (
                  <Select {...a} value={f.show_results} onChange={(e) => set('show_results', e.target.value)}>
                    <option value="after_submit">{t('lms.results.after_submit', 'right after submitting')}</option>
                    <option value="after_due">{t('lms.results.after_due', 'after the due date')}</option>
                    <option value="after_release">{t('lms.results.after_release', 'when grades are released')}</option>
                    <option value="never">{t('lms.results.never', 'never')}</option>
                  </Select>
                )}
              </Field>
              <label className="mt-7 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.shuffle} onChange={(e) => set('shuffle', e.target.checked)} /> {t('lms.shuffle', 'Shuffle questions')}
              </label>
            </div>
          )}
        </Card>
        <Card className="space-y-4 p-4">
          <Field label={t('lms.points', 'Points')}>{(a) => <Input {...a} type="number" min={0} step="0.5" value={f.points} onChange={(e) => set('points', e.target.value)} />}</Field>
          <Field label={t('lms.dueAt', 'Due')} optional>{(a) => <Input {...a} type="datetime-local" value={f.due_at} onChange={(e) => set('due_at', e.target.value)} />}</Field>
          <Field label={t('lms.opensAt', 'Opens on')} optional>{(a) => <Input {...a} type="datetime-local" value={f.available_from} onChange={(e) => set('available_from', e.target.value)} />}</Field>
          <Field label={t('lms.closesAt', 'Closes on')} optional hint={t('lms.closesHint', 'No hand-ins after this, even late ones')}>
            {(a) => <Input {...a} type="datetime-local" value={f.available_until} onChange={(e) => set('available_until', e.target.value)} />}
          </Field>
          <Field label={t('lms.attempts', 'Attempts allowed')} hint={t('lms.attemptsHint', 'Empty = unlimited')}>
            {(a) => <Input {...a} type="number" min={1} value={f.allowed_attempts} onChange={(e) => set('allowed_attempts', e.target.value)} />}
          </Field>
          <Field label={t('lms.lateWork', 'Late work')}>
            {(a) => (
              <Select {...a} value={f.late_mode} onChange={(e) => set('late_mode', e.target.value)}>
                <option value="allow">{t('lms.late.allow', 'accepted, marked late')}</option>
                <option value="penalty">{t('lms.late.penalty', 'accepted with a penalty per day')}</option>
                <option value="block">{t('lms.late.block', 'not accepted')}</option>
              </Select>
            )}
          </Field>
          {f.late_mode === 'penalty' && <Field label={t('lms.penalty', 'Penalty per day (%)')}>{(a) => <Input {...a} type="number" min={0} max={100} value={f.penalty} onChange={(e) => set('penalty', e.target.value)} />}</Field>}
          <Field label={t('lms.category', 'Grade category')} optional>
            {(a) => (
              <Select {...a} value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
                <option value="">{t('common.none', '—')}</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          {!isQuiz && (
            <>
              <Field label={t('lms.rubric', 'Rubric')} optional>
                {(a) => (
                  <Select {...a} value={f.rubric_id} onChange={(e) => set('rubric_id', e.target.value)}>
                    <option value="">{t('common.none', '—')}</option>
                    {rubrics.data?.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                  </Select>
                )}
              </Field>
              <Field label={t('lms.groupWork', 'Group work')} optional>
                {(a) => (
                  <Select {...a} value={f.group_set_id} onChange={(e) => set('group_set_id', e.target.value)}>
                    <option value="">{t('lms.individual', 'Individual')}</option>
                    {groupSets.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </Select>
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.peer} onChange={(e) => set('peer', e.target.checked)} /> {t('lms.peerReview', 'Peer review (2 anonymous reviews each)')}
              </label>
            </>
          )}
          <Field label={t('lms.release.label', 'Students see grades')}>
            {(a) => (
              <Select {...a} value={f.release_mode} onChange={(e) => set('release_mode', e.target.value)}>
                <option value="manual">{t('lms.release.manual', 'when I release them')}</option>
                <option value="on_grading">{t('lms.release.on_grading', 'as soon as each is graded')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('lms.aiPolicy', 'AI help')}>
            {(a) => (
              <Select {...a} value={f.ai_policy} onChange={(e) => set('ai_policy', e.target.value)}>
                <option value="allowed">{t('lms.ai.allowed', 'allowed')}</option>
                <option value="limited">{t('lms.ai.limited', 'hints only')}</option>
                <option value="not_allowed">{t('lms.ai.not_allowed', 'not allowed')}</option>
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" variant="outline" loading={save.isPending}>
              {t('lms.saveDraft', 'Save')}
            </Button>
            {existing.data?.status !== 'published' && (
              <Button onClick={() => save.mutate('published')} loading={save.isPending}>
                <Send className="size-4" /> {t('lms.publishTell', 'Publish and tell students')}
              </Button>
            )}
          </div>
        </Card>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- one piece of work

export function WorkPage() {
  const id = Number(useParams().workId);
  const q = useQuery({ queryKey: ['assessment', id], queryFn: () => api.get<Assessment>(`/assessments/${id}`) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return q.data.role === 'staff' ? <StaffWork a={q.data} /> : <StudentWork a={q.data} />;
}

function WorkHeader({ a, actions }: { a: Assessment; actions?: React.ReactNode }) {
  const { t } = useTranslation();
  const due = a.my?.due_at ?? a.due_at;
  return (
    <>
      <PageHeader
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link to="../../#work" relative="path" className="hover:underline">
              {a.course.name}
            </Link>
            <Badge>{t(`lms.kinds.${a.kind}`, KIND_LABEL[a.kind])}</Badge>
            <span>{t('lms.outOf', '{{n}} points', { n: Number(a.points) })}</span>
            {due && (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-4" aria-hidden /> {formatDateTime(due)}
              </span>
            )}
            {a.ai_policy !== 'allowed' && <Badge tone="warning">{a.ai_policy === 'limited' ? t('lms.ai.limitedShort', 'AI: hints only') : t('lms.ai.noneShort', 'No AI help')}</Badge>}
          </span>
        }
        actions={actions}
      />
      {a.instructions_html && (
        <Card className="mb-4 p-4">
          <RichText html={a.instructions_html} />
        </Card>
      )}
    </>
  );
}

interface MySubmission {
  id: number;
  attempt: number;
  status: string;
  submitted_at: string | null;
  late: boolean;
  minutes_late: number;
  versions: { id: number; version: number; text_html: string; link_url: string; files: { id: number; name: string; type: string; size: number }[]; created_at: string }[];
}

function StudentWork({ a }: { a: Assessment }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isQuiz = a.kind === 'quiz' || a.kind === 'exam';
  const mine = useQuery({ queryKey: ['my-submission', a.id], queryFn: () => api.get<{ submissions: MySubmission[]; peer_reviews: { id: number; comments: string; reviewer: string | null }[] }>(`/assessments/${a.id}/submission`), enabled: !isQuiz && a.role === 'student' });
  const latest = mine.data?.submissions.at(-1);
  const draft = latest?.status === 'draft' ? latest.versions.at(-1) : undefined;
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [files, setFiles] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    if (draft) {
      setText(draft.text_html);
      setLink(draft.link_url);
      setFiles(draft.files.map((f) => ({ id: f.id, name: f.name })));
    }
  }, [draft]);
  const handedIn = (mine.data?.submissions ?? []).filter((s) => s.status !== 'draft');
  const allowed = a.my?.attempts_allowed;
  const canSubmit = a.role === 'student' && !isQuiz && !a.submission_types.includes('none') && (allowed == null || handedIn.length < allowed);
  const tracker = useActivityTracker(a.id, canSubmit && a.submission_types.includes('text'));
  const submit = useMutation({
    mutationFn: (final: boolean) => api.post<{ late: boolean }>(`/assessments/${a.id}/submission`, { text_html: text, link_url: link, file_ids: files.map((f) => f.id), submit: final }),
    onSuccess: (r, final) => {
      void qc.invalidateQueries({ queryKey: ['my-submission', a.id] });
      void qc.invalidateQueries({ queryKey: ['course', a.offering_id] });
      toast('success', final ? (r.late ? t('lms.handedInLate', 'Handed in (late)') : t('lms.handedInOk', 'Handed in')) : t('lms.draftSaved', 'Draft saved'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.upload<{ id: number; original_name: string }>('POST', '/files?purpose=submission', file),
    onSuccess: (f) => setFiles((x) => [...x, { id: f.id, name: f.original_name }]),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const [code, setCode] = useState('');
  const startQuiz = useMutation({
    mutationFn: () => api.post<{ id: number }>(`/assessments/${a.id}/attempts`, code ? { access_code: code } : {}),
    onSuccess: (r) => navigate(`/attempts/${r.id}`),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const g = a.grade;
  return (
    <>
      <WorkHeader a={a} />
      {g && (
        <Card className="mb-4 border-success/40 p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-semibold">{t('lms.yourGrade', 'Your grade')}</h2>
            {g.excused ? (
              <Badge>{t('lms.excused', 'Excused')}</Badge>
            ) : (
              <span className="text-2xl font-bold tabular-nums">
                {g.points == null ? '—' : Number(g.points)} / {Number(a.points)}
              </span>
            )}
            {Number(g.late_penalty_percent) > 0 && <Badge tone="warning">{t('lms.latePenalty', '−{{n}}% late', { n: Number(g.late_penalty_percent) })}</Badge>}
          </div>
          {g.rubric_scores && a.rubric && (
            <ul className="mt-3 space-y-1 text-sm">
              {a.rubric.criteria.map((c) => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span>{c.title}</span>
                  <span className="tabular-nums">{g.rubric_scores?.[String(c.id)]?.points ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
          {g.feedback_html && <RichText html={g.feedback_html} className="mt-3" />}
          {g.feedback_file_ids.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {g.feedback_file_ids.map((fid) => (
                <Button key={fid} size="sm" variant="outline" onClick={() => api.download(`/files/${fid}?download=1`, `feedback-${fid}`)}>
                  <Download className="size-4" /> {t('lms.feedbackFile', 'Feedback file')}
                </Button>
              ))}
            </div>
          )}
        </Card>
      )}
      {isQuiz && a.role === 'student' && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="text-sm text-fg-muted">
            {a.quiz?.time_limit_minutes ? (
              <span className="flex items-center gap-1">
                <Timer className="size-4" aria-hidden /> {t('lms.timeLimitIs', '{{n}} minutes', { n: Math.round(a.quiz.time_limit_minutes * (1 + (a.my?.extra_time_percent ?? 0) / 100)) })}
              </span>
            ) : (
              t('lms.untimed', 'No time limit')
            )}
            {allowed != null && ` · ${t('lms.attemptsLeft', '{{n}} attempt(s) allowed', { n: allowed })}`}
          </div>
          {a.secure && (
            <Alert tone="warning" title={t('lms.secureExam', 'Secure exam')}>
              <ul className="list-disc ps-5 text-sm">
                {a.secure.require_fullscreen && <li>{t('lms.secureFullscreen', 'The exam opens full screen; leaving it is recorded.')}</li>}
                {a.secure.lock_navigation && <li>{t('lms.secureLocked', 'One question at a time — you cannot go back.')}</li>}
                {a.secure.block_copy_paste && <li>{t('lms.secureNoCopy', 'Copying and pasting are switched off.')}</li>}
                {a.secure.max_violations && <li>{t('lms.secureMax', 'Leaving the exam {{n}} times hands it in automatically.', { n: a.secure.max_violations })}</li>}
                {a.secure.network_restricted && <li>{t('lms.secureNetwork', 'Only on the campus network.')}</li>}
              </ul>
            </Alert>
          )}
          {a.secure?.requires_code && (
            <Field label={t('lms.accessCode', 'Access code from your invigilator')}>
              {(f) => <Input {...f} value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} className="max-w-48 uppercase" />}
            </Field>
          )}
          <Button
            onClick={async () => {
              if (a.secure?.require_fullscreen) await document.documentElement.requestFullscreen?.().catch(() => {});
              startQuiz.mutate();
            }}
            loading={startQuiz.isPending}
            disabled={!!a.secure?.requires_code && code.trim().length < 4}
          >
            {t('lms.startQuiz', 'Start')}
          </Button>
        </Card>
      )}
      {canSubmit && (
        <Card className="mb-4 space-y-4 p-4">
          <h2 className="font-semibold">{handedIn.length ? t('lms.resubmit', 'Hand in again') : t('lms.yourWork', 'Your work')}</h2>
          {a.submission_types.includes('text') && (
            <div ref={tracker}>
              <RichEditor label={t('lms.yourAnswer', 'Your answer')} value={text} onChange={setText} />
            </div>
          )}
          {a.submission_types.includes('link') && (
            <Field label={t('lms.link', 'Link')} optional>
              {(x) => <Input {...x} type="url" dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />}
            </Field>
          )}
          {(a.submission_types.includes('file') || a.submission_types.includes('audio') || a.submission_types.includes('video')) && (
            <div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2">
                <Upload className="size-4" aria-hidden /> {upload.isPending ? t('common.uploading', 'Uploading…') : t('lms.addFile', 'Add a file')}
                <input
                  type="file"
                  className="sr-only"
                  accept={a.submission_types.includes('file') ? undefined : 'audio/*,video/*'}
                  capture={a.submission_types.includes('file') ? undefined : 'user'}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {files.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {files.map((fl) => (
                    <li key={fl.id} className="flex items-center gap-2">
                      <FileUp className="size-4 text-fg-muted" aria-hidden /> {fl.name}
                      <button type="button" className="text-xs text-danger hover:underline" onClick={() => setFiles((x) => x.filter((y) => y.id !== fl.id))}>
                        {t('common.remove', 'Remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => submit.mutate(false)} loading={submit.isPending}>
              {t('lms.saveDraft', 'Save draft')}
            </Button>
            <Button onClick={() => submit.mutate(true)} loading={submit.isPending}>
              <Send className="size-4" /> {t('lms.handIn', 'Hand in')}
            </Button>
          </div>
        </Card>
      )}
      {handedIn.length > 0 && (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 font-semibold">{t('lms.history', 'What you handed in')}</h2>
          <ul className="space-y-3">
            {handedIn.map((s) => {
              const v = s.versions.at(-1);
              return (
                <li key={s.id} className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span>{t('lms.attemptN', 'Attempt {{n}}', { n: s.attempt })}</span>
                    {s.submitted_at && <span>{formatDateTime(s.submitted_at)}</span>}
                    {s.late && <Badge tone="warning">{t('lms.lateBy', 'late')}</Badge>}
                    {s.status === 'returned' && <Badge tone="success">{t('lms.returned', 'Returned')}</Badge>}
                  </div>
                  {v?.text_html && <RichText html={v.text_html} />}
                  {v?.link_url && (
                    <a href={v.link_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline" dir="ltr">
                      {v.link_url}
                    </a>
                  )}
                  {v?.files.map((fl) => (
                    <button key={fl.id} type="button" className="me-3 text-sm text-primary underline" onClick={() => api.download(`/files/${fl.id}?download=1`, fl.name)}>
                      {fl.name}
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {!!mine.data?.peer_reviews.length && (
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">{t('lms.peerFeedback', 'Feedback from classmates')}</h2>
          <ul className="space-y-2 text-sm">
            {mine.data.peer_reviews.map((r) => (
              <li key={r.id} className="rounded-lg bg-surface-2 p-3">
                {r.comments || '—'} <span className="text-xs text-fg-muted">— {r.reviewer ?? t('lms.classmate', 'a classmate')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a.peer_review && a.role === 'student' && <PeerReviewTasks a={a} />}
    </>
  );
}

function PeerReviewTasks({ a }: { a: Assessment }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['peer', a.id], queryFn: () => api.get<{ id: number; comments: string; submitted_at: string | null; work: { text_html: string; link_url: string } | null }[]>(`/assessments/${a.id}/peer-reviews`) });
  const [text, setText] = useState<Record<number, string>>({});
  const save = useMutation({
    mutationFn: (id: number) => api.put(`/peer-reviews/${id}`, { comments: text[id] ?? '' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['peer', a.id] });
      toast('success', t('lms.reviewSent', 'Review sent'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (!q.data?.length) return null;
  return (
    <Card className="mt-4 p-4">
      <h2 className="mb-2 font-semibold">{t('lms.reviewOthers', 'Review your classmates’ work')}</h2>
      <ul className="space-y-4">
        {q.data.map((r, i) => (
          <li key={r.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="text-xs text-fg-muted">{t('lms.workN', 'Work {{n}}', { n: i + 1 })}</div>
            {r.work?.text_html ? <RichText html={r.work.text_html} /> : <p className="text-sm text-fg-muted">{t('lms.noText', 'No text')}</p>}
            <Textarea aria-label={t('lms.yourReview', 'Your review')} defaultValue={r.comments} onChange={(e) => setText((x) => ({ ...x, [r.id]: e.target.value }))} />
            <Button size="sm" onClick={() => save.mutate(r.id)} loading={save.isPending}>
              {r.submitted_at ? t('lms.updateReview', 'Update review') : t('lms.sendReview', 'Send review')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- grading

interface SubmissionRow {
  student_id: number;
  name: string;
  roll_no: string | null;
  group_name: string | null;
  submission_id: number | null;
  attempt: number | null;
  submission_status: string | null;
  submitted_at: string | null;
  late: boolean | null;
  points: string | null;
  excused: boolean | null;
  missing: boolean | null;
  grade_status: string | null;
  late_penalty_percent: string | null;
}

function StaffWork({ a }: { a: Assessment }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const isQuiz = a.kind === 'quiz' || a.kind === 'exam';
  const subs = useQuery({ queryKey: ['submissions', a.id], queryFn: () => api.get<SubmissionRow[]>(`/assessments/${a.id}/submissions`) });
  const [extOpen, setExtOpen] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['submissions', a.id] });
    void qc.invalidateQueries({ queryKey: ['work', a.offering_id] });
  };
  const act = useMutation({
    mutationFn: (what: 'release' | 'missing' | 'publish' | 'peer') =>
      what === 'release'
        ? api.post<{ released: number }>(`/assessments/${a.id}/release`, {})
        : what === 'missing'
          ? api.post<{ marked: number }>(`/assessments/${a.id}/mark-missing`, {})
          : what === 'peer'
            ? api.post(`/assessments/${a.id}/peer-reviews/assign`, {})
            : api.patch(`/assessments/${a.id}`, { status: 'published' }),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['assessment', a.id] });
      toast('success', t('common.done', 'Done'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const selected = Number(search.get('student')) || null;
  const rows = subs.data ?? [];
  const sel = rows.find((r) => r.student_id === selected);
  const idx = rows.findIndex((r) => r.student_id === selected);
  const go = (d: number) => {
    const r = rows[idx + d];
    if (r) setSearch({ student: String(r.student_id) });
  };
  return (
    <>
      <WorkHeader
        a={a}
        actions={
          a.can_edit && (
            <>
              <Link to="edit">
                <Button variant="outline">{t('common.edit', 'Edit')}</Button>
              </Link>
              {isQuiz && (
                <Link to="questions">
                  <Button variant="outline">
                    <ListChecks className="size-4" /> {t('lms.questions', 'Questions')}
                  </Button>
                </Link>
              )}
              {a.status === 'draft' ? (
                <Button onClick={() => act.mutate('publish')}>
                  <Send className="size-4" /> {t('lms.publish', 'Publish')}
                </Button>
              ) : (
                <Button onClick={() => act.mutate('release')} loading={act.isPending}>
                  <Eye className="size-4" /> {t('lms.releaseGrades', 'Release grades')}
                </Button>
              )}
            </>
          )
        }
      />
      {a.can_edit && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => act.mutate('missing')}>
            {t('lms.markMissing', 'Mark missing work')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExtOpen(true)}>
            <CalendarClock className="size-4" /> {t('lms.extensions', 'Extensions')} ({a.extensions?.length ?? 0})
          </Button>
          {a.peer_review && (
            <Button size="sm" variant="outline" onClick={() => act.mutate('peer')}>
              {t('lms.assignPeer', 'Assign peer reviews')}
            </Button>
          )}
          {isQuiz && (
            <Link to="analysis">
              <Button size="sm" variant="outline">{t('lms.itemAnalysis', 'Item analysis')}</Button>
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className={cn('lg:col-span-2', sel && 'hidden lg:block')}>
          <DataTable
            rows={subs.data}
            loading={subs.isPending}
            error={subs.error}
            rowKey={(r) => r.student_id}
            empty={t('lms.noStudents', 'No students in this course')}
            columns={[
              {
                key: 'name',
                header: t('common.student', 'Student'),
                cell: (r) => (
                  <button type="button" onClick={() => setSearch({ student: String(r.student_id) })} className={cn('text-start font-medium hover:text-primary', r.student_id === selected && 'text-primary')}>
                    {r.name}
                    {r.group_name && <span className="block text-xs text-fg-muted">{r.group_name}</span>}
                  </button>
                ),
              },
              {
                key: 'state',
                header: t('lms.status', 'Status'),
                cell: (r) =>
                  r.excused ? (
                    <Badge>{t('lms.excused', 'Excused')}</Badge>
                  ) : r.points != null ? (
                    <Badge tone={r.grade_status === 'released' ? 'success' : 'warning'}>
                      {Number(r.points)}
                      {r.grade_status !== 'released' && ` · ${t('lms.draft', 'draft')}`}
                    </Badge>
                  ) : r.submission_status ? (
                    <Badge tone="info">{r.late ? t('lms.lateBy', 'late') : t('lms.submitted', 'Handed in')}</Badge>
                  ) : r.missing ? (
                    <Badge tone="danger">{t('lms.missing', 'Missing')}</Badge>
                  ) : (
                    <span className="text-xs text-fg-muted">—</span>
                  ),
              },
            ]}
          />
        </div>
        <div className="lg:col-span-3">
          {sel ? (
            <GradePanel a={a} row={sel} onPrev={idx > 0 ? () => go(-1) : undefined} onNext={idx < rows.length - 1 ? () => go(1) : undefined} onBack={() => setSearch({})} onSaved={refresh} />
          ) : (
            <Card className="hidden lg:block">
              <EmptyState title={t('lms.pickStudent', 'Choose a student to grade')} />
            </Card>
          )}
        </div>
      </div>
      {extOpen && <ExtensionsDialog a={a} students={rows} onClose={() => setExtOpen(false)} />}
    </>
  );
}

function GradePanel({ a, row, onPrev, onNext, onBack, onSaved }: { a: Assessment; row: SubmissionRow; onPrev?: () => void; onNext?: () => void; onBack: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const isQuiz = a.kind === 'quiz' || a.kind === 'exam';
  const sub = useQuery({
    queryKey: ['submission', row.submission_id],
    queryFn: () => api.get<{ versions: MySubmission['versions']; annotations: { id: number; comment: string; page: number }[] }>(`/submissions/${row.submission_id}`),
    enabled: !!row.submission_id,
  });
  const grade = useQuery({ queryKey: ['grade', a.id, row.student_id], queryFn: () => api.get<{ points: string | null; excused: boolean; feedback_html: string; rubric_scores: Record<string, { points: number; comment: string }> | null; status: string; feedback_file_ids: number[] } | null>(`/assessments/${a.id}/grades/${row.student_id}`) });
  const attempts = useQuery({
    queryKey: ['attempts', a.id],
    queryFn: () => api.get<{ id: number; student_id: number; attempt_no: number; status: string; score: string | null; max_score: string; integrity_events: number }[]>(`/assessments/${a.id}/attempts`),
    enabled: isQuiz,
  });
  const [points, setPoints] = useState('');
  const [feedback, setFeedback] = useState('');
  const [excused, setExcused] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [fileIds, setFileIds] = useState<number[]>([]);
  useEffect(() => {
    const g = grade.data;
    setPoints(g?.points == null ? '' : String(Number(g.points)));
    setFeedback(g?.feedback_html ?? '');
    setExcused(!!g?.excused);
    setScores(Object.fromEntries(Object.entries(g?.rubric_scores ?? {}).map(([k, v]) => [k, v.points])));
    setFileIds(g?.feedback_file_ids ?? []);
    setReason('');
  }, [grade.data, row.student_id]);
  const rubricTotal = useMemo(() => Object.values(scores).reduce((n, x) => n + x, 0), [scores]);
  const released = grade.data?.status === 'released';
  const save = useMutation({
    mutationFn: () =>
      api.put(`/assessments/${a.id}/grades`, {
        grades: [
          {
            student_id: row.student_id,
            points: points === '' ? (a.rubric && Object.keys(scores).length ? rubricTotal : null) : Number(points),
            excused,
            feedback_html: feedback,
            feedback_file_ids: fileIds,
            rubric_scores: a.rubric && Object.keys(scores).length ? Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { points: v, comment: '' }])) : null,
            reason,
          },
        ],
      }),
    onSuccess: () => {
      onSaved();
      void grade.refetch();
      toast('success', t('lms.gradeSaved', 'Grade saved'));
      onNext?.();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<{ id: number }>('POST', '/files?purpose=feedback', f),
    onSuccess: (f) => setFileIds((x) => [...x, f.id]),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const v = sub.data?.versions.at(-1);
  const myAttempts = attempts.data?.filter((x) => x.student_id === row.student_id) ?? [];
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{row.name}</h2>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="lg:hidden" onClick={onBack}>
            {t('common.back', 'Back')}
          </Button>
          <Button size="sm" variant="outline" disabled={!onPrev} onClick={onPrev}>
            {t('common.previous', 'Previous')}
          </Button>
          <Button size="sm" variant="outline" disabled={!onNext} onClick={onNext}>
            {t('common.next', 'Next')}
          </Button>
        </div>
      </div>
      {isQuiz ? (
        myAttempts.length ? (
          <ul className="space-y-1 text-sm">
            {myAttempts.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {t('lms.attemptN', 'Attempt {{n}}', { n: x.attempt_no })}: {x.score == null ? '—' : `${Number(x.score)}/${Number(x.max_score)}`}{' '}
                  {x.status === 'submitted' && <Badge tone="warning">{t('lms.needsMarking', 'needs marking')}</Badge>}
                  {x.integrity_events > 0 && <Badge tone="danger" className="ms-1">{t('lms.integrity', '{{n}} focus changes', { n: x.integrity_events })}</Badge>}
                </span>
                <Link to={`/attempts/${x.id}`} className="text-primary hover:underline">
                  {t('lms.reviewAttempt', 'Review & mark')}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{t('lms.noAttempt', 'Not attempted yet')}</p>
        )
      ) : !row.submission_id ? (
        <p className="text-sm text-fg-muted">{t('lms.notHandedIn', 'Nothing handed in yet')}</p>
      ) : sub.isPending ? (
        <Spinner />
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
            {row.submitted_at && <span>{formatDateTime(row.submitted_at)}</span>}
            {row.late && <Badge tone="warning">{t('lms.lateBy', 'late')}</Badge>}
            <span>{t('lms.versions', '{{n}} saved version(s)', { n: sub.data?.versions.length ?? 0 })}</span>
          </div>
          {v?.text_html && <RichText html={v.text_html} />}
          {v?.link_url && (
            <a href={v.link_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline" dir="ltr">
              {v.link_url}
            </a>
          )}
          {v?.files.map((fl) => (
            <div key={fl.id}>
              <button type="button" className="text-sm text-primary underline" onClick={() => api.download(`/files/${fl.id}?download=1`, fl.name)}>
                {fl.name}
              </button>
            </div>
          ))}
        </div>
      )}
      {!isQuiz && row.submission_id && <AiGradingTools submissionId={row.submission_id} hasRubric={!!a.rubric} onApplied={() => void grade.refetch()} />}
      {a.rubric && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{a.rubric.title}</legend>
          {a.rubric.criteria.map((c) => (
            <div key={c.id}>
              <div className="mb-1 text-sm">{c.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {c.levels.map((l) => (
                  <button
                    key={l.label}
                    type="button"
                    aria-pressed={scores[String(c.id)] === l.points}
                    onClick={() => setScores((s) => ({ ...s, [String(c.id)]: l.points }))}
                    className={cn('rounded-lg border px-2.5 py-1 text-xs', scores[String(c.id)] === l.points ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2')}
                  >
                    {l.label} · {l.points}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="text-sm text-fg-muted">{t('lms.rubricTotal', 'Rubric total: {{n}}', { n: rubricTotal })}</div>
        </fieldset>
      )}
      {!isQuiz && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('lms.pointsOutOf', 'Points (out of {{n}})', { n: Number(a.points) })}>
              {(x) => <Input {...x} type="number" step="0.5" min={0} value={points} onChange={(e) => setPoints(e.target.value)} placeholder={a.rubric ? String(rubricTotal) : ''} />}
            </Field>
            <label className="mt-7 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={excused} onChange={(e) => setExcused(e.target.checked)} /> {t('lms.excuse', 'Excused (doesn’t count)')}
            </label>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium">{t('lms.feedback', 'Feedback')}</div>
            <RichEditor label={t('lms.feedback', 'Feedback')} value={feedback} onChange={setFeedback} minHeight="min-h-24" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">
              <Upload className="size-4" aria-hidden /> {t('lms.feedbackUpload', 'Attach marked-up file or audio/video comment')}
              <input type="file" className="sr-only" accept="application/pdf,image/*,audio/*,video/*" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
            </label>
            {fileIds.length > 0 && <span className="text-xs text-fg-muted">{t('lms.filesAttached', '{{n}} file(s) attached', { n: fileIds.length })}</span>}
          </div>
          {released && (
            <Field label={t('lms.changeReason', 'Why is this released grade changing?')} hint={t('lms.historyKept', 'Kept in the grade history')}>
              {(x) => <Input {...x} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!a.can_edit}>
            <Check className="size-4" /> {t('lms.saveGrade', 'Save grade')}
            {onNext ? ` · ${t('common.next', 'next')}` : ''}
          </Button>
          {!released && <p className="text-xs text-fg-muted">{a.release_mode === 'manual' ? t('lms.notVisibleYet', 'Students see grades when you release them.') : t('lms.visibleNow', 'Students see this grade as soon as you save it.')}</p>}
        </>
      )}
    </Card>
  );
}

function ExtensionsDialog({ a, students, onClose }: { a: Assessment; students: SubmissionRow[]; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [student, setStudent] = useState('');
  const [due, setDue] = useState('');
  const [extra, setExtra] = useState('0');
  const [reason, setReason] = useState('');
  const add = useMutation({
    mutationFn: () => api.post(`/assessments/${a.id}/extensions`, { student_id: Number(student), due_at: fromLocal(due), extra_attempts: Number(extra), reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assessment', a.id] });
      toast('success', t('lms.extensionGiven', 'Extension given'));
      setStudent('');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/assessments/${a.id}/extensions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment', a.id] }),
  });
  return (
    <Dialog open onClose={onClose} title={t('lms.extensions', 'Extensions')}>
      <div className="space-y-4 p-5">
        <ul className="space-y-1 text-sm">
          {a.extensions?.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2">
              <span>
                {x.student_name ?? x.group_name}: {x.due_at ? formatDateTime(x.due_at) : '—'}
                {x.extra_attempts > 0 && ` · +${x.extra_attempts}`}
              </span>
              <button type="button" className="text-xs text-danger hover:underline" onClick={() => remove.mutate(x.id)}>
                {t('common.remove', 'Remove')}
              </button>
            </li>
          ))}
          {!a.extensions?.length && <li className="text-fg-muted">{t('lms.noExtensions', 'No extensions yet')}</li>}
        </ul>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label={t('common.student', 'Student')}>
            {(x) => (
              <Select {...x} required value={student} onChange={(e) => setStudent(e.target.value)}>
                <option value="">—</option>
                {students.map((s) => <option key={s.student_id} value={s.student_id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('lms.newDue', 'New due date')} optional>{(x) => <Input {...x} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
          <Field label={t('lms.extraAttempts', 'Extra attempts')}>{(x) => <Input {...x} type="number" min={0} value={extra} onChange={(e) => setExtra(e.target.value)} />}</Field>
          <Field label={t('lms.reason', 'Reason')} optional>{(x) => <Input {...x} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Button type="submit" loading={add.isPending}>
            {t('lms.giveExtension', 'Give extension')}
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

export function WorkIcon() {
  return <ClipboardList className="size-4" aria-hidden />;
}

// AI inside a course: the tutor (students), the copilot with approve-before-apply proposals and
// anonymous stuck points (teachers), grading help and process evidence in the grading panel,
// and the writing-activity tracker on the student's editor. Every AI output is labelled.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bot, Check, FileSearch, MessageCircleQuestion, Send, Sparkles, X } from 'lucide-react';
import { RichText } from '@/components/RichText';
import { api, streamPost } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, MutationError, Select, Spinner, Textarea, useToast } from '@/components/ui';

/** Every AI output carries this label. */
export const AiBadge = () => {
  const { t } = useTranslation();
  return (
    <Badge tone="info" className="gap-1">
      <Sparkles className="size-3" aria-hidden /> {t('ai.generated', 'AI-generated')}
    </Badge>
  );
};

function useAiStatus(feature: string, offeringId?: number) {
  return useQuery({ queryKey: ['/ai/status', feature, offeringId], queryFn: () => api.get<{ enabled: boolean; reason?: string }>('/ai/status', { feature, offering_id: offeringId }) });
}

// ---------------------------------------------------------------- tutor

interface Msg {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  citations: { n: number; title: string; locator: string }[];
  flag?: string | null;
}

export function TutorTab({ courseId, assessmentId }: { courseId: number; assessmentId?: number }) {
  const { t } = useTranslation();
  const status = useAiStatus('tutor', courseId);
  const convs = useQuery({ queryKey: ['/ai/tutor/conversations', courseId], queryFn: () => api.get<{ id: number; title: string; updated_at: string; assessment: string | null }[]>('/ai/tutor/conversations', { offering_id: courseId }) });
  const [current, setCurrent] = useState<number | null>(null);
  const start = useMutation({ mutationFn: () => api.post<{ id: number }>('/ai/tutor/conversations', { offering_id: courseId, assessment_id: assessmentId }), onSuccess: (r) => setCurrent(r.id) });
  if (status.data && !status.data.enabled) return <Alert>{status.data.reason}</Alert>;
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card className="space-y-2 p-3">
        <Button className="w-full" loading={start.isPending} onClick={() => start.mutate()}>
          <MessageCircleQuestion className="size-4" /> {t('ai.newQuestion', 'New conversation')}
        </Button>
        <MutationError error={start.error} />
        <ul className="space-y-1 text-sm">
          {convs.data?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setCurrent(c.id)} className={cn('w-full rounded px-2 py-1.5 text-start hover:bg-surface-2', current === c.id && 'bg-primary-soft text-primary')}>
                <div className="truncate">{c.title || t('ai.untitled', 'New conversation')}</div>
                <div className="text-xs text-fg-muted">{formatDateTime(c.updated_at)}{c.assessment && ` · ${c.assessment}`}</div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {current ? <TutorChat key={current} convId={current} courseId={courseId} /> : <EmptyState title={t('ai.tutorTitle', 'Your study coach')} description={t('ai.tutorHelp', 'Ask about anything in this course. The tutor answers from your course material, shows where each idea comes from, and coaches you with hints rather than doing the work for you.')} />}
    </div>
  );
}

function TutorChat({ convId, courseId }: { convId: number; courseId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['/ai/tutor/conversation', convId], queryFn: () => api.get<{ messages: Msg[]; assessment: { title: string; ai_policy: string } | null }>(`/ai/tutor/conversations/${convId}`) });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => setMsgs(q.data?.messages ?? []), [q.data]);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [msgs]);
  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setText('');
    setErr(null);
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', content, citations: [] }, { role: 'assistant', content: '', citations: [] }]);
    try {
      await streamPost(`/ai/tutor/conversations/${convId}/messages`, { content }, (event, data) => {
        const d = data as Msg & { text?: string };
        setMsgs((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1]!;
          copy[copy.length - 1] = event === 'delta' ? { ...last, content: last.content + (d.text ?? '') } : { ...d, role: 'assistant' };
          return copy;
        });
      });
      void qc.invalidateQueries({ queryKey: ['/ai/tutor/conversations', courseId] });
    } catch (e) {
      setErr(e);
      setMsgs((m) => m.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <Card className="flex min-h-[28rem] flex-col p-0">
      {q.data?.assessment && (
        <div className="border-b border-border px-4 py-2 text-sm">
          {q.data.assessment.title}: {q.data.assessment.ai_policy === 'limited' ? t('ai.hintsOnly', 'hints only for this work') : q.data.assessment.ai_policy === 'not_allowed' ? t('ai.noAiWork', 'no AI help for this work') : t('ai.allowedWork', 'AI help allowed')}
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.role === 'user' ? 'ms-auto bg-primary text-primary-fg' : 'bg-surface-2')}>
            {m.role === 'assistant' && (
              <div className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                <Bot className="size-3" /> <AiBadge />
              </div>
            )}
            <p className="whitespace-pre-wrap">{m.content || (busy && i === msgs.length - 1 ? '…' : '')}</p>
            {m.citations?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.citations.map((c) => (
                  <Link key={c.n} to={c.locator} className="rounded bg-surface px-2 py-0.5 text-xs text-primary hover:underline">
                    [{c.n}] {c.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <MutationError error={err} />
      <form
        className="flex gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input aria-label={t('ai.askTutor', 'Ask the tutor')} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('ai.askPlaceholder', 'Ask about the course… (any language)')} disabled={busy} />
        <Button type="submit" size="icon" aria-label={t('ai.send', 'Send')} loading={busy}>
          <Send className="size-4" />
        </Button>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- copilot

const KINDS = ['quiz_questions', 'rubric', 'course_outline', 'lesson_plan', 'differentiate', 'bulk_action'] as const;

export function CopilotTab({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const status = useAiStatus('copilot', courseId);
  const course = useQuery({ queryKey: ['course-ai-meta', courseId], queryFn: () => api.get<{ modules: { items: { id: number; title: string; kind: string }[] }[] }>(`/courses/${courseId}`) });
  const work = useQuery({ queryKey: ['/courses/assessments', courseId], queryFn: () => api.get<{ id: number; title: string; kind: string }[]>(`/courses/${courseId}/assessments`) });
  const kb = useQuery({ queryKey: ['/ai/kb/status', courseId], queryFn: () => api.get<{ chunks: number; sources: number; indexed_at: string | null }>('/ai/kb/status', { offering_id: courseId }) });
  const stuck = useQuery({ queryKey: ['/ai/tutor/stuck-points', courseId], queryFn: () => api.get<{ title: string; questions: number; students: number; samples: string[] }[]>('/ai/tutor/stuck-points', { offering_id: courseId }) });
  const reindex = useMutation({ mutationFn: () => api.post('/ai/kb/reindex', { offering_id: courseId }), onSuccess: () => void kb.refetch() });
  const toggle = useMutation({ mutationFn: (on: boolean) => api.patch(`/courses/${courseId}/ai`, { ai_enabled: on }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['/ai/status'] }) });
  const [kind, setKind] = useState<(typeof KINDS)[number]>('quiz_questions');
  const [v, setV] = useState({ items: [] as number[], count: '5', difficulty: 'mixed', assessment_id: '', syllabus: '', topic: '', minutes: '40', variant: 'easier', language: 'ur', request: '' });
  const [proposal, setProposal] = useState<number | null>(null);
  const pages = (course.data?.modules ?? []).flatMap((m) => m.items).filter((i) => i.kind === 'page');
  const gen = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>(`/ai/copilot/${kind}`, {
        offering_id: courseId,
        content_item_ids: v.items.length ? v.items : undefined,
        count: Number(v.count),
        difficulty: v.difficulty,
        assessment_id: v.assessment_id || undefined,
        syllabus: v.syllabus || undefined,
        topic: v.topic || undefined,
        minutes: Number(v.minutes),
        variant: v.variant,
        language: v.language,
        request: v.request || undefined,
      }),
    onSuccess: (r) => setProposal(r.id),
  });
  const labels: Record<string, string> = {
    quiz_questions: t('ai.kQuiz', 'Quiz questions'),
    rubric: t('ai.kRubric', 'Rubric'),
    course_outline: t('ai.kOutline', 'Course outline'),
    lesson_plan: t('ai.kLesson', 'Lesson plan'),
    differentiate: t('ai.kDiff', 'Easier / harder / translated'),
    bulk_action: t('ai.kBulk', 'Do it for me'),
  };
  return (
    <div className="space-y-4">
      {status.data && !status.data.enabled && <Alert>{status.data.reason}</Alert>}
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2" role="tablist">
          {KINDS.map((k) => (
            <Button key={k} size="sm" variant={k === kind ? 'primary' : 'outline'} onClick={() => setKind(k)}>
              {labels[k]}
            </Button>
          ))}
        </div>
        {(kind === 'quiz_questions' || kind === 'differentiate' || kind === 'lesson_plan') && (
          <Field label={t('ai.fromPages', 'From these pages')}>
            {() => (
              <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                {pages.length === 0 && <span className="text-sm text-fg-muted">{t('ai.noPages', 'No pages in this course yet')}</span>}
                {pages.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-sm">
                    <input type="checkbox" checked={v.items.includes(p.id)} onChange={(e) => setV({ ...v, items: e.target.checked ? [...v.items, p.id] : v.items.filter((x) => x !== p.id) })} />
                    {p.title}
                  </label>
                ))}
              </div>
            )}
          </Field>
        )}
        {kind === 'quiz_questions' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('ai.howMany', 'How many')}>{(a) => <Input {...a} type="number" min={1} max={30} value={v.count} onChange={(e) => setV({ ...v, count: e.target.value })} />}</Field>
            <Field label={t('ai.difficulty', 'Difficulty')}>{(a) => <Select {...a} value={v.difficulty} onChange={(e) => setV({ ...v, difficulty: e.target.value })}>{['mixed', 'easy', 'medium', 'hard'].map((d) => <option key={d} value={d}>{d}</option>)}</Select>}</Field>
          </div>
        )}
        {kind === 'rubric' && (
          <Field label={t('ai.forWork', 'For this work')}>{(a) => <Select {...a} value={v.assessment_id} onChange={(e) => setV({ ...v, assessment_id: e.target.value })}><option value="">{t('common.choose', 'Choose…')}</option>{work.data?.filter((w) => w.kind !== 'quiz').map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</Select>}</Field>
        )}
        {kind === 'course_outline' && <Field label={t('ai.syllabus', 'Syllabus')}>{(a) => <Textarea {...a} rows={6} value={v.syllabus} onChange={(e) => setV({ ...v, syllabus: e.target.value })} placeholder={t('ai.syllabusHint', 'Paste the syllabus or topic list')} />}</Field>}
        {kind === 'lesson_plan' && (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label={t('ai.topic', 'Topic')}>{(a) => <Input {...a} value={v.topic} onChange={(e) => setV({ ...v, topic: e.target.value })} />}</Field>
            <Field label={t('ai.minutes', 'Minutes')}>{(a) => <Input {...a} type="number" value={v.minutes} onChange={(e) => setV({ ...v, minutes: e.target.value })} />}</Field>
          </div>
        )}
        {kind === 'differentiate' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('ai.version', 'Version')}>{(a) => <Select {...a} value={v.variant} onChange={(e) => setV({ ...v, variant: e.target.value })}><option value="easier">{t('ai.easier', 'Easier')}</option><option value="harder">{t('ai.harder', 'Harder')}</option><option value="translated">{t('ai.translated', 'Translated')}</option></Select>}</Field>
            {v.variant === 'translated' && <Field label={t('ai.language', 'Language')}>{(a) => <Select {...a} value={v.language} onChange={(e) => setV({ ...v, language: e.target.value })}><option value="ur">اردو</option><option value="ar">العربية</option><option value="en">English</option></Select>}</Field>}
          </div>
        )}
        {kind === 'bulk_action' && <Field label={t('ai.request', 'What should happen?')} hint={t('ai.requestHint', 'e.g. extend the due date of "Fractions worksheet" by 2 days for section B')}>{(a) => <Input {...a} value={v.request} onChange={(e) => setV({ ...v, request: e.target.value })} />}</Field>}
        <MutationError error={gen.error} />
        <Button loading={gen.isPending} disabled={status.data?.enabled === false} onClick={() => gen.mutate()}>
          <Sparkles className="size-4" /> {t('ai.draft', 'Draft it')}
        </Button>
        <p className="text-xs text-fg-muted">{t('ai.approveNote', 'You see a proposal first; nothing in the course changes until you apply it.')}</p>
      </Card>
      {proposal && <ProposalView id={proposal} onDone={(applied) => { setProposal(null); toast('success', applied ? t('ai.applied', 'Applied') : t('ai.rejected', 'Rejected')); void qc.invalidateQueries({ queryKey: ['course', courseId] }); }} />}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-4">
          <h3 className="font-semibold">{t('ai.stuck', 'Where students get stuck')}</h3>
          <p className="text-xs text-fg-muted">{t('ai.stuckHelp', 'Topics students asked the tutor about in the last 30 days. Anonymous; example questions only when three or more students asked.')}</p>
          {!stuck.data?.length ? <p className="text-sm text-fg-muted">{t('ai.noStuck', 'No questions yet.')}</p> : (
            <ul className="divide-y divide-border text-sm">
              {stuck.data.map((s, i) => (
                <li key={i} className="py-2">
                  <div className="flex justify-between"><span className="font-medium">{s.title}</span><span className="text-fg-muted">{t('ai.qByStudents', '{{q}} questions · {{s}} students', { q: s.questions, s: s.students })}</span></div>
                  {s.samples.map((x, j) => <p key={j} className="text-xs text-fg-muted">“{x}”</p>)}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3 p-4">
          <h3 className="font-semibold">{t('ai.courseAi', 'AI in this course')}</h3>
          <p className="text-sm">{t('ai.kbStatus', '{{n}} passages from {{s}} sources indexed for the tutor.', { n: kb.data?.chunks ?? 0, s: kb.data?.sources ?? 0 })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" loading={reindex.isPending} onClick={() => reindex.mutate()}>{t('ai.reindex', 'Update the index')}</Button>
            <Button size="sm" variant="ghost" onClick={() => toggle.mutate(!(status.data?.enabled ?? true))}>{status.data?.enabled === false ? t('ai.turnOn', 'Turn AI on for this course') : t('ai.turnOff', 'Turn AI off for this course')}</Button>
          </div>
          <MutationError error={reindex.error ?? toggle.error} />
        </Card>
      </div>
    </div>
  );
}

interface Action {
  id: number;
  kind: string;
  status: string;
  proposal: Record<string, unknown>;
  model: string;
}

/** Preview a proposal, edit it (as JSON for now), then apply or reject. */
export function ProposalView({ id, onDone }: { id: number; onDone: (applied: boolean) => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/ai/actions', id], queryFn: () => api.get<Action>(`/ai/actions/${id}`) });
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState('');
  const [jsonErr, setJsonErr] = useState('');
  useEffect(() => setJson(q.data ? JSON.stringify(q.data.proposal, null, 2) : ''), [q.data]);
  const apply = useMutation({
    mutationFn: () => {
      let edited: unknown;
      if (editing) {
        try {
          edited = JSON.parse(json);
        } catch {
          setJsonErr(t('ai.badJson', 'That is not valid JSON'));
          throw new Error('invalid');
        }
      }
      return api.post(`/ai/actions/${id}/apply`, edited === undefined ? {} : { edited });
    },
    onSuccess: () => onDone(true),
  });
  const reject = useMutation({ mutationFn: () => api.post(`/ai/actions/${id}/reject`), onSuccess: () => onDone(false) });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Spinner />;
  const p = q.data.proposal;
  return (
    <Card className="space-y-3 border-primary/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t('ai.proposal', 'Proposal')}</h3>
        <div className="flex items-center gap-2 text-xs text-fg-muted"><AiBadge /> {q.data.model}</div>
      </div>
      {editing ? (
        <Textarea aria-label={t('ai.editProposal', 'Edit the proposal')} rows={14} className="font-mono text-xs" value={json} onChange={(e) => { setJson(e.target.value); setJsonErr(''); }} />
      ) : (
        <ProposalPreview kind={q.data.kind} p={p} />
      )}
      {jsonErr && <Alert tone="danger">{jsonErr}</Alert>}
      <MutationError error={apply.error instanceof Error && apply.error.message === 'invalid' ? null : apply.error} />
      <div className="flex flex-wrap gap-2">
        <Button loading={apply.isPending} onClick={() => apply.mutate()}><Check className="size-4" /> {editing ? t('ai.applyEdited', 'Apply my version') : t('ai.apply', 'Apply')}</Button>
        <Button variant="outline" onClick={() => setEditing(!editing)}>{editing ? t('ai.preview', 'Preview') : t('ai.edit', 'Edit first')}</Button>
        <Button variant="ghost" loading={reject.isPending} onClick={() => reject.mutate()}><X className="size-4" /> {t('ai.reject', 'Reject')}</Button>
      </div>
    </Card>
  );
}

function ProposalPreview({ kind, p }: { kind: string; p: Record<string, unknown> }) {
  const { t } = useTranslation();
  if (kind === 'quiz_questions') {
    const qs = (p.questions ?? []) as { prompt: string; options?: { id: string; text: string }[]; correct: unknown; difficulty: string; clo_code?: string | null }[];
    return (
      <ol className="space-y-3 text-sm">
        {qs.map((q, i) => (
          <li key={i}>
            <div className="font-medium">{i + 1}. {q.prompt} <Badge>{q.difficulty}</Badge> {q.clo_code && <Badge tone="info">{q.clo_code}</Badge>}</div>
            {q.options && <ul className="ms-5 list-disc">{q.options.map((o) => <li key={o.id} className={o.id === q.correct ? 'font-semibold text-success' : ''}>{o.text}</li>)}</ul>}
          </li>
        ))}
      </ol>
    );
  }
  if (kind === 'rubric') {
    const r = p as { title: string; criteria: { title: string; levels: { points: number; label: string }[] }[] };
    return (
      <div className="overflow-x-auto text-sm">
        <h4 className="font-medium">{r.title}</h4>
        <table className="mt-2 w-full"><tbody>{r.criteria.map((c, i) => <tr key={i} className="border-t border-border"><td className="py-1 pe-3 font-medium">{c.title}</td>{c.levels.map((l, j) => <td key={j} className="px-2 py-1 text-xs">{l.points} · {l.label}</td>)}</tr>)}</tbody></table>
      </div>
    );
  }
  if (kind === 'course_outline') return <ul className="space-y-1 text-sm">{((p.modules ?? []) as { title: string; items: { title: string }[] }[]).map((m, i) => <li key={i}><span className="font-medium">{m.title}</span> <span className="text-fg-muted">— {m.items.map((x) => x.title).join(', ')}</span></li>)}</ul>;
  if (kind === 'bulk_action') {
    const b = p as { explanation: string; targets: { title: string; section: string | null; due_at: string | null; new_due_at: string | null }[] };
    return (
      <div className="text-sm">
        <p>{b.explanation}</p>
        {b.targets.length === 0 ? <Alert tone="warning">{t('ai.noTargets', 'Nothing matched in your courses.')}</Alert> : <ul className="mt-2 list-disc ps-5">{b.targets.map((x, i) => <li key={i}>{x.title} {x.section && `(${x.section})`} {x.new_due_at && `: ${formatDateTime(x.due_at)} → ${formatDateTime(x.new_due_at)}`}</li>)}</ul>}
      </div>
    );
  }
  if (typeof p.html === 'string') return <RichText html={p.html} className="text-sm" />;
  return <pre className="max-h-80 overflow-auto rounded bg-surface-2 p-3 text-xs whitespace-pre-wrap">{JSON.stringify(p, null, 2)}</pre>;
}

// ---------------------------------------------------------------- grading panel

/** In the grading panel: AI rubric scores / feedback drafts (as proposals), process report, viva. */
export function AiGradingTools({ submissionId, hasRubric, onApplied }: { submissionId: number; hasRubric: boolean; onApplied: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [proposal, setProposal] = useState<number | null>(null);
  const [report, setReport] = useState(false);
  const gen = useMutation({ mutationFn: (kind: 'grading' | 'feedback_draft') => api.post<{ id: number }>(`/ai/copilot/${kind}`, { submission_id: submissionId }), onSuccess: (r) => setProposal(r.id) });
  const viva = useMutation({ mutationFn: () => api.post(`/ai/evidence/submissions/${submissionId}/viva`), onSuccess: () => toast('success', t('ai.vivaSent', 'Questions sent to the student')) });
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex flex-wrap gap-2">
        {hasRubric && <Button size="sm" variant="outline" loading={gen.isPending && gen.variables === 'grading'} onClick={() => gen.mutate('grading')}><Sparkles className="size-4" /> {t('ai.suggestScores', 'Suggest rubric scores')}</Button>}
        <Button size="sm" variant="outline" loading={gen.isPending && gen.variables === 'feedback_draft'} onClick={() => gen.mutate('feedback_draft')}><Sparkles className="size-4" /> {t('ai.draftFeedback', 'Draft feedback')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setReport(true)}><FileSearch className="size-4" /> {t('ai.process', 'How it was written')}</Button>
        <Button size="sm" variant="ghost" loading={viva.isPending} onClick={() => viva.mutate()}>{t('ai.askExplain', 'Ask the student to explain')}</Button>
      </div>
      <MutationError error={gen.error ?? viva.error} />
      {proposal && <ProposalView id={proposal} onDone={(applied) => { setProposal(null); if (applied) { onApplied(); toast('success', t('ai.draftSaved', 'Saved as a draft grade — release it when you are ready')); } }} />}
      {report && <ProcessReport submissionId={submissionId} onClose={() => setReport(false)} />}
    </div>
  );
}

function ProcessReport({ submissionId, onClose }: { submissionId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['/ai/evidence', submissionId],
    queryFn: () => api.get<{ versions: { version: number; at: string; words: number }[]; activity: { active_seconds: number; keystrokes: number; pastes: number; pasted_chars: number } | null; similar: { a: { name: string | null }; b: { name: string | null }; similarity: number; shared: string[] }[]; viva: { questions: string[]; answers: string[]; status: string }[]; notes: string[] }>(`/ai/evidence/submissions/${submissionId}`),
  });
  return (
    <Dialog open onClose={onClose} title={t('ai.process', 'How it was written')} description={t('ai.processHelp', 'Facts about how the work came to be, for you to weigh. Acadex never guesses whether AI wrote it.')}>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Spinner /> : (
        <div className="space-y-3 text-sm">
          {q.data.notes.length > 0 && <Alert tone="warning"><ul className="list-disc ps-5">{q.data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Alert>}
          <div>
            <h4 className="font-semibold">{t('ai.drafts', 'Drafts')}</h4>
            <ul>{q.data.versions.map((v) => <li key={v.version}>{t('ai.versionLine', 'Version {{v}} · {{w}} words · {{at}}', { v: v.version, w: v.words, at: formatDateTime(v.at) })}</li>)}</ul>
          </div>
          {q.data.activity && <p>{t('ai.activityLine', '{{m}} minutes writing, {{k}} key presses, {{p}} pastes ({{c}} characters)', { m: Math.round(q.data.activity.active_seconds / 60), k: q.data.activity.keystrokes, p: q.data.activity.pastes, c: q.data.activity.pasted_chars })}</p>}
          {q.data.similar.map((s, i) => <p key={i}>{t('ai.similarLine', 'Wording {{pct}}% the same as {{name}}', { pct: Math.round(s.similarity * 100), name: s.a.name === s.b.name ? '' : `${s.a.name} / ${s.b.name}` })}</p>)}
          {q.data.viva.map((v, i) => (
            <div key={i}>
              <h4 className="font-semibold">{t('ai.viva', 'Explain your work')} <AiBadge /></h4>
              <ol className="list-decimal ps-5">{v.questions.map((qq, j) => <li key={j}>{qq}<br /><span className="text-fg-muted">{v.answers[j] ?? t('ai.notAnswered', 'not answered yet')}</span></li>)}</ol>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- writing activity

/** Counts active writing time, key presses and pastes in an editor and reports them now and then. */
export function useActivityTracker(assessmentId: number, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let keys = 0;
    let pastes = 0;
    let pasted = 0;
    let lastInput = 0;
    let active = 0;
    const onKey = () => {
      keys++;
      lastInput = Date.now();
    };
    const onPaste = (e: ClipboardEvent) => {
      pastes++;
      pasted += e.clipboardData?.getData('text').length ?? 0;
      lastInput = Date.now();
    };
    const tick = setInterval(() => {
      if (Date.now() - lastInput < 60_000 && document.visibilityState === 'visible') active += 5;
    }, 5000);
    const flush = () => {
      if (!keys && !pastes && !active) return;
      const body = { active_seconds: active, keystrokes: keys, pastes, pasted_chars: pasted };
      keys = pastes = pasted = active = 0;
      void api.put(`/ai/activity/${assessmentId}`, body).catch(() => {});
    };
    const send = setInterval(flush, 30_000);
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
    return () => {
      flush();
      clearInterval(tick);
      clearInterval(send);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('paste', onPaste);
    };
  }, [assessmentId, enabled]);
  return ref;
}

// ---------------------------------------------------------------- viva (students)

export function VivaPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/ai/viva/mine'], queryFn: () => api.get<{ id: number; questions: string[]; answers: string[]; status: string; assessment: string }[]>('/ai/viva/mine') });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('ai.viva', 'Explain your work')}</h1>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Spinner /> : q.data.length === 0 ? <EmptyState title={t('ai.noViva', 'No questions for you right now')} /> : q.data.map((v) => <VivaCard key={v.id} v={v} onDone={() => void q.refetch()} />)}
    </div>
  );
}

function VivaCard({ v, onDone }: { v: { id: number; questions: string[]; answers: string[]; status: string; assessment: string }; onDone: () => void }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<string[]>(v.questions.map((_, i) => v.answers[i] ?? ''));
  const m = useMutation({ mutationFn: () => api.post(`/ai/viva/${v.id}/answers`, { answers }), onSuccess: onDone });
  const open = v.status === 'open';
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{v.assessment}</h2><AiBadge /></div>
      {v.questions.map((q, i) => (
        <Field key={i} label={q}>{(a) => <Textarea {...a} disabled={!open} value={answers[i]} onChange={(e) => setAnswers(answers.map((x, j) => (j === i ? e.target.value : x)))} />}</Field>
      ))}
      <MutationError error={m.error} />
      {open ? <Button loading={m.isPending} onClick={() => m.mutate()}>{t('ai.sendAnswers', 'Send my answers')}</Button> : <Badge tone="success">{t('ai.answered', 'Answered')}</Badge>}
    </Card>
  );
}


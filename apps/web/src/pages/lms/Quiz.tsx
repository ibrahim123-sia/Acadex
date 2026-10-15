// Quizzes: building one from the question bank (fixed questions and random pools), taking a
// timed attempt (answers save as you go, integrity signals are reported), marking essays, and
// the item analysis.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Shuffle, Timer, Trash2 } from 'lucide-react';
import { QUESTION_TYPE_LABELS, QUESTION_TYPES, type QuestionType } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, DataTable, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { RichEditor, RichText } from '@/components/RichText';

interface Bank {
  id: number;
  name: string;
  course_id: number | null;
  course_name: string | null;
  questions: number;
  tags: string[];
}
interface Question {
  id: number;
  type: QuestionType;
  prompt_html: string;
  data: Record<string, unknown>;
  points: string;
  tags: string[];
}
type QuizItem = { question_id: number; points: number | null } | { pool_bank_id: number; pool_tag: string | null; pool_count: number; points: number | null };

export function QuizBuilderPage() {
  const { t } = useTranslation();
  const workId = Number(useParams().workId);
  const toast = useToast();
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ['quiz-items', workId],
    queryFn: () => api.get<{ question_id: number | null; pool_bank_id: number | null; pool_tag: string | null; pool_count: number | null; points: string | null; type: string | null; prompt_html: string | null; pool_bank_name: string | null }[]>(`/assessments/${workId}/questions`),
  });
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<Bank[]>('/question-banks') });
  const [bankId, setBankId] = useState<number | null>(null);
  const questions = useQuery({ queryKey: ['bank', bankId], queryFn: () => api.get<Question[]>(`/question-banks/${bankId}/questions`), enabled: !!bankId });
  const [items, setItems] = useState<QuizItem[]>([]);
  useEffect(() => {
    if (current.data)
      setItems(
        current.data.map((x) =>
          x.question_id ? { question_id: x.question_id, points: x.points == null ? null : Number(x.points) } : { pool_bank_id: x.pool_bank_id!, pool_tag: x.pool_tag, pool_count: x.pool_count!, points: x.points == null ? null : Number(x.points) }
        )
      );
  }, [current.data]);
  useEffect(() => {
    if (!bankId && banks.data?.[0]) setBankId(banks.data[0].id);
  }, [banks.data, bankId]);
  const save = useMutation({
    mutationFn: () => api.put(`/assessments/${workId}/questions`, { items }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quiz-items', workId] });
      toast('success', t('common.saved', 'Saved'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const newBank = useMutation({
    mutationFn: (name: string) => api.post<Bank>('/question-banks', { name }),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ['banks'] });
      setBankId(b.id);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const [pool, setPool] = useState({ count: '3', tag: '' });
  const label = (it: QuizItem) => {
    if ('question_id' in it) {
      const q = questions.data?.find((x) => x.id === it.question_id) ?? current.data?.find((x) => x.question_id === it.question_id);
      return q ? <RichText html={q.prompt_html ?? ''} /> : `#${it.question_id}`;
    }
    return (
      <span className="flex items-center gap-2 text-sm">
        <Shuffle className="size-4" aria-hidden /> {t('lms.poolOf', '{{n}} random from {{bank}}', { n: it.pool_count, bank: banks.data?.find((b) => b.id === it.pool_bank_id)?.name ?? '' })}
        {it.pool_tag && <Badge>{it.pool_tag}</Badge>}
      </span>
    );
  };
  return (
    <>
      <PageHeader
        title={t('lms.quizQuestions', 'Quiz questions')}
        subtitle={<Link to=".." relative="path" className="hover:underline">{t('common.back', 'Back')}</Link>}
        actions={
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {t('common.save', 'Save')} ({items.length})
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">{t('lms.inThisQuiz', 'In this quiz')}</h2>
          {!items.length ? (
            <EmptyState title={t('lms.noQuestionsYet', 'Add questions from the bank')} />
          ) : (
            <ol className="space-y-2">
              {items.map((it, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
                  <span className="mt-0.5 text-xs text-fg-muted">{i + 1}.</span>
                  <div className="min-w-0 flex-1">{label(it)}</div>
                  <button type="button" aria-label={t('common.remove', 'Remove')} onClick={() => setItems((x) => x.filter((_, j) => j !== i))} className="text-fg-muted hover:text-danger">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('lms.questionBank', 'Question bank')} className="min-w-48 flex-1">
              {(a) => (
                <Select {...a} value={bankId ?? ''} onChange={(e) => setBankId(Number(e.target.value))}>
                  {banks.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.questions})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="outline" onClick={() => { const n = window.prompt(t('lms.bankName', 'Name of the new bank')); if (n) newBank.mutate(n); }}>
              <Plus className="size-4" /> {t('lms.newBank', 'New bank')}
            </Button>
          </div>
          {bankId && (
            <>
              <div className="flex flex-wrap items-end gap-2 rounded-lg bg-surface-2 p-2">
                <Field label={t('lms.randomPick', 'Random questions')} className="w-28">
                  {(a) => <Input {...a} type="number" min={1} value={pool.count} onChange={(e) => setPool((p) => ({ ...p, count: e.target.value }))} />}
                </Field>
                <Field label={t('lms.withTag', 'with tag')} optional className="w-32">
                  {(a) => <Input {...a} value={pool.tag} onChange={(e) => setPool((p) => ({ ...p, tag: e.target.value }))} />}
                </Field>
                <Button variant="outline" onClick={() => setItems((x) => [...x, { pool_bank_id: bankId, pool_tag: pool.tag || null, pool_count: Number(pool.count) || 1, points: null }])}>
                  <Shuffle className="size-4" /> {t('lms.addPool', 'Add pool')}
                </Button>
              </div>
              <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
                {questions.data?.map((q) => {
                  const inQuiz = items.some((x) => 'question_id' in x && x.question_id === q.id);
                  return (
                    <li key={q.id} className="flex items-start gap-2 rounded-lg border border-border p-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap gap-1 text-xs text-fg-muted">
                          <Badge>{QUESTION_TYPE_LABELS[q.type]}</Badge> {Number(q.points)} pt {q.tags.map((tg) => <Badge key={tg}>{tg}</Badge>)}
                        </div>
                        <RichText html={q.prompt_html} />
                      </div>
                      <Button size="sm" variant={inQuiz ? 'secondary' : 'outline'} disabled={inQuiz} onClick={() => setItems((x) => [...x, { question_id: q.id, points: null }])}>
                        {inQuiz ? <Check className="size-4" /> : <Plus className="size-4" />}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <QuestionForm bankId={bankId} onSaved={() => qc.invalidateQueries({ queryKey: ['bank', bankId] })} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

/** Writing a question: the type decides which answer fields appear. */
function QuestionForm({ bankId, onSaved }: { bankId: number; onSaved: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [type, setType] = useState<QuestionType>('mcq');
  const [prompt, setPrompt] = useState('');
  const [points, setPoints] = useState('1');
  const [tags, setTags] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correct, setCorrect] = useState<number[]>([0]);
  const [answer, setAnswer] = useState('');
  const [tolerance, setTolerance] = useState('0');
  const [pairs, setPairs] = useState([{ left: '', right: '' }, { left: '', right: '' }]);
  const [lines, setLines] = useState(''); // ordering items / accepted answers / blanks
  const [tf, setTf] = useState(true);
  const [expr, setExpr] = useState('a * b');
  const [vars, setVars] = useState('a:1-10, b:1-10');
  const data = (): Record<string, unknown> => {
    const opts = options.map((o, i) => ({ id: String.fromCharCode(97 + i), text: o })).filter((o) => o.text.trim());
    switch (type) {
      case 'mcq':
        return { options: opts, correct: String.fromCharCode(97 + (correct[0] ?? 0)) };
      case 'multi':
        return { options: opts, correct: correct.map((c) => String.fromCharCode(97 + c)), partial_credit: true };
      case 'true_false':
        return { correct: tf };
      case 'short':
        return { accepted: lines.split('\n').map((l) => l.trim()).filter(Boolean), case_sensitive: false };
      case 'numeric':
        return { answer: Number(answer), tolerance: Number(tolerance) };
      case 'formula':
        return {
          expression: expr,
          variables: vars.split(',').map((v) => {
            const [name, range] = v.split(':').map((x) => x.trim());
            const [min, max] = (range ?? '1-10').split('-').map(Number);
            return { name, min, max, decimals: 0 };
          }),
          tolerance: Number(tolerance) || 0.01,
        };
      case 'matching':
        return { pairs: pairs.filter((p) => p.left && p.right) };
      case 'ordering':
        return { items: lines.split('\n').map((l) => l.trim()).filter(Boolean) };
      case 'fill_blank':
        return { blanks: lines.split('\n').map((l) => ({ accepted: l.split('|').map((x) => x.trim()).filter(Boolean) })).filter((b) => b.accepted.length), case_sensitive: false };
      case 'essay':
        return { min_words: 0, max_words: null };
      case 'file_upload':
        return { max_files: 1 };
      case 'audio':
        return { max_seconds: 120 };
    }
  };
  const save = useMutation({
    mutationFn: () => api.post('/questions', { bank_id: bankId, type, prompt_html: prompt, data: data(), points: Number(points), tags: tags.split(',').map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => {
      setPrompt('');
      setLines('');
      setOptions(['', '', '', '']);
      onSaved();
      toast('success', t('lms.questionAdded', 'Question added to the bank'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const multiple = type === 'multi';
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t('lms.writeQuestion', 'Write a new question')}</summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('lms.questionType', 'Type')} className="sm:col-span-2">
            {(a) => (
              <Select {...a} value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
                {QUESTION_TYPES.map((qt) => <option key={qt} value={qt}>{QUESTION_TYPE_LABELS[qt]}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('lms.points', 'Points')}>{(a) => <Input {...a} type="number" min={0} step="0.5" value={points} onChange={(e) => setPoints(e.target.value)} />}</Field>
        </div>
        <RichEditor label={t('lms.prompt', 'Question')} value={prompt} onChange={setPrompt} minHeight="min-h-20" />
        {type === 'formula' && <p className="text-xs text-fg-muted">{t('lms.formulaHelp', 'Write {a} and {b} in the question; each student gets their own values.')}</p>}
        {type === 'fill_blank' && <p className="text-xs text-fg-muted">{t('lms.blankHelp', 'Mark blanks in the question as [[1]], [[2]]…; below, one line per blank with accepted answers separated by |.')}</p>}
        {(type === 'mcq' || type === 'multi') &&
          options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name="correct"
                aria-label={t('lms.correctOption', 'Correct answer')}
                checked={correct.includes(i)}
                onChange={(e) => setCorrect(multiple ? (e.target.checked ? [...correct, i] : correct.filter((c) => c !== i)) : [i])}
              />
              <Input aria-label={t('lms.optionN', 'Option {{n}}', { n: i + 1 })} value={o} onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
            </div>
          ))}
        {type === 'true_false' && (
          <Select aria-label={t('lms.correctAnswer', 'Correct answer')} value={tf ? 'true' : 'false'} onChange={(e) => setTf(e.target.value === 'true')}>
            <option value="true">{t('lms.true', 'True')}</option>
            <option value="false">{t('lms.false', 'False')}</option>
          </Select>
        )}
        {(type === 'numeric' || type === 'formula') && (
          <div className="grid gap-3 sm:grid-cols-2">
            {type === 'numeric' ? (
              <Field label={t('lms.answer', 'Answer')}>{(a) => <Input {...a} type="number" step="any" value={answer} onChange={(e) => setAnswer(e.target.value)} />}</Field>
            ) : (
              <>
                <Field label={t('lms.expression', 'Formula')}>{(a) => <Input {...a} dir="ltr" value={expr} onChange={(e) => setExpr(e.target.value)} />}</Field>
                <Field label={t('lms.variables', 'Variables (name:min-max)')}>{(a) => <Input {...a} dir="ltr" value={vars} onChange={(e) => setVars(e.target.value)} />}</Field>
              </>
            )}
            <Field label={t('lms.tolerance', 'Allowed difference')}>{(a) => <Input {...a} type="number" step="any" min={0} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />}</Field>
          </div>
        )}
        {type === 'matching' &&
          pairs.map((p, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <Input aria-label={t('lms.left', 'Left')} value={p.left} onChange={(e) => setPairs((x) => x.map((y, j) => (j === i ? { ...y, left: e.target.value } : y)))} />
              <Input aria-label={t('lms.right', 'Matches')} value={p.right} onChange={(e) => setPairs((x) => [...x.map((y, j) => (j === i ? { ...y, right: e.target.value } : y)), ...(i === x.length - 1 && e.target.value ? [{ left: '', right: '' }] : [])])} />
            </div>
          ))}
        {(type === 'short' || type === 'ordering' || type === 'fill_blank') && (
          <Field label={type === 'ordering' ? t('lms.inOrder', 'Items in the right order, one per line') : type === 'short' ? t('lms.accepted', 'Accepted answers, one per line') : t('lms.blanks', 'Answers per blank')}>
            {(a) => <Textarea {...a} value={lines} onChange={(e) => setLines(e.target.value)} />}
          </Field>
        )}
        <Field label={t('lms.tags', 'Tags (for random pools)')} optional>{(a) => <Input {...a} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fractions, easy" />}</Field>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!prompt.trim()}>
          <Plus className="size-4" /> {t('lms.addToBank', 'Add to bank')}
        </Button>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- taking a quiz

interface AttemptView {
  id: number;
  assessment_id: number;
  title: string;
  attempt_no: number;
  status: string;
  deadline_at: string | null;
  score: string | null;
  max_score: string;
  questions: { n: number; question_id: number; type: QuestionType; prompt_html: string; points: number; view: Record<string, unknown>; response: unknown; earned?: number | null; feedback?: string; answer?: Record<string, unknown> }[];
}

export function AttemptPage() {
  const { t } = useTranslation();
  const id = Number(useParams().attemptId);
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => api.get<AttemptView>(`/attempts/${id}`) });
  const me = useQuery({ queryKey: ['attempt-role', id], queryFn: () => api.get<{ role: string }>(`/assessments/${q.data!.assessment_id}`), enabled: !!q.data });
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [left, setLeft] = useState<number | null>(null);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const inProgress = q.data?.status === 'in_progress';
  useEffect(() => {
    if (q.data) setAnswers(Object.fromEntries(q.data.questions.map((x) => [x.question_id, x.response])));
  }, [q.data]);
  // the countdown; time is kept by the server, this only shows it
  useEffect(() => {
    if (!q.data?.deadline_at || !inProgress) return;
    const end = new Date(q.data.deadline_at).getTime();
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [q.data, inProgress]);
  // integrity signals (shown to the teacher; never decide anything by themselves)
  useEffect(() => {
    if (!inProgress) return;
    const report = (kind: string) => api.post(`/attempts/${id}/events`, { kind }).catch(() => {});
    const onVis = () => document.visibilityState === 'hidden' && report('visibility_hidden');
    const onPaste = () => report('paste');
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('paste', onPaste);
    };
  }, [inProgress, id]);
  const submit = useMutation({
    mutationFn: async () => {
      await Promise.all(Object.keys(timers.current).map((k) => flush(Number(k))));
      return api.post<{ status: string; score?: string }>(`/attempts/${id}/submit`, {});
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attempt', id] });
      toast('success', t('lms.quizSubmitted', 'Handed in'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  useEffect(() => {
    if (left === 0 && inProgress && !submit.isPending) submit.mutate();
  }, [left, inProgress, submit]);
  const flush = async (qid: number) => {
    clearTimeout(timers.current[qid]);
    delete timers.current[qid];
    try {
      await api.put(`/attempts/${id}/answers`, { question_id: qid, response: answersRef.current[qid] ?? null });
      setSaved((s) => ({ ...s, [qid]: true }));
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const answer = (qid: number, v: unknown) => {
    setAnswers((a) => ({ ...a, [qid]: v }));
    setSaved((s) => ({ ...s, [qid]: false }));
    clearTimeout(timers.current[qid]);
    timers.current[qid] = setTimeout(() => void flush(qid), 600);
  };
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const staff = me.data?.role === 'staff';
  const mins = left == null ? null : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <>
      <PageHeader
        title={a.title}
        subtitle={t('lms.attemptN', 'Attempt {{n}}', { n: a.attempt_no })}
        actions={
          inProgress ? (
            <>
              {mins && (
                <span className={cn('flex items-center gap-1 rounded-lg px-3 py-2 font-mono text-sm tabular-nums', (left ?? 999) < 60 ? 'bg-danger-soft text-danger' : 'bg-surface-2')} role="timer" aria-live="off">
                  <Timer className="size-4" aria-hidden /> {mins}
                </span>
              )}
              <Button onClick={() => window.confirm(t('lms.confirmSubmit', 'Hand in now? You can’t change answers afterwards.')) && submit.mutate()} loading={submit.isPending}>
                {t('lms.handIn', 'Hand in')}
              </Button>
            </>
          ) : (
            a.score != null && (
              <Badge tone="success" className="text-base">
                {Number(a.score)} / {Number(a.max_score)}
              </Badge>
            )
          )
        }
      />
      {!inProgress && a.status === 'submitted' && !staff && <Alert className="mb-4">{t('lms.waitingMarking', 'Some answers are marked by your teacher; your score will follow.')}</Alert>}
      <ol className="space-y-4">
        {a.questions.map((x) => (
          <li key={x.question_id}>
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-fg-muted">
                <span>
                  {t('lms.questionN', 'Question {{n}}', { n: x.n })} · {x.points} pt
                </span>
                {inProgress && <span aria-live="polite">{saved[x.question_id] ? t('lms.saved', 'Saved') : ''}</span>}
                {x.earned != null && <Badge tone={x.earned >= x.points ? 'success' : x.earned > 0 ? 'warning' : 'danger'}>{x.earned} / {x.points}</Badge>}
              </div>
              <RichText html={x.prompt_html} className="mb-3" />
              <AnswerInput q={x} value={answers[x.question_id]} disabled={!inProgress} onChange={(v) => answer(x.question_id, v)} />
              {x.feedback && <p className="mt-2 rounded bg-surface-2 p-2 text-sm">{x.feedback}</p>}
              {staff && !inProgress && <MarkAnswer attemptId={a.id} q={x} />}
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}

function AnswerInput({ q, value, disabled, onChange }: { q: AttemptView['questions'][number]; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const { t } = useTranslation();
  const v = q.view as { options?: { id: string; text: string }[]; left?: string[]; right?: string[]; items?: string[]; blanks?: number };
  switch (q.type) {
    case 'mcq':
    case 'multi': {
      const multi = q.type === 'multi';
      const chosen = multi ? ((value as string[]) ?? []) : value;
      return (
        <fieldset className="space-y-1.5" disabled={disabled}>
          <legend className="sr-only">{t('lms.chooseAnswer', 'Choose')}</legend>
          {v.options?.map((o) => (
            <label key={o.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={`q${q.question_id}`}
                checked={multi ? (chosen as string[]).includes(o.id) : chosen === o.id}
                onChange={(e) => onChange(multi ? (e.target.checked ? [...(chosen as string[]), o.id] : (chosen as string[]).filter((c) => c !== o.id)) : o.id)}
              />
              {o.text}
            </label>
          ))}
        </fieldset>
      );
    }
    case 'true_false':
      return (
        <div className="flex gap-2">
          {[true, false].map((b) => (
            <Button key={String(b)} variant={value === b ? 'primary' : 'outline'} disabled={disabled} onClick={() => onChange(b)} aria-pressed={value === b}>
              {b ? t('lms.true', 'True') : t('lms.false', 'False')}
            </Button>
          ))}
        </div>
      );
    case 'numeric':
    case 'formula':
      return <Input type="number" step="any" inputMode="decimal" aria-label={t('lms.yourAnswer', 'Your answer')} disabled={disabled} value={(value as string | number | undefined) ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className="max-w-xs" />;
    case 'short':
      return <Input aria-label={t('lms.yourAnswer', 'Your answer')} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'essay':
      return <Textarea aria-label={t('lms.yourAnswer', 'Your answer')} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className="min-h-40" />;
    case 'matching': {
      const m = (value as Record<string, string>) ?? {};
      return (
        <div className="space-y-2">
          {v.left?.map((l, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-2">
              <span className="text-sm">{l}</span>
              <Select aria-label={l} disabled={disabled} value={m[String(i)] ?? ''} onChange={(e) => onChange({ ...m, [String(i)]: e.target.value })}>
                <option value="">—</option>
                {v.right?.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
          ))}
        </div>
      );
    }
    case 'ordering': {
      const order = (value as string[]) ?? v.items ?? [];
      const move = (i: number, d: number) => {
        const x = [...order];
        const j = i + d;
        if (j < 0 || j >= x.length) return;
        [x[i], x[j]] = [x[j]!, x[i]!];
        onChange(x);
      };
      return (
        <ol className="space-y-1.5">
          {order.map((it, i) => (
            <li key={it} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="flex-1">{it}</span>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => move(i, -1)} aria-label={t('common.moveUp', 'Move up')}>↑</Button>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => move(i, 1)} aria-label={t('common.moveDown', 'Move down')}>↓</Button>
            </li>
          ))}
        </ol>
      );
    }
    case 'fill_blank': {
      const vals = (value as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: v.blanks ?? 1 }, (_, i) => (
            <Input key={i} aria-label={t('lms.blankN', 'Blank {{n}}', { n: i + 1 })} className="w-40" disabled={disabled} value={vals[i] ?? ''} onChange={(e) => onChange(Object.assign([...vals], { [i]: e.target.value }))} />
          ))}
        </div>
      );
    }
    case 'file_upload':
    case 'audio':
      return <UploadAnswer value={value as { file_ids?: number[] } | null} disabled={disabled} onChange={onChange} audio={q.type === 'audio'} />;
    default:
      return null;
  }
}

function UploadAnswer({ value, disabled, onChange, audio }: { value: { file_ids?: number[] } | null; disabled: boolean; onChange: (v: unknown) => void; audio: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const up = useMutation({
    mutationFn: (f: File) => api.upload<{ id: number }>('POST', '/files?purpose=submission', f),
    onSuccess: (f) => onChange({ file_ids: [...(value?.file_ids ?? []), f.id] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="text-sm">
      <input type="file" disabled={disabled} accept={audio ? 'audio/*' : undefined} capture={audio ? 'user' : undefined} aria-label={audio ? t('lms.recordAudio', 'Record or choose audio') : t('lms.addFile', 'Add a file')} onChange={(e) => e.target.files?.[0] && up.mutate(e.target.files[0])} />
      {!!value?.file_ids?.length && <p className="mt-1 text-xs text-fg-muted">{t('lms.filesAttached', '{{n}} file(s) attached', { n: value.file_ids.length })}</p>}
    </div>
  );
}

function MarkAnswer({ attemptId, q }: { attemptId: number; q: AttemptView['questions'][number] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [pts, setPts] = useState(q.earned == null ? '' : String(q.earned));
  const [fb, setFb] = useState(q.feedback ?? '');
  const save = useMutation({
    mutationFn: () => api.put(`/attempts/${attemptId}/grades`, { answers: [{ question_id: q.question_id, points: Number(pts), feedback: fb }] }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attempt', attemptId] });
      toast('success', t('lms.marked', 'Marked'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <Field label={t('lms.pointsOutOf', 'Points (out of {{n}})', { n: q.points })} className="w-32">
        {(a) => <Input {...a} type="number" min={0} max={q.points} step="0.5" value={pts} onChange={(e) => setPts(e.target.value)} />}
      </Field>
      <Field label={t('lms.feedback', 'Feedback')} optional className="min-w-48 flex-1">
        {(a) => <Input {...a} value={fb} onChange={(e) => setFb(e.target.value)} />}
      </Field>
      <Button onClick={() => save.mutate()} loading={save.isPending} disabled={pts === ''}>
        {t('common.save', 'Save')}
      </Button>
    </div>
  );
}

export function ItemAnalysisPage() {
  const { t } = useTranslation();
  const workId = Number(useParams().workId);
  const q = useQuery({ queryKey: ['analysis', workId], queryFn: () => api.get<{ attempts: number; mean_percent: number; items: { question_id: number; type: string; prompt_html: string; answered: number; facility: number; discrimination: number | null; options?: { id: string; text: string; chosen: number }[] }[] }>(`/assessments/${workId}/item-analysis`) });
  const toast = useToast();
  const regrade = useMutation({
    mutationFn: (v: { question_id: number; mode: 'rescore' | 'full_credit' }) => api.post<{ regraded: number }>(`/assessments/${workId}/regrade`, v),
    onSuccess: (r) => toast('success', t('lms.regraded', 'Regraded {{n}} attempt(s)', { n: r.regraded })),
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  return (
    <>
      <PageHeader title={t('lms.itemAnalysis', 'Item analysis')} subtitle={t('lms.analysisSub', '{{n}} attempts · average {{p}}%', { n: q.data.attempts, p: q.data.mean_percent })} />
      <DataTable
        rows={q.data.items}
        rowKey={(r) => r.question_id}
        empty={t('lms.noAttemptsYet', 'No attempts yet')}
        columns={[
          { key: 'q', header: t('lms.question', 'Question'), cell: (r) => <RichText html={r.prompt_html} /> },
          { key: 'f', header: t('lms.facility', 'Got it right'), cell: (r) => <Badge tone={r.facility < 0.3 ? 'danger' : r.facility > 0.9 ? 'neutral' : 'success'}>{Math.round(r.facility * 100)}%</Badge> },
          { key: 'd', header: t('lms.discrimination', 'Separates strong/weak'), cell: (r) => (r.discrimination == null ? '—' : <Badge tone={r.discrimination < 0.1 ? 'warning' : 'success'}>{r.discrimination}</Badge>), hideOnMobile: true },
          { key: 'o', header: t('lms.choices', 'Choices'), cell: (r) => r.options?.map((o) => `${o.text}: ${o.chosen}`).join(' · ') ?? '—', hideOnMobile: true },
          {
            key: 'fix',
            header: '',
            cell: (r) => (
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="outline" onClick={() => regrade.mutate({ question_id: r.question_id, mode: 'rescore' })}>{t('lms.rescore', 'Rescore')}</Button>
                <Button size="sm" variant="outline" onClick={() => window.confirm(t('lms.fullCreditConfirm', 'Give everyone full marks for this question?')) && regrade.mutate({ question_id: r.question_id, mode: 'full_credit' })}>{t('lms.fullCredit', 'Full marks')}</Button>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

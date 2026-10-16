// Public admissions pages (no sign-in): the branded application form, the applicant's own
// page (the private link from their email: status, documents, fee, test, offer) and the
// online entrance test.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, FileUp } from 'lucide-react';
import { RichText } from '@/components/RichText';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, MutationError, Select, Spinner, Textarea } from '@/components/ui';

function Shell({ title, color, children }: { title: string; color?: string | null; children: ReactNode }) {
  return (
    <div className="min-h-full bg-bg">
      <header className="px-4 py-5 text-white" style={{ background: color || '#4f46e5' }}>
        <div className="mx-auto max-w-2xl text-lg font-bold">{title}</div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}

interface PublicForm {
  institution: string;
  primary_color: string | null;
  title: string;
  description: string;
  fields: { key: string; label: string; type: string; options?: string[]; required: boolean }[];
  documents: { key: string; label: string; required: boolean }[];
  application_fee: number;
  currency: string;
  entrance_test: { questions: number; minutes: number } | null;
  closes_at: string | null;
  open: boolean;
}

export function ApplyPage() {
  const { t } = useTranslation();
  const { institution, form } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['apply', institution, form], queryFn: () => api.get<PublicForm>(`/apply/${institution}/${form}`), retry: false });
  const [v, setV] = useState({ first_name: '', last_name: '', dob: '', gender: '', email: '', phone: '', guardian_name: '', guardian_phone: '', guardian_email: '', guardian_relationship: 'father', previous_school: '', website: '' });
  const [data, setData] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.post<{ number: string; token: string }>(`/apply/${institution}/${form}`, { ...v, gender: v.gender || null, dob: v.dob || null, data }),
    onSuccess: (r) => navigate(`/apply/status#${r.token}`, { state: { justApplied: r.number } }),
  });
  if (q.error) return <Shell title="Acadex"><ErrorState error={q.error} /></Shell>;
  if (!q.data) return <Spinner className="h-full" />;
  const f = q.data;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const text = (key: keyof typeof v, label: string, opts: { type?: string; optional?: boolean } = {}) => (
    <Field label={label} optional={opts.optional}>{(a) => <Input {...a} type={opts.type ?? 'text'} required={!opts.optional} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />}</Field>
  );
  return (
    <Shell title={f.institution} color={f.primary_color}>
      <h1 className="text-2xl font-bold">{f.title}</h1>
      {f.description && <p className="whitespace-pre-line text-fg-muted">{f.description}</p>}
      <div className="flex flex-wrap gap-2 text-sm">
        {f.application_fee > 0 && <Badge tone="info">{t('apply.fee', 'Application fee {{amount}}', { amount: formatMoney(f.application_fee, f.currency) })}</Badge>}
        {f.entrance_test && <Badge tone="info">{t('apply.test', 'Online test: {{n}} questions, {{m}} minutes', { n: f.entrance_test.questions, m: f.entrance_test.minutes })}</Badge>}
        {f.closes_at && <Badge>{t('apply.closes', 'Closes {{date}}', { date: formatDateTime(f.closes_at) })}</Badge>}
      </div>
      {!f.open ? (
        <Alert tone="warning">{t('apply.closed', 'Applications are not open at the moment.')}</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">{t('apply.applicant', 'Applicant')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {text('first_name', t('apply.firstName', 'First name'))}
              {text('last_name', t('apply.lastName', 'Last name'), { optional: true })}
              {text('dob', t('apply.dob', 'Date of birth'), { type: 'date', optional: true })}
              <Field label={t('apply.gender', 'Gender')} optional>{(a) => <Select {...a} value={v.gender} onChange={(e) => setV({ ...v, gender: e.target.value })}><option value="">—</option><option value="Female">{t('apply.female', 'Female')}</option><option value="Male">{t('apply.male', 'Male')}</option><option value="Other">{t('apply.other', 'Other')}</option></Select>}</Field>
              {text('email', t('apply.email', 'Email'), { type: 'email' })}
              {text('phone', t('apply.phone', 'Phone'), { type: 'tel', optional: true })}
              {text('previous_school', t('apply.previousSchool', 'Previous school'), { optional: true })}
            </div>
          </Card>
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">{t('apply.guardian', 'Parent or guardian')}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {text('guardian_name', t('apply.guardianName', 'Name'), { optional: true })}
              <Field label={t('apply.relationship', 'Relationship')}>{(a) => <Select {...a} value={v.guardian_relationship} onChange={(e) => setV({ ...v, guardian_relationship: e.target.value })}>{['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other'].map((r) => <option key={r} value={r}>{r}</option>)}</Select>}</Field>
              {text('guardian_phone', t('apply.phone', 'Phone'), { type: 'tel', optional: true })}
              {text('guardian_email', t('apply.email', 'Email'), { type: 'email', optional: true })}
            </div>
          </Card>
          {f.fields.length > 0 && (
            <Card className="space-y-4 p-5">
              <h2 className="font-semibold">{t('apply.more', 'A few more questions')}</h2>
              {f.fields.map((q2) => (
                <Field key={q2.key} label={q2.label} optional={!q2.required}>
                  {(a) =>
                    q2.type === 'select' ? (
                      <Select {...a} value={data[q2.key] ?? ''} onChange={(e) => setData({ ...data, [q2.key]: e.target.value })}><option value="">—</option>{q2.options?.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                    ) : q2.type === 'textarea' ? (
                      <Textarea {...a} value={data[q2.key] ?? ''} onChange={(e) => setData({ ...data, [q2.key]: e.target.value })} />
                    ) : (
                      <Input {...a} type={q2.type === 'number' ? 'number' : q2.type === 'date' ? 'date' : 'text'} value={data[q2.key] ?? ''} onChange={(e) => setData({ ...data, [q2.key]: e.target.value })} />
                    )
                  }
                </Field>
              ))}
            </Card>
          )}
          {/* a field people don't see; bots fill it in */}
          <div className="hidden" aria-hidden>
            <label>Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></label>
          </div>
          {f.documents.length > 0 && <Alert>{t('apply.docsLater', 'You will upload {{docs}} on the next page.', { docs: f.documents.map((d) => d.label).join(', ') })}</Alert>}
          <MutationError error={m.error} />
          <Button type="submit" loading={m.isPending} className="w-full sm:w-auto">{t('apply.submit', 'Submit application')}</Button>
        </form>
      )}
    </Shell>
  );
}

interface Status {
  number: string;
  name: string;
  institution: string;
  primary_color: string | null;
  form: string;
  status: string;
  documents: { key: string; label: string; required: boolean; uploaded: boolean }[];
  can_upload: boolean;
  fee: { number: string; balance: number; status: string; pay_token: string | null; currency: string } | null;
  test: { at: string | null; venue: string; online: boolean; available: boolean; in_progress: boolean; minutes: number | null; score: { score: number; max: number } | null };
  offer: { expires_at: string | null; expired: boolean } | null;
  decision_note: string;
}

const STATUS_TEXT: Record<string, string> = {
  submitted: 'Received — we will review it soon.',
  under_review: 'Being reviewed.',
  test_scheduled: 'Entrance test scheduled.',
  tested: 'Test marked — decisions are coming.',
  offered: 'You have been offered a place!',
  accepted: 'Offer accepted — the school will complete your enrolment.',
  declined: 'You declined the offer.',
  rejected: 'Not successful this time.',
  waitlisted: 'On the waiting list.',
  enrolled: 'Enrolled — welcome! Check your email to set up your account.',
  withdrawn: 'Withdrawn.',
};

/** /apply/status#<token> — the token stays in the fragment, so it never reaches server logs. */
export function ApplicationStatusPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const on = () => setToken(window.location.hash.slice(1));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const base = `/apply/status/${token}`;
  const q = useQuery({ queryKey: ['apply-status', token], queryFn: () => api.get<Status>(base), enabled: token.length >= 30, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['apply-status', token] });
  const upload = useMutation({ mutationFn: ({ key, file }: { key: string; file: File }) => api.upload('POST', `${base}/documents`, file, { key }), onSuccess: refresh });
  const decide = useMutation({ mutationFn: (d: 'accept' | 'decline') => api.post(`${base}/${d}`), onSuccess: refresh });
  const startTest = useMutation({ mutationFn: () => api.post(`${base}/test/start`), onSuccess: refresh });
  if (token.length < 30) return <Shell title="Acadex"><Alert tone="warning">{t('apply.noToken', 'Open this page from the link in your application email.')}</Alert></Shell>;
  if (q.error) return <Shell title="Acadex"><ErrorState error={q.error} /></Shell>;
  if (!q.data) return <Spinner className="h-full" />;
  const s = q.data;
  return (
    <Shell title={s.institution} color={s.primary_color}>
      <Card className="space-y-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">{s.name}</h1>
            <p className="text-sm text-fg-muted">{s.form} · {s.number}</p>
          </div>
          <Badge tone={['offered', 'accepted', 'enrolled'].includes(s.status) ? 'success' : s.status === 'rejected' ? 'danger' : 'info'}>{s.status.replace('_', ' ')}</Badge>
        </div>
        <p>{t(`apply.status.${s.status}`, STATUS_TEXT[s.status] ?? s.status)}</p>
        {s.decision_note && <p className="text-sm text-fg-muted">{s.decision_note}</p>}
        <p className="text-xs text-fg-muted">{t('apply.bookmark', 'Keep this page — it is your private link to the application.')}</p>
      </Card>
      {s.offer && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">{t('apply.offer', 'Your offer')}</h2>
          {s.offer.expired ? <Alert tone="warning">{t('apply.expired', 'This offer has expired. Please contact the admissions office.')}</Alert> : (
            <>
              {s.offer.expires_at && <p className="text-sm">{t('apply.replyBy', 'Please reply by {{date}}.', { date: formatDateTime(s.offer.expires_at) })}</p>}
              <div className="flex gap-2">
                <Button loading={decide.isPending && decide.variables === 'accept'} onClick={() => decide.mutate('accept')}>{t('apply.accept', 'Accept the offer')}</Button>
                <Button variant="outline" loading={decide.isPending && decide.variables === 'decline'} onClick={() => decide.mutate('decline')}>{t('apply.decline', 'Decline')}</Button>
              </div>
              <MutationError error={decide.error} />
            </>
          )}
        </Card>
      )}
      {s.fee && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="font-semibold">{t('apply.feeTitle', 'Application fee')}</h2>
            <p className="text-sm text-fg-muted">{s.fee.number}</p>
          </div>
          {s.fee.balance > 0 && s.fee.pay_token ? (
            <Link to={`/pay/${s.fee.pay_token}`}><Button>{t('apply.payFee', 'Pay {{amount}}', { amount: formatMoney(s.fee.balance, s.fee.currency) })}</Button></Link>
          ) : (
            <Badge tone="success"><CheckCircle2 className="me-1 inline size-3" /> {t('apply.paid', 'Paid')}</Badge>
          )}
        </Card>
      )}
      {s.documents.length > 0 && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">{t('apply.documents', 'Documents')}</h2>
          {s.documents.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{d.label} {d.required && <span className="text-danger">*</span>}</span>
              <div className="flex items-center gap-2">
                {d.uploaded && <Badge tone="success">{t('apply.uploaded', 'Uploaded')}</Badge>}
                {s.can_upload && (
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-border px-3 py-1.5 hover:bg-surface-2">
                    <FileUp className="size-4" /> {d.uploaded ? t('apply.replace', 'Replace') : t('apply.upload', 'Upload')}
                    <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && upload.mutate({ key: d.key, file: e.target.files[0] })} />
                  </label>
                )}
              </div>
            </div>
          ))}
          <MutationError error={upload.error} />
        </Card>
      )}
      {(s.test.online || s.test.at || s.test.score) && (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">{t('apply.entranceTest', 'Entrance test')}</h2>
          {s.test.score ? (
            <p>{t('apply.score', 'Your score: {{score}} of {{max}}', s.test.score)}</p>
          ) : s.test.in_progress ? (
            <Link to={`/apply/test#${token}`}><Button>{t('apply.continueTest', 'Continue the test')}</Button></Link>
          ) : s.test.available ? (
            <>
              <p className="text-sm">{t('apply.testReady', 'You have {{m}} minutes once you start. Answers are saved as you go.', { m: s.test.minutes })}</p>
              <Button loading={startTest.isPending} onClick={() => startTest.mutate(undefined, { onSuccess: () => window.location.assign(`/apply/test#${token}`) })}>{t('apply.startTest', 'Start the test')}</Button>
              <MutationError error={startTest.error} />
            </>
          ) : s.test.at ? (
            <p className="flex items-center gap-2 text-sm"><Clock className="size-4" /> {formatDateTime(s.test.at)} {s.test.venue && `· ${s.test.venue}`}</p>
          ) : (
            <p className="text-sm text-fg-muted">{t('apply.testLater', 'The school will schedule your test.')}</p>
          )}
        </Card>
      )}
    </Shell>
  );
}

interface TestQ { n: number; question_id: number; type: string; prompt_html: string; points: number; view: { options?: { id: string; text: string }[] }; response: unknown }

/** /apply/test#<token> — the online entrance test. */
export function EntranceTestPage() {
  const { t } = useTranslation();
  const token = window.location.hash.slice(1);
  const base = `/apply/status/${token}`;
  const q = useQuery({ queryKey: ['apply-test', token], queryFn: () => api.get<{ deadline: string; questions: TestQ[] }>(`${base}/test`), retry: false, refetchOnWindowFocus: false });
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const save = useMutation({ mutationFn: ({ question_id, response }: { question_id: number; response: unknown }) => api.put(`${base}/test/answers`, { question_id, response }) });
  const submit = useMutation({ mutationFn: () => api.post(`${base}/test/submit`), onSuccess: () => window.location.assign(`/apply/status#${token}`) });
  const left = q.data ? Math.max(0, Math.floor((new Date(q.data.deadline).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (q.data && left === 0 && !submit.isPending && !submit.isSuccess) submit.mutate();
  }, [left, q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.error) return <Shell title="Acadex"><ErrorState error={q.error} /><Link className="text-primary" to={`/apply/status#${token}`}>{t('apply.back', 'Back to my application')}</Link></Shell>;
  if (!q.data) return <Spinner className="h-full" />;
  const answer = (qq: TestQ, response: unknown) => {
    setAnswers({ ...answers, [qq.question_id]: response });
    save.mutate({ question_id: qq.question_id, response });
  };
  return (
    <Shell title={t('apply.entranceTest', 'Entrance test')}>
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2 shadow-sm">
        <span className={left < 60 ? 'font-bold text-danger' : 'font-medium'} aria-live="polite">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
        <Button size="sm" loading={submit.isPending} onClick={() => submit.mutate()}>{t('apply.finish', 'Hand in')}</Button>
      </div>
      {q.data.questions.map((qq) => {
        const value = answers[qq.question_id] ?? qq.response;
        return (
          <Card key={qq.question_id} className="space-y-3 p-5">
            <div className="text-sm text-fg-muted">{t('apply.question', 'Question {{n}}', { n: qq.n })} · {qq.points}</div>
            <RichText html={qq.prompt_html} />
            {qq.view.options ? (
              <div className="space-y-2">
                {qq.view.options.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 rounded border border-border px-3 py-2">
                    <input
                      type={qq.type === 'multi' ? 'checkbox' : 'radio'}
                      name={`q${qq.question_id}`}
                      checked={qq.type === 'multi' ? Array.isArray(value) && value.includes(o.id) : value === o.id}
                      onChange={(e) => answer(qq, qq.type === 'multi' ? (e.target.checked ? [...((value as string[]) ?? []), o.id] : ((value as string[]) ?? []).filter((x) => x !== o.id)) : o.id)}
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            ) : qq.type === 'true_false' ? (
              <div className="flex gap-3">{[true, false].map((b) => <label key={String(b)} className="flex items-center gap-2"><input type="radio" name={`q${qq.question_id}`} checked={value === b} onChange={() => answer(qq, b)} /> {b ? t('quiz.true', 'True') : t('quiz.false', 'False')}</label>)}</div>
            ) : (
              <Input aria-label={t('apply.yourAnswer', 'Your answer')} type={qq.type === 'numeric' ? 'number' : 'text'} defaultValue={value == null ? '' : String(value)} onBlur={(e) => answer(qq, qq.type === 'numeric' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />
            )}
          </Card>
        );
      })}
      <MutationError error={save.error ?? submit.error} />
    </Shell>
  );
}

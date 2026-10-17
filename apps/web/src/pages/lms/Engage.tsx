// Communication pages: announcements (read, and post to a scope), my calendar with its feed
// link, notifications with email / push preferences and quiet hours, surveys and course
// evaluations, and achievements (certificates, badges, points).
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Award, BellRing, CalendarDays, Copy, Megaphone, Star } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime, formatRelative, todayISO } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '@/components/ui';

// ---------------------------------------------------------------- announcements

interface Announcement {
  id: number;
  title: string;
  description: string;
  target_audience: string;
  created_at: string;
  author: string | null;
  campus_name: string | null;
  section_name: string | null;
  course_name: string | null;
}

export function AnnouncementsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<Announcement[]>('/announcements') });
  return (
    <>
      <PageHeader title={t('nav.announcements', 'Announcements')} />
      {can('announcements.manage') && <ComposeAnnouncement />}
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <Card><EmptyState title={t('ann.none', 'No announcements')} /></Card>
      ) : (
        <ul className="space-y-3">
          {q.data.map((a) => (
            <li key={a.id}>
              <Card className="p-4">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Megaphone className="size-4 text-primary" aria-hidden />
                  <h2 className="font-semibold">{a.title}</h2>
                  {[a.course_name, a.section_name, a.campus_name].filter(Boolean).map((s) => <Badge key={s}>{s}</Badge>)}
                </div>
                <p className="whitespace-pre-line text-sm">{a.description}</p>
                <p className="mt-1 text-xs text-fg-muted">{[a.author, formatRelative(a.created_at)].filter(Boolean).join(' · ')}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ComposeAnnouncement() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const sections = useQuery({ queryKey: ['ann-sections'], queryFn: () => api.all<{ id: number; name: string; label: string | null }>('/institution/sections') });
  const structure = useQuery({ queryKey: ['ann-structure'], queryFn: () => api.get<{ campuses: { id: number; name: string }[] }>('/institution/structure') });
  const [f, setF] = useState({ title: '', description: '', target_audience: 'All', scope: '' });
  const send = useMutation({
    mutationFn: () => {
      const [kind, id] = f.scope.split(':');
      return api.post('/announcements', { title: f.title, description: f.description, target_audience: f.target_audience, campus_id: kind === 'c' ? Number(id) : null, section_id: kind === 's' ? Number(id) : null });
    },
    onSuccess: () => {
      setF({ title: '', description: '', target_audience: 'All', scope: '' });
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      toast('success', t('ann.sent', 'Announced — people were notified'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Card className="mb-4 p-4">
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
        <Field label={t('common.title', 'Title')} className="sm:col-span-3">{(a) => <Input {...a} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label={t('ann.message', 'Message')} className="sm:col-span-3">{(a) => <Textarea {...a} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <Field label={t('ann.for', 'For')}>
          {(a) => (
            <Select {...a} value={f.target_audience} onChange={(e) => setF({ ...f, target_audience: e.target.value })}>
              {['All', 'Students', 'Teachers', 'Parents'].map((x) => <option key={x} value={x}>{t(`ann.audience.${x}`, x)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('ann.where', 'Where')}>
          {(a) => (
            <Select {...a} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="">{t('ann.everywhere', 'The whole institution')}</option>
              {structure.data?.campuses.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}
              {sections.data?.map((s) => <option key={s.id} value={`s:${s.id}`}>{[s.name, s.label].filter(Boolean).join(' ')}</option>)}
            </Select>
          )}
        </Field>
        <div className="flex items-end"><Button type="submit" loading={send.isPending}>{t('ann.send', 'Announce')}</Button></div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- calendar

export function CalendarPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const from = todayISO();
  const to = new Date(Date.now() + 42 * 86400000).toISOString().slice(0, 10);
  const q = useQuery({ queryKey: ['my-calendar', from], queryFn: () => api.get<{ kind: string; id: number; title: string; starts_at: string; ends_at: string | null; all_day: boolean; course: string | null; link: string }[]>('/calendar/me', { from, to }) });
  const [feed, setFeed] = useState<string | null>(null);
  const makeFeed = useMutation({ mutationFn: () => api.post<{ url: string }>('/calendar/feed', {}), onSuccess: (r) => setFeed(r.url), onError: (e) => toast('error', errorMessage(e)) });
  const byDay = new Map<string, NonNullable<typeof q.data>>();
  for (const e of q.data ?? []) {
    const d = e.all_day ? e.starts_at.slice(0, 10) : new Date(e.starts_at).toISOString().slice(0, 10);
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }
  return (
    <>
      <PageHeader title={t('cal.title', 'My calendar')} subtitle={t('cal.next6', 'The next six weeks')} actions={<Button variant="outline" onClick={() => makeFeed.mutate()} loading={makeFeed.isPending}><CalendarDays className="size-4" /> {t('cal.addToApp', 'Add to my calendar app')}</Button>} />
      {feed && (
        <Alert className="mb-4">
          <span className="flex flex-wrap items-center gap-2">
            {t('cal.feedHelp', 'Paste this private link into Google, Outlook or Apple Calendar (subscribe by URL). Making a new link cancels this one.')}
            <code className="break-all rounded bg-surface-2 px-2 py-0.5 text-xs" dir="ltr">{feed}</code>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(feed)}><Copy className="size-4" /> {t('common.copy', 'Copy')}</Button>
          </span>
        </Alert>
      )}
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !byDay.size ? (
        <Card><EmptyState title={t('cal.empty', 'Nothing coming up')} /></Card>
      ) : (
        <ol className="space-y-3">
          {[...byDay.entries()].map(([day, events]) => (
            <li key={day}>
              <h2 className="mb-1 text-sm font-semibold text-fg-muted">{formatDate(day)}</h2>
              <Card className="divide-y divide-border">
                {events.map((e) => (
                  <Link key={`${e.kind}${e.id}`} to={e.link} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                    <span>
                      <Badge tone={e.kind === 'due' ? 'warning' : e.kind === 'live' ? 'info' : 'neutral'}>{t(`cal.kind.${e.kind}`, e.kind)}</Badge> <span className="font-medium">{e.title}</span>
                      {e.course && <span className="text-fg-muted"> · {e.course}</span>}
                    </span>
                    {!e.all_day && <span className="text-xs text-fg-muted">{formatDateTime(e.starts_at)}</span>}
                  </Link>
                ))}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

// ---------------------------------------------------------------- notifications

type Chan = { email: boolean; push: boolean; sms?: boolean; whatsapp?: boolean };
interface Prefs {
  types: { key: string; label: string; urgent?: boolean; default: Chan }[];
  channels: Record<string, Chan>;
  quiet_hours: { start: string; end: string } | null;
  digest: 'off' | 'daily' | 'weekly';
  phone: { sms: boolean; whatsapp: boolean };
  push: { available: boolean; public_key: string | null };
}

const urlBase64ToUint8Array = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export function NotificationsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['notifications', 'all'], queryFn: () => api.get<{ items: { id: number; title: string; message: string; link: string; is_read: boolean; created_at: string }[]; unread: number }>('/notifications', { pageSize: 50 }) });
  const prefs = useQuery({ queryKey: ['notif-prefs'], queryFn: () => api.get<Prefs>('/notifications/preferences') });
  const [quiet, setQuiet] = useState<{ start: string; end: string } | null | undefined>(undefined);
  const [chan, setChan] = useState<Prefs['channels'] | null>(null);
  const [digestChoice, setDigest] = useState<Prefs['digest'] | null>(null);
  const digest = digestChoice ?? prefs.data?.digest ?? 'off';
  const channels = chan ?? prefs.data?.channels ?? {};
  const q = quiet === undefined ? (prefs.data?.quiet_hours ?? null) : quiet;
  const save = useMutation({
    mutationFn: () => api.put('/notifications/preferences', { channels, quiet_hours: q, digest }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notif-prefs'] });
      toast('success', t('common.saved', 'Saved'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const read = useMutation({ mutationFn: (id: number) => api.post(`/notifications/${id}/read`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const enablePush = async () => {
    try {
      const key = prefs.data?.push.public_key;
      if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error(t('notif.noPush', 'This browser cannot receive notifications'));
      if ((await Notification.requestPermission()) !== 'granted') throw new Error(t('notif.denied', 'Notifications are blocked for this site'));
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.post('/notifications/push-subscriptions', { endpoint: j.endpoint, keys: j.keys });
      toast('success', t('notif.pushOn', 'Notifications are on for this device'));
    } catch (e) {
      toast('error', e instanceof Error ? e.message : errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title={t('nav.notifications', 'Notifications')} />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="divide-y divide-border lg:col-span-3">
          {list.isPending ? (
            <Spinner />
          ) : !list.data?.items.length ? (
            <EmptyState title={t('nav.noNotifications', 'No notifications')} />
          ) : (
            list.data.items.map((n) => (
              <Link key={n.id} to={n.link || '#'} onClick={() => !n.is_read && read.mutate(n.id)} className={`block px-4 py-3 hover:bg-surface-2 ${n.is_read ? '' : 'bg-primary-soft/40'}`}>
                <div className="text-sm font-medium">{n.title}</div>
                {n.message && <div className="text-xs text-fg-muted">{n.message}</div>}
                <div className="text-[11px] text-fg-muted">{formatRelative(n.created_at)}</div>
              </Link>
            ))
          )}
        </Card>
        <Card className="space-y-4 p-4 lg:col-span-2">
          <h2 className="font-semibold">{t('notif.prefs', 'How you hear about things')}</h2>
          {prefs.data && (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-fg-muted">
                    <th className="text-start font-medium" />
                    <th className="w-16 font-medium">{t('notif.email', 'Email')}</th>
                    <th className="w-16 font-medium">{t('notif.push', 'Push')}</th>
                    {prefs.data.phone.sms && <th className="w-16 font-medium">SMS</th>}
                    {prefs.data.phone.whatsapp && <th className="w-16 font-medium">WhatsApp</th>}
                  </tr>
                </thead>
                <tbody>
                  {prefs.data.types.map((ty) => {
                    const c = { ...ty.default, ...channels[ty.key] };
                    const set = (k: keyof Chan, v: boolean) => setChan({ ...channels, [ty.key]: { ...c, [k]: v } });
                    const box = (k: keyof Chan, label: string) => (
                      <td className="text-center">
                        <input type="checkbox" className="size-5" aria-label={`${ty.label}: ${label}`} disabled={ty.urgent} checked={ty.urgent ? true : !!c[k]} onChange={(e) => set(k, e.target.checked)} />
                      </td>
                    );
                    return (
                      <tr key={ty.key}>
                        <td className="py-1">{t(`notif.types.${ty.key}`, ty.label)}{ty.urgent && <span className="block text-[11px] text-fg-muted">{t('notif.alwaysOn', 'Always on every channel')}</span>}</td>
                        {box('email', t('notif.email', 'Email'))}
                        {box('push', t('notif.push', 'Push'))}
                        {prefs.data!.phone.sms && box('sms', 'SMS')}
                        {prefs.data!.phone.whatsapp && box('whatsapp', 'WhatsApp')}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Field label={t('notif.digest', 'Email digest')} hint={t('notif.digestHint', 'One email at 18:00 instead of one per notification (weekly: on Mondays). Emergencies still arrive at once.')}>
                {(a) => (
                  <Select {...a} value={digest} onChange={(e) => setDigest(e.target.value as Prefs['digest'])}>
                    <option value="off">{t('notif.digestOff', 'Off — email each one')}</option>
                    <option value="daily">{t('notif.digestDaily', 'Daily')}</option>
                    <option value="weekly">{t('notif.digestWeekly', 'Weekly')}</option>
                  </Select>
                )}
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!q} onChange={(e) => setQuiet(e.target.checked ? { start: '21:00', end: '07:00' } : null)} /> {t('notif.quiet', 'Quiet hours (no email, push or text messages)')}
              </label>
              {q && (
                <div className="flex gap-2">
                  <Input type="time" aria-label={t('notif.from', 'From')} value={q.start} onChange={(e) => setQuiet({ ...q, start: e.target.value })} />
                  <Input type="time" aria-label={t('notif.until', 'Until')} value={q.end} onChange={(e) => setQuiet({ ...q, end: e.target.value })} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save.mutate()} loading={save.isPending}>{t('common.save', 'Save')}</Button>
                {prefs.data.push.available && <Button variant="outline" onClick={enablePush}><BellRing className="size-4" /> {t('notif.enablePush', 'Notify me on this device')}</Button>}
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- surveys

interface SurveyRow {
  id: number;
  title: string;
  description: string;
  anonymous: boolean;
  status: string;
  course: string | null;
  answered: boolean;
  responses: number;
}
interface Survey {
  id: number;
  title: string;
  description: string;
  anonymous: boolean;
  status: string;
  questions: { id: string; kind: 'rating' | 'choice' | 'text'; label: string; options?: string[]; required: boolean }[];
}

export function SurveysPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['surveys'], queryFn: () => api.get<SurveyRow[]>('/surveys') });
  return (
    <>
      <PageHeader title={t('sv.title', 'Surveys')} actions={can('surveys.manage') ? <Link to="new"><Button>{t('sv.new', 'New survey')}</Button></Link> : undefined} />
      {q.isPending ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Card><EmptyState title={t('sv.none', 'No surveys for you right now')} /></Card>
      ) : (
        <Card className="divide-y divide-border">
          {q.data.map((s) => (
            <Link key={s.id} to={String(s.id)} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2">
              <span>
                <span className="font-medium">{s.title}</span>
                <span className="block text-xs text-fg-muted">{[s.course, s.anonymous ? t('sv.anon', 'anonymous') : null].filter(Boolean).join(' · ')}</span>
              </span>
              {s.answered ? <Badge tone="success">{t('sv.answered', 'Answered')}</Badge> : s.status === 'open' ? <Badge tone="info">{t('sv.open', 'Open')}</Badge> : <Badge>{s.status}</Badge>}
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}

export function SurveyPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const id = Number(useParams().surveyId);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['survey', id], queryFn: () => api.get<Survey>(`/surveys/${id}`) });
  const results = useQuery({ queryKey: ['survey-results', id], queryFn: () => api.get<{ responses: number; questions: (Survey['questions'][number] & { hidden?: boolean; average?: number | null; counts?: { label: string; count: number }[]; answers?: string[] })[] }>(`/surveys/${id}/results`), enabled: can('surveys.manage'), retry: false });
  const [answers, setAnswers] = useState<Record<string, string | number | null>>({});
  const send = useMutation({
    mutationFn: () => api.post(`/surveys/${id}/responses`, { answers }),
    onSuccess: () => {
      toast('success', t('sv.thanks', 'Thank you — your answers were saved'));
      void qc.invalidateQueries({ queryKey: ['surveys'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  const s = q.data;
  return (
    <>
      <PageHeader title={s.title} subtitle={s.description} />
      {s.anonymous && <Alert className="mb-4">{t('sv.anonHelp', 'Anonymous: your name is not stored with your answers.')}</Alert>}
      {results.data ? (
        <Card className="space-y-4 p-4">
          <p className="text-sm text-fg-muted">{t('sv.responses', '{{n}} responses', { n: results.data.responses })}</p>
          {results.data.questions.map((x) => (
            <div key={x.id}>
              <div className="font-medium">{x.label}</div>
              {x.hidden ? <p className="text-sm text-fg-muted">{t('sv.tooFew', 'Shown once 3 or more people have answered (to keep it anonymous)')}</p> : x.kind === 'rating' ? <p className="text-sm">{t('sv.avg', 'Average {{n}} / 5', { n: x.average ?? '—' })}</p> : x.kind === 'choice' ? <ul className="text-sm">{x.counts?.map((c) => <li key={c.label}>{c.label}: {c.count}</li>)}</ul> : <ul className="list-disc ps-5 text-sm">{x.answers?.map((a, i) => <li key={i}>{a}</li>)}</ul>}
            </div>
          ))}
        </Card>
      ) : (
        <Card className="space-y-4 p-4">
          {s.questions.map((x) => (
            <fieldset key={x.id}>
              <legend className="mb-1.5 text-sm font-medium">{x.label}{x.required && ' *'}</legend>
              {x.kind === 'rating' ? (
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-label={`${n}`} aria-pressed={answers[x.id] === n} onClick={() => setAnswers((a) => ({ ...a, [x.id]: n }))} className={`rounded p-1 ${Number(answers[x.id] ?? 0) >= n ? 'text-warning' : 'text-fg-muted'}`}>
                      <Star className="size-6" fill={Number(answers[x.id] ?? 0) >= n ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
              ) : x.kind === 'choice' ? (
                <Select aria-label={x.label} value={answers[x.id] == null ? '' : String(answers[x.id])} onChange={(e) => setAnswers((a) => ({ ...a, [x.id]: e.target.value === '' ? null : Number(e.target.value) }))}>
                  <option value="">—</option>
                  {x.options?.map((o, i) => <option key={o} value={i}>{o}</option>)}
                </Select>
              ) : (
                <Textarea aria-label={x.label} value={String(answers[x.id] ?? '')} onChange={(e) => setAnswers((a) => ({ ...a, [x.id]: e.target.value }))} />
              )}
            </fieldset>
          ))}
          <Button onClick={() => send.mutate()} loading={send.isPending}>{t('sv.send', 'Send answers')}</Button>
        </Card>
      )}
    </>
  );
}

export function NewSurveyPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState('students');
  const [qs, setQs] = useState('Overall, how was it? (rating)\nWhat should change? (text)');
  const save = useMutation({
    mutationFn: () =>
      api.post('/surveys', {
        title,
        audience,
        status: 'open',
        anonymous: true,
        questions: qs.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
          const kind = /\(rating\)/i.test(l) ? 'rating' : 'text';
          return { id: `q${i + 1}`, kind, label: l.replace(/\((rating|text)\)/i, '').trim(), required: kind === 'rating' };
        }),
      }),
    onSuccess: () => toast('success', t('sv.created', 'Survey opened')),
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <>
      <PageHeader title={t('sv.new', 'New survey')} />
      <Card className="max-w-xl space-y-3 p-4">
        <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label={t('sv.audience', 'Who answers')}>
          {(a) => (
            <Select {...a} value={audience} onChange={(e) => setAudience(e.target.value)}>
              {['students', 'staff', 'guardians', 'everyone'].map((x) => <option key={x} value={x}>{t(`sv.aud.${x}`, x)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('sv.questions', 'Questions, one per line — add (rating) for 1–5 stars')}>{(a) => <Textarea {...a} className="min-h-32" value={qs} onChange={(e) => setQs(e.target.value)} />}</Field>
        <Button onClick={() => save.mutate()} disabled={!title.trim()} loading={save.isPending}>{t('sv.open', 'Open')}</Button>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- achievements

export function AchievementsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['achievements'], queryFn: () => api.get<{ certificates: { id: number; title: string; verify_code: string; issued_at: string; course: string | null; revoked_at: string | null }[]; badges: { id: number; name: string; description: string; awarded_at: string }[]; points: number }>('/me/achievements') });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data;
  return (
    <>
      <PageHeader title={t('ach.title', 'Achievements')} subtitle={d.points ? t('ach.points', '{{n}} points', { n: d.points }) : undefined} />
      <h2 className="mb-2 font-semibold">{t('ach.certificates', 'Certificates')}</h2>
      {d.certificates.length ? (
        <ul className="mb-6 grid gap-3 sm:grid-cols-2">
          {d.certificates.map((c) => (
            <li key={c.id}>
              <Card className="p-4">
                <Award className="mb-2 size-6 text-primary" aria-hidden />
                <div className="font-semibold">{c.title}</div>
                <div className="text-xs text-fg-muted">{formatDate(c.issued_at)}</div>
                <Link to={`/verify/${c.verify_code}`} className="mt-2 inline-block text-xs text-primary underline">{t('ach.verify', 'Verification link')}</Link>
                {c.revoked_at && <Badge tone="danger" className="ms-2">{t('ach.revoked', 'Revoked')}</Badge>}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="mb-6"><EmptyState title={t('ach.noCerts', 'Finish a course to earn its certificate')} /></Card>
      )}
      {d.badges.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">{t('ach.badges', 'Badges')}</h2>
          <ul className="flex flex-wrap gap-3">
            {d.badges.map((b) => (
              <li key={b.id}><Card className="p-3 text-center text-sm"><Star className="mx-auto mb-1 size-6 text-warning" aria-hidden /><div className="font-medium">{b.name}</div></Card></li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

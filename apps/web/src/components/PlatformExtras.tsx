// Small pieces of the platform shown inside the app: the feedback widget, platform
// announcements for administrators, the support-session banner, the guided tour per role, the
// course's LTI tools and the Google / Microsoft sign-in buttons.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ExternalLink, MessageSquareHeart, ShieldAlert, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Dialog, Field, MutationError, Textarea } from '@/components/ui';

export function FeedbackWidget() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ rating: 0, message: '' });
  const m = useMutation({ mutationFn: () => api.post('/feedback', { page: window.location.pathname, rating: v.rating || null, message: v.message }), onSuccess: () => setV({ rating: 0, message: '' }) });
  return (
    <>
      <button type="button" onClick={() => { m.reset(); setOpen(true); }} className="fixed bottom-4 end-4 z-30 flex size-11 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg hover:bg-primary-hover print:hidden" aria-label={t('fb.open', 'Send feedback')}>
        <MessageSquareHeart className="size-5" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('fb.title', 'How is Acadex working for you?')}>
        {m.isSuccess ? <Alert tone="success">{t('fb.thanks', 'Thank you — the Acadex team reads every message.')}</Alert> : (
          <div className="space-y-3">
            <div className="flex gap-1" role="radiogroup" aria-label={t('fb.rating', 'Rating')}>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={v.rating === n} aria-label={`${n} / 5`} className={`size-10 rounded-full border text-lg ${v.rating >= n ? 'border-warning bg-warning/20' : 'border-border'}`} onClick={() => setV({ ...v, rating: n })}>★</button>)}
            </div>
            <Field label={t('fb.message', 'What should we know?')}>{(a) => <Textarea {...a} rows={4} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} />}</Field>
            <MutationError error={m.error} />
            <Button disabled={!v.message.trim()} loading={m.isPending} onClick={() => m.mutate()}>{t('fb.send', 'Send to Acadex')}</Button>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Notices from the platform (maintenance, new features) for the institution's administrators. */
export function PlatformBanner() {
  const { can } = useAuth();
  const enabled = can('settings.manage') || can('billing.manage');
  const q = useQuery({ queryKey: ['platform-announcements'], queryFn: () => api.get<{ id: number; title: string; body: string; level: string }[]>('/platform-announcements'), enabled, staleTime: 10 * 60_000 });
  const [hidden, setHidden] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('acadex.hiddenNotices') ?? '[]') as number[];
    } catch {
      return [];
    }
  });
  const shown = (q.data ?? []).filter((a) => !hidden.includes(a.id));
  if (!shown.length) return null;
  return (
    <div className="space-y-1 px-3 pt-2 sm:px-6">
      {shown.map((a) => (
        <Alert key={a.id} tone={a.level === 'critical' ? 'danger' : a.level === 'warning' ? 'warning' : 'info'}>
          <div className="flex items-start gap-2">
            <span className="flex-1"><b>{a.title}</b>{a.body && ` — ${a.body}`}</span>
            <button type="button" aria-label="×" onClick={() => { const next = [...hidden, a.id]; setHidden(next); try { localStorage.setItem('acadex.hiddenNotices', JSON.stringify(next)); } catch { /* ignore */ } }}><X className="size-4" /></button>
          </div>
        </Alert>
      ))}
    </div>
  );
}

/** Shown while the platform's support team is signed in as this account. */
export function SupportSessionBanner() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  if (!user?.impersonated_by) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-2 bg-danger px-3 py-1.5 text-sm text-white">
      <ShieldAlert className="size-4" aria-hidden /> {t('support.banner', 'Acadex support ({{who}}) is signed in as {{name}}. Everything is recorded.', { who: user.impersonated_by, name: user.full_name })}
      <button type="button" className="underline" onClick={() => void logout()}>{t('support.end', 'End session')}</button>
    </div>
  );
}

const TOURS: Record<string, { selector: string; text: string }[]> = {
  institution_admin: [
    { selector: 'a[href="/admin/students"]', text: 'Add or import your students here — a spreadsheet works.' },
    { selector: 'a[href="/admin/sections"]', text: 'Sections are your classes; give each its teachers and courses.' },
    { selector: 'a[href="/finance"]', text: 'Fees: set a structure once and Acadex issues vouchers and reminders.' },
    { selector: 'a[href="/communication"]', text: 'Messaging rules, emergency broadcasts and live-class accounts.' },
    { selector: 'a[href="/help"]', text: 'Short guides — or ask the help assistant anything.' },
  ],
  teacher: [
    { selector: 'a[href="/teach"]', text: 'Your courses: build modules, post work and grade here.' },
    { selector: 'a[href="/attendance"]', text: 'Take attendance in seconds — it even works offline.' },
    { selector: 'a[href="/messages"]', text: 'Message your students\' families; guardians of under-18s are copied in.' },
  ],
  student: [
    { selector: 'a[href="/learn"]', text: 'Your subjects, work due and grades.' },
    { selector: 'a[href="/messages"]', text: 'Questions for your teachers.' },
    { selector: 'a[href="/saved"]', text: 'Lessons you saved to read without internet.' },
  ],
  parent: [
    { selector: 'a[href="/parent"]', text: 'Each child\'s attendance, grades and alerts.' },
    { selector: 'a[href="/fees"]', text: 'Vouchers and online payment.' },
    { selector: 'a[href="/meetings"]', text: 'Book parent–teacher meetings.' },
  ],
};

/** A short guided tour of the menu, once per role (it can be reopened from Help). */
export function ProductTour() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const steps = useMemo(() => (user && TOURS[user.role]) || [], [user]);
  const done = useQuery({ queryKey: ['/me/tours'], queryFn: () => api.get<{ done: string[] }>('/me/tours'), enabled: !!steps.length && !!user?.institution_id, staleTime: Infinity });
  const finish = useMutation({ mutationFn: () => api.put('/me/tours', { done: [...(done.data?.done ?? []), user!.role] }) });
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const active = !!steps.length && done.data && !done.data.done.includes(user!.role) && !finish.isSuccess && window.innerWidth >= 1024 && !navigator.webdriver; // not in automated browsers (tests)
  useEffect(() => {
    if (!active) return;
    const el = document.querySelector(steps[i]!.selector);
    setBox(el ? el.getBoundingClientRect() : null);
  }, [active, i, steps]);
  if (!active) return null;
  const close = () => finish.mutate();
  const step = steps[i]!;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('tour.title', 'A quick tour')}>
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      {box && <div className="pointer-events-none absolute rounded-lg ring-4 ring-primary" style={{ top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8 }} />}
      <div className="absolute w-72 rounded-lg bg-surface p-4 shadow-xl" style={{ top: Math.min((box?.top ?? 80), window.innerHeight - 180), left: (box?.right ?? 260) + 16 }}>
        <p className="text-sm">{t(`tour.${user!.role}.${i}`, step.text)}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-fg-muted">{i + 1} / {steps.length}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={close}>{t('tour.skip', 'Skip')}</Button>
            {i < steps.length - 1 ? <Button size="sm" onClick={() => setI(i + 1)}>{t('tour.next', 'Next')}</Button> : <Button size="sm" onClick={close}>{t('tour.done', 'Got it')}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** External tools (LTI 1.3) a course member can open. */
export function CourseTools({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['lti-tools', courseId], queryFn: () => api.get<{ id: number; name: string }[]>(`/courses/${courseId}/lti-tools`) });
  const launch = useMutation({ mutationFn: (toolId: number) => api.post<{ url: string }>(`/courses/${courseId}/lti-tools/${toolId}/launch`), onSuccess: (r) => window.open(r.url, '_blank', 'noopener') });
  if (!q.data?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-fg-muted">{t('lti.tools', 'Tools')}:</span>
      {q.data.map((tl) => <Button key={tl.id} size="sm" variant="outline" loading={launch.isPending && launch.variables === tl.id} onClick={() => launch.mutate(tl.id)}><ExternalLink className="size-3.5" /> {tl.name}</Button>)}
      <MutationError error={launch.error} />
    </div>
  );
}

/** "Sign in with Google / Microsoft" when the platform has them configured. */
export function SsoButtons() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['sso-providers'], queryFn: () => api.get<string[]>('/auth/sso/providers'), staleTime: Infinity });
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
  if (!q.data?.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-fg-muted"><span className="h-px flex-1 bg-border" />{t('sso.or', 'or')}<span className="h-px flex-1 bg-border" /></div>
      {q.data.map((p) => (
        <a key={p} href={`${base}/auth/sso/${p}/start`} className="flex h-10 w-full items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium hover:bg-surface-2">
          {p === 'google' ? t('sso.google', 'Sign in with Google') : t('sso.microsoft', 'Sign in with Microsoft')}
        </a>
      ))}
    </div>
  );
}

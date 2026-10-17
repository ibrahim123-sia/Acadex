// Smaller screens that close gaps of the brief: room and resource bookings, What's new (the
// in-app changelog), the contextual help link in the header, and the sample-data switch.
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CircleHelp, Sparkles, Trash2 } from 'lucide-react';
import { CHANGELOG, LATEST_VERSION } from '@acadex/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { Button, Card, DataTable, Field, Input, MutationError, PageHeader, Select, useToast } from '@/components/ui';

// ---------------------------------------------------------------- room bookings

interface Booking { id: number; room_id: number; room: string; kind: string; title: string; purpose: string; starts_at: string; ends_at: string; booked_by: string | null; mine: boolean }

export function BookingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: today, to: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10) });
  const rooms = useQuery({ queryKey: ['/timetable/rooms'], queryFn: () => api.get<{ id: number; name: string; kind: string; capacity: number | null }[]>('/timetable/rooms') });
  const list = useQuery({ queryKey: ['/room-bookings', range], queryFn: () => api.get<Booking[]>('/room-bookings', range) });
  const [v, setV] = useState({ room_id: '', title: '', purpose: '', date: today, from: '10:00', to: '11:00' });
  const add = useMutation({
    mutationFn: () => api.post('/room-bookings', { room_id: Number(v.room_id), title: v.title, purpose: v.purpose, starts_at: new Date(`${v.date}T${v.from}`).toISOString(), ends_at: new Date(`${v.date}T${v.to}`).toISOString() }),
    onSuccess: () => { toast('success', t('book.done', 'Booked')); setV({ ...v, title: '', purpose: '' }); void list.refetch(); },
  });
  const cancel = useMutation({ mutationFn: (id: number) => api.delete(`/room-bookings/${id}`), onSuccess: () => list.refetch() });
  return (
    <>
      <PageHeader title={t('nav.bookings', 'Room bookings')} subtitle={t('book.subtitle', 'Halls, labs, grounds and rooms outside the timetable')} />
      <Card className="mb-4 grid gap-2 p-4 sm:grid-cols-6 sm:items-end">
        <Field label={t('book.room', 'Room')}>{(a) => <Select {...a} value={v.room_id} onChange={(e) => setV({ ...v, room_id: e.target.value })}><option value="">—</option>{rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.kind})</option>)}</Select>}</Field>
        <Field label={t('book.what', 'For')} className="sm:col-span-2">{(a) => <Input {...a} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={t('book.whatHint', 'Science fair rehearsal')} />}</Field>
        <Field label={t('common.date', 'Date')}>{(a) => <Input {...a} type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-1">
          <Field label={t('book.from', 'From')}>{(a) => <Input {...a} type="time" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />}</Field>
          <Field label={t('book.to', 'To')}>{(a) => <Input {...a} type="time" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} />}</Field>
        </div>
        <Button disabled={!v.room_id || !v.title} loading={add.isPending} onClick={() => add.mutate()}>{t('book.book', 'Book')}</Button>
        <div className="sm:col-span-6"><MutationError error={add.error} /></div>
      </Card>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="date" aria-label={t('book.from', 'From')} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="w-44" />
        <Input type="date" aria-label={t('book.to', 'To')} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="w-44" />
      </div>
      <DataTable rows={list.data} loading={list.isPending} error={list.error} rowKey={(r) => r.id} empty={t('book.none', 'No bookings')} columns={[
        { key: 'w', header: t('common.when', 'When'), cell: (r) => `${formatDateTime(r.starts_at)} – ${formatDateTime(r.ends_at).slice(-5)}` },
        { key: 'r', header: t('book.room', 'Room'), cell: (r) => r.room },
        { key: 't', header: t('book.what', 'For'), cell: (r) => r.title },
        { key: 'b', header: t('book.by', 'Booked by'), cell: (r) => r.booked_by ?? '—', hideOnMobile: true },
        { key: 'a', header: '', cell: (r) => r.mine && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>{t('ptm.cancel', 'Cancel')}</Button> },
      ]} />
    </>
  );
}

// ---------------------------------------------------------------- what's new

const SEEN = 'acadex.seenVersion';
export const hasNews = () => {
  try {
    return localStorage.getItem(SEEN) !== LATEST_VERSION;
  } catch {
    return false;
  }
};

export function WhatsNewPage() {
  const { t } = useTranslation();
  try {
    localStorage.setItem(SEEN, LATEST_VERSION);
  } catch {
    /* private mode */
  }
  return (
    <>
      <PageHeader title={t('nav.whatsNew', "What's new")} />
      <div className="space-y-4">
        {CHANGELOG.map((c) => (
          <Card key={c.version} className="space-y-2 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold"><Sparkles className="me-1 inline size-4 text-primary" aria-hidden />{c.title}</h2><span className="text-sm text-fg-muted">{t('news.version', 'Version {{v}}', { v: c.version })} · {formatDate(c.date)}</span></div>
            <ul className="list-disc space-y-1 ps-5 text-sm">{c.items.map((x) => <li key={x}>{x}</li>)}</ul>
          </Card>
        ))}
      </div>
    </>
  );
}

/** Header link to What's new, with a dot until the latest version has been opened. */
export function WhatsNewLink() {
  const { t } = useTranslation();
  const fresh = hasNews();
  return (
    <Link to="/whats-new" className="relative rounded-lg p-2 text-fg-muted hover:bg-surface-2" aria-label={t('nav.whatsNew', "What's new")} title={t('nav.whatsNew', "What's new")}>
      <Sparkles className="size-5" aria-hidden />
      {fresh && <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-primary" aria-hidden />}
    </Link>
  );
}

// ---------------------------------------------------------------- contextual help

const HELP_FOR: [RegExp, string][] = [
  [/^\/admin\/(students|imports)/, 'add-students'],
  [/^\/attendance/, 'take-attendance'],
  [/^\/teach\/courses\/\d+\/work/, 'grade-work'],
  [/^\/teach/, 'post-assignment'],
  [/^\/exams\/office|^\/exams\/marks/, 'exams-results'],
  [/^\/finance|^\/fees/, 'collect-fees'],
  [/^\/outcomes/, 'outcomes'],
  [/^\/admissions/, 'admissions'],
  [/^\/learn\/courses\/\d+/, 'tutor'],
  [/^\/parent/, 'parent-portal'],
  [/^\/ai\/settings/, 'ai-settings'],
  [/^\/success/, 'early-warning'],
  [/^\/ask/, 'ask-acadex'],
];

/** "?" in the header: the help guide for the page you are on. */
export function HelpLink() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const slug = HELP_FOR.find(([re]) => re.test(pathname))?.[1];
  return (
    <Link to={slug ? `/help/${slug}` : '/help'} className="rounded-lg p-2 text-fg-muted hover:bg-surface-2" aria-label={t('help.forPage', 'Help for this page')} title={t('help.forPage', 'Help for this page')}>
      <CircleHelp className="size-5" aria-hidden />
    </Link>
  );
}

// ---------------------------------------------------------------- sample data

export function SampleDataCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const m = useMutation({ mutationFn: (action: 'load' | 'remove') => api.post<{ students: number }>('/institution/sample-data', { action }), onSuccess: (r, action) => toast('success', action === 'load' ? t('sample.loaded', 'Sample class added ({{n}} students)', { n: r.students }) : t('sample.removed', 'Sample data removed')) });
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">{t('sample.title', 'Try it with sample data')}</h2>
      <p className="text-sm text-fg-muted">{t('sample.help', 'Adds a sample class with ten students, a teacher and two courses so you can explore Acadex. Remove it in one click when you are ready.')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" loading={m.isPending && m.variables === 'load'} onClick={() => m.mutate('load')}>{t('sample.load', 'Add sample data')}</Button>
        <Button variant="ghost" loading={m.isPending && m.variables === 'remove'} onClick={() => m.mutate('remove')}><Trash2 className="size-4" /> {t('sample.remove', 'Remove sample data')}</Button>
      </div>
      <MutationError error={m.error} />
    </Card>
  );
}

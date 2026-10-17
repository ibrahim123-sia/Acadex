// The help desk (tickets: raise, follow, handle) and parent–teacher meetings (plan, book, run).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Plus, Star, Video } from 'lucide-react';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '@acadex/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, StatCard, StatusBadge, Textarea, useToast } from '@/components/ui';

// ---------------------------------------------------------------- tickets

interface TicketRow {
  id: number;
  category: string;
  subject: string;
  status: string;
  priority: string;
  anonymous: boolean;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  raised_by_name: string | null;
  assigned_to_name: string | null;
  assigned_to: number | null;
  student: string | null;
  overdue: boolean;
  comments: number;
  satisfaction: number | null;
}
const PRIORITY_TONE = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' } as const;

export function TicketsPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { can } = useAuth();
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const list = usePagedList<TicketRow>('/tickets', { status: status || undefined }, 30);
  const summary = useQuery({ queryKey: ['tickets-summary'], queryFn: () => api.get<{ open: number; overdue: number; unassigned: number; avg_hours: number | null; satisfaction: number | null }>('/tickets-summary'), enabled: can('tickets.manage') });
  if (id) return <TicketView id={Number(id)} />;
  return (
    <>
      <PageHeader
        title={t('nav.tickets', 'Help desk')}
        subtitle={t('tk.subtitle', 'Complaints, feedback and requests — with who is handling them and by when')}
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> {t('tk.new', 'New ticket')}</Button>}
      />
      {summary.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t('tk.open', 'Open')} value={summary.data.open} />
          <StatCard label={t('tk.overdue', 'Overdue')} value={summary.data.overdue} tone="danger" />
          <StatCard label={t('tk.unassigned', 'Unassigned')} value={summary.data.unassigned} tone="warning" />
          <StatCard label={t('tk.satisfaction', 'Satisfaction')} value={summary.data.satisfaction ? `${summary.data.satisfaction} / 5` : '—'} sub={summary.data.avg_hours != null ? t('tk.avgHours', '{{h}} h to resolve', { h: summary.data.avg_hours }) : undefined} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {['active', 'open', 'in_progress', 'waiting', 'resolved', 'closed', ''].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'outline'} onClick={() => setStatus(s)}>{s ? t(`tk.status.${s}`, s.replace('_', ' ')) : t('common.all', 'All')}</Button>
        ))}
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('tk.none', 'No tickets here')}
        columns={[
          { key: 's', header: t('tk.subject', 'Subject'), cell: (r) => <Link to={`/tickets/${r.id}`} className="font-medium text-primary hover:underline">{r.subject}</Link> },
          { key: 'c', header: t('tk.category', 'Category'), cell: (r) => t(`tk.cat.${r.category}`, r.category), hideOnMobile: true },
          { key: 'st', header: t('common.status', 'Status'), cell: (r) => <span className="flex flex-wrap gap-1"><StatusBadge value={r.status} label={t(`tk.status.${r.status}`, r.status.replace('_', ' '))} />{r.overdue && <Badge tone="danger">{t('tk.late', 'overdue')}</Badge>}</span> },
          { key: 'p', header: t('tk.priority', 'Priority'), cell: (r) => <Badge tone={PRIORITY_TONE[r.priority as keyof typeof PRIORITY_TONE]}>{t(`tk.prio.${r.priority}`, r.priority)}</Badge>, hideOnMobile: true },
          { key: 'who', header: t('tk.from', 'From'), cell: (r) => (r.raised_by_name ?? t('tk.anonymous', 'Anonymous')) + (r.student ? ` · ${r.student}` : ''), hideOnMobile: true },
          { key: 'a', header: t('tk.assignee', 'Handled by'), cell: (r) => r.assigned_to_name ?? '—', hideOnMobile: true },
          { key: 'u', header: t('tk.updated', 'Updated'), cell: (r) => formatRelative(r.updated_at) },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {creating && <NewTicket onClose={() => setCreating(false)} />}
    </>
  );
}

function NewTicket({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const kids = useQuery({ queryKey: ['/parent/children'], queryFn: () => api.get<{ id: number; first_name: string; last_name: string }[]>('/parent/children'), enabled: user?.role === 'parent' });
  const [v, setV] = useState({ category: 'complaint', subject: '', body: '', student_id: '', anonymous: false, priority: 'normal' });
  const m = useMutation({
    mutationFn: () => api.post<{ id: number }>('/tickets', { ...v, student_id: v.student_id ? Number(v.student_id) : null }),
    onSuccess: (r) => {
      onClose();
      void nav(`/tickets/${r.id}`);
    },
  });
  return (
    <Dialog open onClose={onClose} title={t('tk.new', 'New ticket')} className="max-w-lg">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('tk.category', 'Category')}>{(a) => <Select {...a} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{t(`tk.cat.${c}`, c)}</option>)}</Select>}</Field>
          <Field label={t('tk.priority', 'Priority')}>{(a) => <Select {...a} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(`tk.prio.${p}`, p)}</option>)}</Select>}</Field>
        </div>
        {user?.role === 'parent' && (
          <Field label={t('tk.child', 'About')} optional>
            {(a) => <Select {...a} value={v.student_id} onChange={(e) => setV({ ...v, student_id: e.target.value })}><option value="">—</option>{kids.data?.map((k) => <option key={k.id} value={k.id}>{k.first_name} {k.last_name}</option>)}</Select>}
          </Field>
        )}
        <Field label={t('tk.subject', 'Subject')}>{(a) => <Input {...a} required value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} />}</Field>
        <Field label={t('tk.details', 'Details')}>{(a) => <Textarea {...a} required rows={5} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.anonymous} onChange={(e) => setV({ ...v, anonymous: e.target.checked })} /> {t('tk.anon', "Don't show my name to the office")}</label>
        <MutationError error={m.error} />
        <Button type="submit" loading={m.isPending}>{t('tk.send', 'Send')}</Button>
      </form>
    </Dialog>
  );
}

interface TicketDetail extends TicketRow {
  body: string;
  comments_list?: never;
  comments: never;
  can_manage: boolean;
  can_handle: boolean;
  mine: boolean;
}

function TicketView({ id }: { id: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<Omit<TicketDetail, 'comments'> & { comments: { id: number; body: string; internal: boolean; created_at: string; author: string | null; mine: boolean }[] }>(`/tickets/${id}`) });
  const staff = useQuery({ queryKey: ['staff-users'], queryFn: () => api.get<{ id: number; full_name: string }[]>('/messages/contacts', { q: '' }), enabled: !!q.data?.can_manage });
  const [reply, setReply] = useState({ body: '', internal: false });
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(`/tickets/${id}`, b), onSuccess: () => { void q.refetch(); toast('success', t('common.saved', 'Saved')); } });
  const comment = useMutation({ mutationFn: () => api.post(`/tickets/${id}/comments`, reply), onSuccess: () => { setReply({ body: '', internal: false }); void q.refetch(); } });
  const rate = useMutation({ mutationFn: (n: number) => api.post(`/tickets/${id}/rating`, { satisfaction: n }), onSuccess: () => q.refetch() });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <>
      <PageHeader title={d.subject} subtitle={`${t(`tk.cat.${d.category}`, d.category)} · ${d.raised_by_name ?? t('tk.anonymous', 'Anonymous')}${d.student ? ` · ${d.student}` : ''} · ${formatDateTime(d.created_at)}`} actions={<Link to="/tickets" className="text-sm text-primary">← {t('nav.tickets', 'Help desk')}</Link>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-3">
          <Card className="whitespace-pre-wrap p-4 text-sm">{d.body}</Card>
          {d.comments.map((c) => (
            <Card key={c.id} className={`p-3 text-sm ${c.internal ? 'border-warning bg-warning/10' : ''}`}>
              <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-fg-muted"><b className="text-fg">{c.author ?? '—'}</b><span>{c.internal && <Badge tone="warning">{t('tk.internal', 'internal note')}</Badge>} {formatRelative(c.created_at)}</span></div>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </Card>
          ))}
          {d.status !== 'closed' && (
            <Card className="space-y-2 p-3">
              <Textarea aria-label={t('tk.reply', 'Reply')} rows={3} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} placeholder={t('tk.reply', 'Reply')} />
              <div className="flex flex-wrap items-center gap-3">
                {d.can_handle && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={reply.internal} onChange={(e) => setReply({ ...reply, internal: e.target.checked })} /> {t('tk.internalOnly', 'Internal note (office only)')}</label>}
                <Button size="sm" loading={comment.isPending} disabled={!reply.body.trim()} onClick={() => comment.mutate()}>{t('tk.send', 'Send')}</Button>
              </div>
              <MutationError error={comment.error} />
            </Card>
          )}
        </div>
        <Card className="h-fit space-y-3 p-4 text-sm">
          <div className="flex flex-wrap gap-2"><StatusBadge value={d.status} label={t(`tk.status.${d.status}`, d.status.replace('_', ' '))} /><Badge tone={PRIORITY_TONE[d.priority as keyof typeof PRIORITY_TONE]}>{t(`tk.prio.${d.priority}`, d.priority)}</Badge>{d.overdue && <Badge tone="danger">{t('tk.late', 'overdue')}</Badge>}</div>
          {d.due_at && <p className="text-fg-muted">{t('tk.due', 'Due {{when}}', { when: formatDateTime(d.due_at) })}</p>}
          {d.can_handle && (
            <Field label={t('common.status', 'Status')}>{(a) => <Select {...a} value={d.status} onChange={(e) => patch.mutate({ status: e.target.value })}>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`tk.status.${s}`, s.replace('_', ' '))}</option>)}</Select>}</Field>
          )}
          {d.can_manage && (
            <>
              <Field label={t('tk.priority', 'Priority')}>{(a) => <Select {...a} value={d.priority} onChange={(e) => patch.mutate({ priority: e.target.value })}>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(`tk.prio.${p}`, p)}</option>)}</Select>}</Field>
              <Field label={t('tk.assignee', 'Handled by')}>
                {(a) => (
                  <Select {...a} value={d.assigned_to ?? ''} onChange={(e) => patch.mutate({ assigned_to: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">—</option>
                    {staff.data?.filter((u) => 'role' in u && ['teacher', 'institution_admin'].includes((u as { role: string }).role)).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </Select>
                )}
              </Field>
            </>
          )}
          <MutationError error={patch.error} />
          {d.mine && ['resolved', 'closed'].includes(d.status) && (
            <div>
              <p className="mb-1 font-medium">{t('tk.howDid', 'How did we do?')}</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} aria-label={`${n} / 5`} className="p-1" onClick={() => rate.mutate(n)}>
                    <Star className={`size-6 ${(d.satisfaction ?? 0) >= n ? 'fill-warning text-warning' : 'text-fg-muted'}`} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- parent–teacher meetings

interface PtmRow { id: number; title: string; date: string; start_time: string; end_time: string; mode: string; location: string; status: string; slots: number; booked: number; mine: number }
interface Slot { id: number; teacher_user_id: number; teacher?: string; starts_at: string; ends_at: string; status?: string; state?: 'open' | 'taken' | 'mine'; note: string; join_url: string; student?: string | null; booked_by?: string | null }
interface PtmDetail extends Omit<PtmRow, 'slots' | 'booked' | 'mine'> {
  view: 'office' | 'teacher' | 'family';
  slot_minutes: number;
  slots?: Slot[];
  children?: { student_id: number; name: string; teachers: { id: number; name: string; slots: Slot[] }[] }[];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function MeetingsPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['/ptm'], queryFn: () => api.get<PtmRow[]>('/ptm') });
  if (id) return <MeetingView id={Number(id)} />;
  return (
    <>
      <PageHeader title={t('nav.meetings', 'Parent–teacher meetings')} actions={can('ptm.manage') && <Button onClick={() => setCreating(true)}><CalendarPlus className="size-4" /> {t('ptm.plan', 'Plan a meeting day')}</Button>} />
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.id}
        empty={t('ptm.none', 'No meeting days yet')}
        columns={[
          { key: 't', header: t('ptm.event', 'Meeting day'), cell: (r) => <Link to={`/meetings/${r.id}`} className="font-medium text-primary hover:underline">{r.title}</Link> },
          { key: 'd', header: t('common.date', 'Date'), cell: (r) => `${formatDate(r.date)} · ${r.start_time}–${r.end_time}` },
          { key: 'm', header: t('ptm.mode', 'Where'), cell: (r) => (r.mode === 'online' ? t('ptm.online', 'Online') : r.location || t('ptm.inPerson', 'In person')), hideOnMobile: true },
          { key: 'b', header: t('ptm.booked', 'Booked'), cell: (r) => `${r.booked} / ${r.slots}${r.mine ? ` · ${t('ptm.yours', '{{n}} yours', { n: r.mine })}` : ''}` },
          { key: 's', header: t('common.status', 'Status'), cell: (r) => <StatusBadge value={r.status} />, hideOnMobile: true },
        ]}
      />
      {creating && <NewMeetingDay onClose={() => { setCreating(false); void q.refetch(); }} />}
    </>
  );
}

function NewMeetingDay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const sections = useQuery({ queryKey: ['sections-all'], queryFn: () => api.get<{ id: number; name: string }[]>('/institution/sections', { pageSize: 100 }) });
  const [v, setV] = useState({ title: '', date: '', start_time: '09:00', end_time: '12:00', slot_minutes: 10, mode: 'in_person', location: '', section_ids: [] as number[], allow_students: false });
  const m = useMutation({ mutationFn: () => api.post<{ id: number; slots: number; teachers: number }>('/ptm', v), onSuccess: onClose });
  const rows = Array.isArray(sections.data) ? sections.data : ((sections.data as unknown as { rows?: { id: number; name: string }[] })?.rows ?? []);
  return (
    <Dialog open onClose={onClose} title={t('ptm.plan', 'Plan a meeting day')} description={t('ptm.planHelp', 'Slots are created for every teacher of the chosen classes; families book them in Acadex.')} className="max-w-lg">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={t('ptm.titleHint', 'Term 1 parent–teacher meetings')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('common.date', 'Date')}>{(a) => <Input {...a} type="date" required value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />}</Field>
          <Field label={t('ptm.from', 'From')}>{(a) => <Input {...a} type="time" required value={v.start_time} onChange={(e) => setV({ ...v, start_time: e.target.value })} />}</Field>
          <Field label={t('ptm.until', 'Until')}>{(a) => <Input {...a} type="time" required value={v.end_time} onChange={(e) => setV({ ...v, end_time: e.target.value })} />}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('ptm.slot', 'Minutes each')}>{(a) => <Input {...a} type="number" min={5} max={120} value={v.slot_minutes} onChange={(e) => setV({ ...v, slot_minutes: Number(e.target.value) })} />}</Field>
          <Field label={t('ptm.mode', 'Where')}>{(a) => <Select {...a} value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}><option value="in_person">{t('ptm.inPerson', 'In person')}</option><option value="online">{t('ptm.online', 'Online')}</option></Select>}</Field>
          <Field label={t('ptm.location', 'Room')} optional>{(a) => <Input {...a} value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />}</Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('ptm.sections', 'Classes')}</legend>
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded border border-border p-2 text-sm">
            {rows.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={v.section_ids.includes(s.id)} onChange={(e) => setV({ ...v, section_ids: e.target.checked ? [...v.section_ids, s.id] : v.section_ids.filter((x) => x !== s.id) })} /> {s.name}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.allow_students} onChange={(e) => setV({ ...v, allow_students: e.target.checked })} /> {t('ptm.students', 'Students book for themselves (office hours)')}</label>
        <MutationError error={m.error} />
        <Button type="submit" loading={m.isPending} disabled={!v.section_ids.length}>{t('ptm.create', 'Create slots')}</Button>
      </form>
    </Dialog>
  );
}

function MeetingView({ id }: { id: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['ptm', id], queryFn: () => api.get<PtmDetail>(`/ptm/${id}`) });
  const book = useMutation({ mutationFn: (v: { slot: number; student_id: number }) => api.post(`/ptm-slots/${v.slot}/book`, { student_id: v.student_id }), onSuccess: () => { toast('success', t('ptm.bookedOk', 'Booked')); void q.refetch(); } });
  const cancel = useMutation({ mutationFn: (slot: number) => api.post(`/ptm-slots/${slot}/cancel`), onSuccess: () => q.refetch() });
  const mark = useMutation({ mutationFn: (v: { slot: number; status: string }) => api.patch(`/ptm-slots/${v.slot}`, { status: v.status }), onSuccess: () => q.refetch() });
  const status = useMutation({ mutationFn: (s: string) => api.patch(`/ptm/${id}`, { status: s }), onSuccess: () => q.refetch() });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const e = q.data;
  const header = (
    <PageHeader
      title={e.title}
      subtitle={`${formatDate(e.date)} · ${e.start_time}–${e.end_time} · ${e.mode === 'online' ? t('ptm.online', 'Online') : e.location || t('ptm.inPerson', 'In person')}`}
      actions={
        <div className="flex gap-2">
          {e.view === 'office' && e.status === 'open' && <Button size="sm" variant="outline" onClick={() => status.mutate('closed')}>{t('ptm.close', 'Close booking')}</Button>}
          {e.view === 'office' && e.status === 'closed' && <Button size="sm" variant="outline" onClick={() => status.mutate('open')}>{t('ptm.reopen', 'Reopen booking')}</Button>}
          <Link to="/meetings" className="self-center text-sm text-primary">← {t('nav.meetings', 'Meetings')}</Link>
        </div>
      }
    />
  );
  if (e.view === 'family') {
    return (
      <>
        {header}
        {e.status !== 'open' && <Alert tone="warning" className="mb-3">{t('ptm.closed', 'Booking is closed.')}</Alert>}
        <MutationError error={book.error} />
        {e.children!.map((c) => (
          <Card key={c.student_id} className="mb-4 space-y-3 p-4">
            <h2 className="font-semibold">{c.name}</h2>
            {c.teachers.map((tch) => {
              const mine = tch.slots.find((s) => s.state === 'mine');
              return (
                <div key={tch.id} className="space-y-1">
                  <h3 className="text-sm font-medium">{tch.name}</h3>
                  {mine ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone="success">{t('ptm.yourSlot', 'Your meeting: {{time}}', { time: time(mine.starts_at) })}</Badge>
                      {mine.join_url && <a href={mine.join_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline"><Video className="size-4" /> {t('ptm.join', 'Join online')}</a>}
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(mine.id)}>{t('ptm.cancel', 'Cancel')}</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {tch.slots.filter((s) => s.state === 'open').map((s) => (
                        <Button key={s.id} size="sm" variant="outline" disabled={e.status !== 'open'} onClick={() => book.mutate({ slot: s.id, student_id: c.student_id })}>{time(s.starts_at)}</Button>
                      ))}
                      {!tch.slots.some((s) => s.state === 'open') && <span className="text-sm text-fg-muted">{t('ptm.full', 'Fully booked')}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        ))}
      </>
    );
  }
  const byTeacher = new Map<string, Slot[]>();
  for (const s of e.slots ?? []) byTeacher.set(s.teacher ?? '', [...(byTeacher.get(s.teacher ?? '') ?? []), s]);
  return (
    <>
      {header}
      {[...byTeacher.entries()].map(([teacher, slots]) => (
        <Card key={teacher} className="mb-4 p-4">
          <h2 className="mb-2 font-semibold">{teacher}</h2>
          {!slots.length ? <EmptyState /> : (
            <ul className="divide-y divide-border text-sm">
              {slots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <b>{time(s.starts_at)}</b>
                    <StatusBadge value={s.status ?? ''} label={t(`ptm.st.${s.status}`, s.status ?? '')} />
                    {s.student && <span>{s.student}{s.booked_by ? ` (${s.booked_by})` : ''}</span>}
                    {s.note && <span className="text-fg-muted">— {s.note}</span>}
                    {s.join_url && <a href={s.join_url} target="_blank" rel="noreferrer" className="text-primary underline">{t('ptm.join', 'Join online')}</a>}
                  </span>
                  <span className="flex gap-1">
                    {s.status === 'open' && <Button size="sm" variant="ghost" onClick={() => mark.mutate({ slot: s.id, status: 'blocked' })}>{t('ptm.block', 'Block')}</Button>}
                    {s.status === 'blocked' && <Button size="sm" variant="ghost" onClick={() => mark.mutate({ slot: s.id, status: 'open' })}>{t('ptm.unblock', 'Open')}</Button>}
                    {s.status === 'booked' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => mark.mutate({ slot: s.id, status: 'done' })}>{t('ptm.done', 'Done')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => mark.mutate({ slot: s.id, status: 'no_show' })}>{t('ptm.noShow', 'No-show')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => cancel.mutate(s.id)}>{t('ptm.cancel', 'Cancel')}</Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <MutationError error={mark.error ?? cancel.error} />
    </>
  );
}

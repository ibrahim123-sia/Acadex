// Messages: my conversations and a thread view; starting a conversation (the server applies the
// safeguarding rules and explains a refusal); class groups for teachers; reporting a message;
// and the safeguarding review (queue, every conversation) for the office.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Flag, Lock, MessageSquarePlus, ShieldCheck, Users, VolumeX } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useLiveEvents } from '@/lib/lms';
import { useDebounced, usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, Tabs, Textarea, useToast } from '@/components/ui';

interface ConversationRow {
  id: number;
  kind: 'direct' | 'group' | 'class';
  title: string;
  safeguarded: boolean;
  locked: boolean;
  last_message_at: string;
  muted: boolean;
  unread: number;
  last: { body: string; sender: string; created_at: string } | null;
  members: { id: number; name: string; role: string; cc: boolean }[];
}
interface Thread {
  id: number;
  kind: string;
  title: string;
  locked: boolean;
  safeguarded: boolean;
  muted: boolean;
  my_role: 'member' | 'cc' | null;
  reviewer: boolean;
  members: { id: number; name: string; role: string; cc: boolean }[];
  messages: { id: number; sender_id: number | null; sender: string | null; sender_role: string | null; body: string; created_at: string; hidden: boolean; flagged: boolean; flag_reason: string | null }[];
}

function titleOf(c: { title: string; members: { id: number; name: string }[] }, me: number | undefined) {
  return c.title || c.members.filter((m) => m.id !== me).map((m) => m.name).join(', ') || '—';
}

export function MessagesPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const list = usePagedList<ConversationRow>('/conversations', {}, 30);
  const [creating, setCreating] = useState(false);
  const onEvent = useCallback(
    (kind: string) => {
      if (kind === 'message') {
        void qc.invalidateQueries({ queryKey: ['/conversations'] });
        void qc.invalidateQueries({ queryKey: ['thread'] });
        void qc.invalidateQueries({ queryKey: ['unread-messages'] });
      }
    },
    [qc]
  );
  useLiveEvents(onEvent);
  const active = id ? Number(id) : null;
  return (
    <>
      <PageHeader title={t('nav.messages', 'Messages')} actions={<Button onClick={() => setCreating(true)}><MessageSquarePlus className="size-4" /> {t('msg.new', 'New message')}</Button>} />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className={`overflow-hidden ${active ? 'hidden lg:block' : ''}`}>
          {list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.isPending ? (
            <Spinner />
          ) : !list.data?.rows.length ? (
            <EmptyState title={t('msg.none', 'No conversations yet')} description={t('msg.noneHint', 'Start one with “New message”.')} />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.rows.map((c) => (
                <li key={c.id}>
                  <Link to={`/messages/${c.id}`} className={`block px-4 py-3 hover:bg-surface-2 ${active === c.id ? 'bg-primary-soft/50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread ? 'font-semibold' : 'font-medium'}`}>
                        {c.kind === 'class' && <Users className="me-1 inline size-3.5" aria-hidden />}
                        {titleOf(c, user?.id)}
                      </span>
                      <span className="shrink-0 text-[11px] text-fg-muted">{formatRelative(c.last_message_at)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-fg-muted">{c.last ? `${c.last.sender ?? ''}: ${c.last.body}` : ''}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {c.safeguarded && <ShieldCheck className="size-3.5 text-success" aria-label={t('msg.guardiansCopied', 'Guardians are copied')} />}
                        {c.muted && <VolumeX className="size-3.5 text-fg-muted" aria-label={t('msg.muted', 'Muted')} />}
                        {c.unread > 0 && <Badge tone="info">{c.unread}</Badge>}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {list.data && list.data.total > list.pageSize && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
        </Card>
        <div className={active ? '' : 'hidden lg:block'}>
          {active ? <ThreadView id={active} /> : <EmptyState title={t('msg.pick', 'Pick a conversation')} />}
        </div>
      </div>
      {creating && <NewConversation onClose={() => setCreating(false)} />}
    </>
  );
}

export function ThreadView({ id, back = '/messages' }: { id: number; back?: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['thread', id], queryFn: () => api.get<Thread>(`/conversations/${id}`) });
  const [body, setBody] = useState('');
  const [report, setReport] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/messages`, { body }),
    onSuccess: () => {
      setBody('');
      void q.refetch();
    },
  });
  const mute = useMutation({ mutationFn: (muted: boolean) => api.patch(`/conversations/${id}`, { muted }), onSuccess: () => q.refetch() });
  const lock = useMutation({ mutationFn: (locked: boolean) => api.patch(`/conversations/${id}`, { locked }), onSuccess: () => q.refetch() });
  const withdraw = useMutation({ mutationFn: (mid: number) => api.delete(`/messages/${mid}`), onSuccess: () => q.refetch(), onError: (e) => toast('error', errorMessage(e)) });
  useEffect(() => {
    void end.current?.scrollIntoView({ block: 'end' });
  }, [q.data?.messages.length]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  const c = q.data;
  return (
    <Card className="flex min-h-[60vh] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Link to={back} className="text-xs text-primary lg:hidden">← {t('common.back', 'Back')}</Link>
          <h2 className="truncate font-semibold">{titleOf(c, user?.id)}</h2>
          <p className="truncate text-xs text-fg-muted">{c.members.map((m) => `${m.name}${m.cc ? ` (${t('msg.copy', 'copy')})` : ''}`).join(', ')}</p>
        </div>
        <div className="flex items-center gap-2">
          {c.my_role && (
            <Button size="sm" variant="ghost" onClick={() => mute.mutate(!c.muted)}>
              <VolumeX className="size-4" /> {c.muted ? t('msg.unmute', 'Unmute') : t('msg.mute', 'Mute')}
            </Button>
          )}
          {c.reviewer || user?.permissions.includes('messages.review') ? (
            <Button size="sm" variant="outline" onClick={() => lock.mutate(!c.locked)}>
              <Lock className="size-4" /> {c.locked ? t('msg.unlock', 'Unlock') : t('msg.lock', 'Lock')}
            </Button>
          ) : null}
        </div>
      </div>
      {c.safeguarded && <Alert className="m-3" tone="info">{t('msg.safeguarded', 'This conversation includes a student under 18, so their guardians receive a copy of every message.')}</Alert>}
      {c.reviewer && <Alert className="m-3" tone="warning">{t('msg.reviewing', 'You are reading this as the safeguarding team. Your access is recorded.')}</Alert>}
      <ol className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {c.messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${mine ? 'bg-primary text-primary-fg' : 'bg-surface-2'} ${m.hidden ? 'opacity-60' : ''}`}>
                {!mine && <div className="text-xs font-semibold">{m.sender ?? '—'}</div>}
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div className={`mt-1 flex flex-wrap items-center gap-2 text-[11px] ${mine ? 'text-primary-fg/80' : 'text-fg-muted'}`}>
                  <time dateTime={m.created_at}>{formatDateTime(m.created_at)}</time>
                  {m.hidden && <Badge tone="warning">{t('msg.hidden', 'hidden')}</Badge>}
                  {m.flagged && <Badge tone="danger">{m.flag_reason?.replace('_', ' ')}</Badge>}
                  {mine && !m.hidden && <button className="underline" onClick={() => withdraw.mutate(m.id)}>{t('msg.withdraw', 'Withdraw')}</button>}
                  {!mine && c.my_role && (
                    <button className="inline-flex items-center gap-0.5 underline" onClick={() => setReport(m.id)}>
                      <Flag className="size-3" aria-hidden /> {t('msg.report', 'Report')}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
        <div ref={end} />
      </ol>
      {c.my_role &&
        (c.locked ? (
          <Alert className="m-3" tone="warning">{t('msg.locked', 'This conversation was locked by the safeguarding team.')}</Alert>
        ) : (
          <form
            className="flex gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) send.mutate();
            }}
          >
            <Textarea aria-label={t('msg.write', 'Write a message')} rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('msg.write', 'Write a message')} className="min-h-0" />
            <Button type="submit" loading={send.isPending} className="self-end">{t('msg.send', 'Send')}</Button>
          </form>
        ))}
      <MutationError error={send.error} />
      {report && <ReportDialog messageId={report} onClose={() => setReport(null)} />}
    </Card>
  );
}

function ReportDialog({ messageId, onClose }: { messageId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/messages/${messageId}/report`, { reason }),
    onSuccess: () => {
      toast('success', t('msg.reported', 'Reported to the safeguarding team'));
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t('msg.reportTitle', 'Report this message')} description={t('msg.reportHelp', 'The safeguarding team will see the message and your reason.')}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t('msg.reason', 'What is wrong?')}>{(a) => <Textarea {...a} required value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <MutationError error={m.error} />
        <Button type="submit" loading={m.isPending}>{t('msg.report', 'Report')}</Button>
      </form>
    </Dialog>
  );
}

function NewConversation({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<'people' | 'class'>('people');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const contacts = useQuery({ queryKey: ['contacts', q], queryFn: () => api.get<{ id: number; full_name: string; role: string; detail: string | null }[]>('/messages/contacts', { q }) });
  const courses = useQuery({ queryKey: ['/courses'], queryFn: () => api.get<{ id: number; name: string; section_name: string | null; can_edit?: boolean }[]>('/courses'), enabled: user?.role === 'teacher' });
  const [picked, setPicked] = useState<{ id: number; full_name: string }[]>([]);
  const [v, setV] = useState({ title: '', body: '', offering_id: '', include_guardians: false });
  const create = useMutation({
    mutationFn: () =>
      mode === 'class'
        ? api.post<{ id: number }>('/conversations/class', { offering_id: Number(v.offering_id), title: v.title, body: v.body, include_guardians: v.include_guardians })
        : api.post<{ id: number }>('/conversations', { user_ids: picked.map((p) => p.id), title: v.title, body: v.body }),
    onSuccess: (r) => {
      onClose();
      void nav(`/messages/${r.id}`);
    },
  });
  return (
    <Dialog open onClose={onClose} title={t('msg.new', 'New message')} className="max-w-lg">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        {user?.role === 'teacher' && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={mode === 'people' ? 'primary' : 'outline'} onClick={() => setMode('people')}>{t('msg.people', 'People')}</Button>
            <Button type="button" size="sm" variant={mode === 'class' ? 'primary' : 'outline'} onClick={() => setMode('class')}>{t('msg.classGroup', 'A whole class')}</Button>
          </div>
        )}
        {mode === 'people' ? (
          <>
            <div className="flex flex-wrap gap-1">
              {picked.map((p) => (
                <Badge key={p.id} tone="info">
                  {p.full_name} <button type="button" aria-label={t('common.remove', 'Remove')} className="ms-1" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>×</button>
                </Badge>
              ))}
            </div>
            <Field label={t('msg.to', 'To')}>{(a) => <Input {...a} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('msg.searchPeople', 'Search by name')} />}</Field>
            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded border border-border">
              {contacts.data?.filter((c) => !picked.some((p) => p.id === c.id)).map((c) => (
                <li key={c.id}>
                  <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-surface-2" onClick={() => setPicked([...picked, c])}>
                    <span>{c.full_name}</span>
                    <span className="text-xs text-fg-muted">{t(`roles.${c.role}`, c.role)}{c.detail ? ` · ${c.detail}` : ''}</span>
                  </button>
                </li>
              ))}
              {contacts.data?.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">{t('msg.noContacts', 'Nobody you can message matches')}</li>}
            </ul>
          </>
        ) : (
          <>
            <Field label={t('common.course', 'Course')}>
              {(a) => (
                <Select {...a} required value={v.offering_id} onChange={(e) => setV({ ...v, offering_id: e.target.value })}>
                  <option value="">—</option>
                  {courses.data?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.section_name ? ` · ${c.section_name}` : ''}</option>)}
                </Select>
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.include_guardians} onChange={(e) => setV({ ...v, include_guardians: e.target.checked })} /> {t('msg.includeGuardians', 'Include their guardians')}</label>
          </>
        )}
        <Field label={t('msg.subject', 'Subject')} optional>{(a) => <Input {...a} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
        <Field label={t('msg.message', 'Message')}>{(a) => <Textarea {...a} required value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field>
        <MutationError error={create.error} />
        <Button type="submit" loading={create.isPending} disabled={mode === 'people' && !picked.length}>{t('msg.send', 'Send')}</Button>
      </form>
    </Dialog>
  );
}

/** Unread messages (for the menu). */
export function useUnreadMessages() {
  return useQuery({ queryKey: ['unread-messages'], queryFn: () => api.get<{ unread: number }>('/conversations/unread'), refetchInterval: 120_000 });
}

// ---------------------------------------------------------------- safeguarding

interface Queue {
  reports: { id: number; reason: string; created_at: string; reporter: string | null; message_id: number; body: string; conversation_id: number; sender: string | null; hidden: boolean }[];
  flagged: { message_id: number; body: string; flag_reason: string; created_at: string; conversation_id: number; sender: string | null; hidden: boolean }[];
}

export function SafeguardingPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  return (
    <>
      <PageHeader title={t('nav.safeguarding', 'Safeguarding')} subtitle={t('msg.sgSubtitle', 'Reports, flagged messages and every conversation — all reads are recorded')} />
      {id ? (
        <ThreadView id={Number(id)} back="/safeguarding" />
      ) : (
        <Tabs tabs={[{ id: 'queue', label: t('msg.queue', 'To review'), content: () => <QueueTab /> }, { id: 'all', label: t('msg.allConversations', 'All conversations'), content: () => <AllConversations /> }]} />
      )}
    </>
  );
}

function QueueTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['sg-queue'], queryFn: () => api.get<Queue>('/safeguarding/queue') });
  const review = useMutation({ mutationFn: (v: { id: number; status: string; hide_message?: boolean; lock_conversation?: boolean }) => api.patch(`/safeguarding/reports/${v.id}`, v), onSuccess: () => q.refetch() });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t('msg.reports', 'Reports')} ({q.data.reports.length})</h2>
        {!q.data.reports.length ? <EmptyState title={t('msg.noReports', 'No open reports')} /> : (
          <ul className="divide-y divide-border">
            {q.data.reports.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-sm">
                <p><b>{r.sender}</b>: “{r.body}”</p>
                <p className="text-fg-muted">{t('msg.reportedBy', 'Reported by {{who}}: {{why}}', { who: r.reporter ?? '—', why: r.reason })} · {formatRelative(r.created_at)}</p>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/safeguarding/${r.conversation_id}`} className="text-primary underline">{t('msg.openConversation', 'Open the conversation')}</Link>
                  <Button size="sm" variant="danger" onClick={() => review.mutate({ id: r.id, status: 'actioned', hide_message: true })}>{t('msg.hideMessage', 'Hide the message')}</Button>
                  <Button size="sm" variant="outline" onClick={() => review.mutate({ id: r.id, status: 'actioned', hide_message: true, lock_conversation: true })}>{t('msg.hideAndLock', 'Hide and lock')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: r.id, status: 'dismissed' })}>{t('msg.dismiss', 'Dismiss')}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t('msg.flagged', 'Flagged by the filters (30 days)')}</h2>
        {!q.data.flagged.length ? <EmptyState title={t('msg.noFlagged', 'Nothing flagged')} /> : (
          <ul className="divide-y divide-border text-sm">
            {q.data.flagged.map((m) => (
              <li key={m.message_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Badge tone="danger">{m.flag_reason.replace('_', ' ')}</Badge> <b>{m.sender}</b>: {m.body}</span>
                <Link to={`/safeguarding/${m.conversation_id}`} className="text-primary underline">{t('msg.open', 'Open')}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AllConversations() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = usePagedList<{ id: number; kind: string; title: string; members: string; flagged: number; locked: boolean; safeguarded: boolean; last_message_at: string }>('/safeguarding/conversations', { q: q || undefined }, 30);
  return (
    <Card className="p-4">
      <Input aria-label={t('msg.searchMember', 'Search by member')} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('msg.searchMember', 'Search by member')} className="mb-3 max-w-sm" />
      {list.error ? <ErrorState error={list.error} /> : !list.data ? <Spinner /> : (
        <ul className="divide-y divide-border text-sm">
          {list.data.rows.map((c) => (
            <li key={c.id}>
              <Link to={`/safeguarding/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 hover:bg-surface-2">
                <span className="min-w-0 truncate">{c.title || c.members}</span>
                <span className="flex items-center gap-1 text-xs text-fg-muted">
                  {c.flagged > 0 && <Badge tone="danger">{c.flagged}</Badge>}
                  {c.locked && <Lock className="size-3.5" aria-label={t('msg.lockedShort', 'Locked')} />}
                  {formatRelative(c.last_message_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </Card>
  );
}

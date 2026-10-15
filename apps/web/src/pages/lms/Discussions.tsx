// Course discussions: open threads and Q&A (answer first, then see the others), replies,
// moderation (hide, lock, pin) by staff.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EyeOff, Lock, MessageSquare, Pin, Plus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import type { CourseRole } from '@/lib/lms';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, useToast } from '@/components/ui';
import { RichEditor, RichText } from '@/components/RichText';

interface Thread {
  id: number;
  title: string;
  mode: 'open' | 'qa';
  locked: boolean;
  pinned: boolean;
  author: string | null;
  posts: number;
  last_post_at: string | null;
  created_at: string;
}

export function DiscussionsTab({ courseId, role }: { courseId: number; role: CourseRole }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['discussions', courseId], queryFn: () => api.get<Thread[]>(`/courses/${courseId}/discussions`) });
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Polls courseId={courseId} canVote={role !== 'guardian'} />
      {role !== 'guardian' && (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> {t('lms.newDiscussion', 'New discussion')}
        </Button>
      )}
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : !q.data.length ? (
        <Card><EmptyState title={t('lms.noDiscussions', 'No discussions yet')} /></Card>
      ) : (
        <Card className="divide-y divide-border">
          {q.data.map((d) => (
            <Link key={d.id} to={`discussions/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <MessageSquare className="size-5 shrink-0 text-fg-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {d.pinned && <Pin className="size-3.5 text-primary" aria-label={t('lms.pinned', 'Pinned')} />}
                  {d.title}
                  {d.mode === 'qa' && <Badge tone="info">Q&A</Badge>}
                  {d.locked && <Lock className="size-3.5 text-fg-muted" aria-label={t('lms.locked', 'Locked')} />}
                </div>
                <div className="text-xs text-fg-muted">
                  {d.author} · {t('lms.replies', '{{n}} replies', { n: d.posts })} {d.last_post_at && `· ${formatRelative(d.last_post_at)}`}
                </div>
              </div>
            </Link>
          ))}
        </Card>
      )}
      {open && <NewDiscussion courseId={courseId} staff={role === 'staff'} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NewDiscussion({ courseId, staff, onClose }: { courseId: number; staff: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mode, setMode] = useState('open');
  const save = useMutation({
    mutationFn: () => api.post(`/courses/${courseId}/discussions`, { title, body_html: body, mode }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['discussions', courseId] });
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={t('lms.newDiscussion', 'New discussion')} className="max-w-2xl">
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} required value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <RichEditor label={t('lms.message', 'Message')} value={body} onChange={setBody} />
        {staff && (
          <Field label={t('lms.mode', 'Kind')}>
            {(a) => (
              <Select {...a} value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="open">{t('lms.openDiscussion', 'Open discussion')}</option>
                <option value="qa">{t('lms.qa', 'Q&A: students see others’ answers after posting their own')}</option>
              </Select>
            )}
          </Field>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>{t('lms.post', 'Post')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

interface Post {
  id: number;
  parent_id: number | null;
  body_html: string;
  hidden: boolean;
  created_at: string;
  author_id: number | null;
  author: string | null;
  author_role: string | null;
}

export function DiscussionPage() {
  const { t } = useTranslation();
  const id = Number(useParams().discussionId);
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['discussion', id], queryFn: () => api.get<Thread & { body_html: string; can_moderate: boolean; hidden_until_post: boolean; posts: Post[] }>(`/discussions/${id}`) });
  const [reply, setReply] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['discussion', id] });
  const post = useMutation({
    mutationFn: () => api.post(`/discussions/${id}/posts`, { body_html: reply, parent_id: replyTo }),
    onSuccess: () => {
      setReply('');
      setReplyTo(null);
      void refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const moderate = useMutation({ mutationFn: (v: { id: number; hidden: boolean }) => api.post(`/posts/${v.id}/moderate`, { hidden: v.hidden }), onSuccess: refresh });
  const patch = useMutation({ mutationFn: (v: Record<string, boolean>) => api.patch(`/discussions/${id}`, v), onSuccess: refresh });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} />;
  const d = q.data;
  const roots = d.posts.filter((p) => !p.parent_id);
  const children = (pid: number) => d.posts.filter((p) => p.parent_id === pid);
  const renderPost = (p: Post, depth = 0) => (
    <li key={p.id} className={cn(depth > 0 && 'ms-6 border-s border-border ps-3')}>
      <div className={cn('rounded-lg p-3', p.hidden ? 'bg-danger-soft/40' : 'bg-surface-2')}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span className="font-medium text-fg">{p.author ?? '—'}</span>
          {p.author_role && p.author_role !== 'student' && <Badge tone="info">{t(`roles.${p.author_role}`, p.author_role)}</Badge>}
          <span>{formatRelative(p.created_at)}</span>
          {p.hidden && <Badge tone="danger">{t('lms.hiddenPost', 'Hidden')}</Badge>}
        </div>
        <RichText html={p.body_html} />
        <div className="mt-1 flex gap-3 text-xs">
          {!d.locked && (
            <button type="button" className="text-primary hover:underline" onClick={() => setReplyTo(p.id)}>
              {t('lms.reply', 'Reply')}
            </button>
          )}
          {d.can_moderate && (
            <button type="button" className="text-fg-muted hover:underline" onClick={() => moderate.mutate({ id: p.id, hidden: !p.hidden })}>
              <EyeOff className="me-1 inline size-3" aria-hidden />
              {p.hidden ? t('lms.unhide', 'Show') : t('lms.hide', 'Hide')}
            </button>
          )}
        </div>
      </div>
      {children(p.id).length > 0 && <ul className="mt-2 space-y-2">{children(p.id).map((c) => renderPost(c, depth + 1))}</ul>}
    </li>
  );
  return (
    <>
      <PageHeader
        title={d.title}
        subtitle={d.author}
        actions={
          d.can_moderate && (
            <>
              <Button size="sm" variant="outline" onClick={() => patch.mutate({ pinned: !d.pinned })}>
                <Pin className="size-4" /> {d.pinned ? t('lms.unpin', 'Unpin') : t('lms.pin', 'Pin')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => patch.mutate({ locked: !d.locked })}>
                <Lock className="size-4" /> {d.locked ? t('lms.unlock', 'Unlock') : t('lms.lock', 'Lock')}
              </Button>
            </>
          )
        }
      />
      {d.body_html && <Card className="mb-4 p-4"><RichText html={d.body_html} /></Card>}
      {d.hidden_until_post && <Alert className="mb-4">{t('lms.qaHint', 'Post your answer to see what your classmates wrote.')}</Alert>}
      <ul className="mb-4 space-y-3">{roots.map((p) => renderPost(p))}</ul>
      {d.locked ? (
        <Alert tone="warning">{t('lms.discussionLocked', 'This discussion is locked.')}</Alert>
      ) : (
        <Card className="space-y-2 p-4">
          {replyTo && (
            <div className="text-xs text-fg-muted">
              {t('lms.replyingTo', 'Replying to a post')} ·{' '}
              <button type="button" className="text-primary hover:underline" onClick={() => setReplyTo(null)}>
                {t('common.cancel', 'Cancel')}
              </button>
            </div>
          )}
          <RichEditor label={t('lms.yourReply', 'Your reply')} value={reply} onChange={setReply} minHeight="min-h-24" />
          <Button onClick={() => post.mutate()} loading={post.isPending} disabled={!reply.replace(/<[^>]*>/g, '').trim()}>
            {t('lms.post', 'Post')}
          </Button>
        </Card>
      )}
    </>
  );
}

/** Open polls of the course: vote once (you can change it), see the results after voting. */
function Polls({ courseId, canVote }: { courseId: number; canVote: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['polls', courseId], queryFn: () => api.get<{ id: number; question: string; options: string[]; multiple: boolean; my_choices: number[] | null; votes: number; closes_at: string | null }[]>(`/courses/${courseId}/polls`) });
  const vote = useMutation({
    mutationFn: (v: { id: number; choice: number }) => api.post(`/polls/${v.id}/vote`, { choices: [v.choice] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['polls', courseId] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const open = (q.data ?? []).filter((p) => !p.closes_at || new Date(p.closes_at) > new Date());
  if (!open.length) return null;
  return (
    <div className="space-y-2">
      {open.map((p) => (
        <Card key={p.id} className="p-4">
          <div className="mb-2 font-medium">{p.question}</div>
          <div className="flex flex-wrap gap-2">
            {p.options.map((o, i) => (
              <Button key={o} size="sm" variant={p.my_choices?.includes(i) ? 'primary' : 'outline'} disabled={!canVote} onClick={() => vote.mutate({ id: p.id, choice: i })}>
                {o}
              </Button>
            ))}
          </div>
          <div className="mt-1 text-xs text-fg-muted">{t('lms.votesN', '{{n}} votes', { n: p.votes })}</div>
        </Card>
      ))}
    </div>
  );
}

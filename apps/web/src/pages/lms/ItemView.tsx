// One piece of course content: a page, file, video, link, live class or SCORM package, with
// "mark as done", resume and previous / next.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, CheckCircle2, Download, ExternalLink, Pencil } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { Item } from '@/lib/lms';
import { Alert, Button, Card, ErrorState, Field, Input, PageHeader, Spinner, useToast } from '@/components/ui';
import { RichEditor, RichText } from '@/components/RichText';
import { useCourse } from './Courses';

interface ItemDetail extends Item {
  body_html: string;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  progress: { status: string; percent: number; resume: Record<string, unknown> | null } | null;
}

export function ItemPage() {
  const { t } = useTranslation();
  const params = useParams();
  const courseId = Number(params.courseId);
  const itemId = Number(params.itemId);
  const course = useCourse(courseId);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['item', itemId], queryFn: () => api.get<ItemDetail>(`/content-items/${itemId}`) });
  // opening an item may complete it: refresh the course outline
  useEffect(() => {
    if (q.data) void qc.invalidateQueries({ queryKey: ['course', courseId] });
  }, [q.data, qc, courseId]);
  const done = useMutation({
    mutationFn: () => api.put(`/content-items/${itemId}/progress`, { status: 'done' }),
    onSuccess: () => {
      toast('success', t('lms.markedDone', 'Marked as done'));
      void qc.invalidateQueries({ queryKey: ['course', courseId] });
      void qc.invalidateQueries({ queryKey: ['item', itemId] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (q.isPending || course.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (course.isError) return <ErrorState error={course.error} />;
  const it = q.data;
  const home = course.data;
  const flat = home.modules.flatMap((m) => m.items).filter((x) => !x.locked);
  const i = flat.findIndex((x) => x.id === itemId);
  const prev = flat[i - 1];
  const next = flat[i + 1];
  const href = (x: Item) => (x.kind === 'assessment' && x.assessment_id ? `../work/${x.assessment_id}` : `../items/${x.id}`);
  const isStudent = home.role === 'student';
  const isDone = it.progress?.status === 'done' || home.modules.flatMap((m) => m.items).find((x) => x.id === itemId)?.done;

  return (
    <>
      <PageHeader
        title={it.title}
        subtitle={<Link to="../../#content" relative="path" className="hover:underline">{home.course.name}</Link>}
        actions={
          home.role === 'staff' && home.can_edit && it.kind === 'page' ? (
            <Button variant="outline" onClick={() => setEditing((e) => !e)}>
              <Pencil className="size-4" /> {editing ? t('common.close', 'Close') : t('common.edit', 'Edit')}
            </Button>
          ) : undefined
        }
      />
      {editing ? <PageEditor item={it} onSaved={() => setEditing(false)} /> : <ItemBody item={it} isStudent={isStudent} />}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {prev ? (
          <Link to={href(prev)} relative="path">
            <Button variant="outline">
              <ArrowLeft className="size-4 rtl:rotate-180" /> {prev.title}
            </Button>
          </Link>
        ) : (
          <span />
        )}
        {isStudent && it.completion === 'mark_done' && (
          <Button onClick={() => done.mutate()} disabled={!!isDone} loading={done.isPending} variant={isDone ? 'secondary' : 'primary'}>
            <CheckCircle2 className="size-4" /> {isDone ? t('lms.done', 'Done') : t('lms.markDone', 'Mark as done')}
          </Button>
        )}
        {next && (
          <Link to={href(next)} relative="path">
            <Button variant="outline">
              {next.title} <ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
          </Link>
        )}
      </div>
    </>
  );
}

function PageEditor({ item, onSaved }: { item: ItemDetail; onSaved: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(item.title);
  const [html, setHtml] = useState(item.body_html);
  const save = useMutation({
    mutationFn: () => api.patch(`/content-items/${item.id}`, { title, body_html: html }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['item', item.id] });
      toast('success', t('common.saved', 'Saved'));
      onSaved();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Card className="space-y-4 p-4">
      <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <RichEditor label={t('lms.pageBody', 'Page')} value={html} onChange={setHtml} minHeight="min-h-72" />
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          {t('common.save', 'Save')}
        </Button>
      </div>
    </Card>
  );
}

function ItemBody({ item, isStudent }: { item: ItemDetail; isStudent: boolean }) {
  const { t } = useTranslation();
  if (item.kind === 'page') return <Card className="p-5"><RichText html={item.body_html} /></Card>;
  if (item.kind === 'video' && item.video_provider) {
    const src =
      item.video_provider === 'youtube'
        ? `https://www.youtube-nocookie.com/embed/${item.video_ref}`
        : item.video_provider === 'vimeo'
          ? `https://player.vimeo.com/video/${item.video_ref}`
          : item.video_provider === 'loom'
            ? `https://www.loom.com/embed/${item.video_ref}`
            : `https://drive.google.com/file/d/${item.video_ref}/preview`;
    return (
      <Card className="overflow-hidden">
        <iframe title={item.title} src={src} className="aspect-video w-full" allow="fullscreen; picture-in-picture" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" />
        {item.body_html && <div className="p-4"><RichText html={item.body_html} /></div>}
      </Card>
    );
  }
  if (item.kind === 'file' && item.file_id) return <FileView item={item} />;
  if (item.kind === 'link' || item.kind === 'embed') {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <span className="break-all text-sm text-fg-muted" dir="ltr">{item.url}</span>
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          <Button>
            <ExternalLink className="size-4" /> {t('lms.openLink', 'Open')}
          </Button>
        </a>
      </Card>
    );
  }
  if (item.kind === 'scorm') return <ScormPlayer itemId={item.id} isStudent={isStudent} />;
  if (item.kind === 'live') return <Alert>{t('lms.liveHere', 'Join this class from the Live classes tab when it starts.')}</Alert>;
  return null;
}

/** Files are protected: fetched with the session, then shown (PDFs, images, audio, video) or downloaded. */
function FileView({ item }: { item: ItemDetail }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const viewable = !!item.file_type && /^(application\/pdf|image\/|audio\/|video\/)/.test(item.file_type);
  useEffect(() => {
    if (!viewable) return;
    let revoke: string | null = null;
    const ctrl = new AbortController();
    api.blob(`/files/${item.file_id}`, ctrl.signal).then(
      (b) => {
        revoke = URL.createObjectURL(b);
        setUrl(revoke);
      },
      () => {}
    );
    return () => {
      ctrl.abort();
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [item.file_id, viewable]);
  return (
    <Card className="overflow-hidden">
      {viewable && url && (
        <>
          {item.file_type === 'application/pdf' && <iframe title={item.title} src={url} className="h-[70vh] w-full" />}
          {item.file_type?.startsWith('image/') && <img src={url} alt={item.title} className="mx-auto max-h-[70vh]" />}
          {item.file_type?.startsWith('audio/') && <audio controls src={url} className="w-full p-4" />}
          {item.file_type?.startsWith('video/') && <video controls src={url} className="w-full" />}
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <span className="text-sm text-fg-muted">
          {item.file_name} {item.file_size ? `· ${Math.round(item.file_size / 1024)} KB` : ''}
        </span>
        <Button variant="outline" onClick={() => api.download(`/files/${item.file_id}?download=1`, item.file_name ?? 'file')}>
          <Download className="size-4" /> {t('common.download', 'Download')}
        </Button>
      </div>
    </Card>
  );
}

/** Plays a SCORM package in a sandbox and saves what it reports, with the person's own session. */
function ScormPlayer({ itemId, isStudent }: { itemId: number; isStudent: boolean }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const qc = useQueryClient();
  const launch = useQuery({ queryKey: ['scorm', itemId], queryFn: () => api.get<{ url: string; version: string; preview: boolean; attempt: { status: string; score_percent: string | null } | null }>(`/scorm/items/${itemId}/launch`), staleTime: 5 * 60_000 });
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!isStudent) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: Record<string, string> | null = null;
    const flush = () => {
      if (!pending) return;
      const cmi = pending;
      pending = null;
      api.put<{ status: string; completed: boolean }>(`/scorm/items/${itemId}/attempt`, { cmi }).then((r) => {
        setStatus(r.status);
        if (r.completed) void qc.invalidateQueries({ queryKey: ['course'] });
      }, () => {});
    };
    const onMessage = (e: MessageEvent) => {
      // only from our own player frame
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { acadexScorm?: number; cmi?: Record<string, string>; finish?: boolean };
      if (!d?.acadexScorm || typeof d.cmi !== 'object') return;
      pending = Object.fromEntries(Object.entries(d.cmi).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').slice(0, 2000));
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, d.finish ? 0 : 800);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (timer) clearTimeout(timer);
      flush();
    };
  }, [itemId, isStudent, qc]);
  if (launch.isPending) return <Spinner />;
  if (launch.isError) return <ErrorState error={launch.error} />;
  return (
    <Card className="overflow-hidden">
      {launch.data.preview && <Alert className="m-3">{t('lms.scormPreview', 'Preview: nothing you do here is saved.')}</Alert>}
      <iframe ref={frame} title={t('lms.scorm', 'eLearning package')} src={launch.data.url} className="h-[75vh] w-full border-0 bg-white" sandbox="allow-scripts allow-forms allow-popups allow-modals" />
      <div className="px-4 py-2 text-xs text-fg-muted">
        SCORM {launch.data.version}
        {(status ?? launch.data.attempt?.status) && ` · ${t('lms.status', 'Status')}: ${status ?? launch.data.attempt?.status}`}
      </div>
    </Card>
  );
}

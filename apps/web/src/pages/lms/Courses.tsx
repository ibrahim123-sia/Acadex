// My courses, and a course's home: its modules and content (built in place by staff,
// worked through by students), work, grades, discussions, live classes and settings.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Circle,
  ClipboardList,
  Eye,
  EyeOff,
  FileText,
  Film,
  Link2,
  Lock,
  MonitorPlay,
  Package,
  Plus,
  Trash2,
  Video,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { dueLabel, type CourseHome, type CourseSummary, type Item, type Module } from '@/lib/lms';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Tabs, useToast } from '@/components/ui';
import { CopilotTab, TutorTab } from '@/pages/ai/CourseAi';
import { RichEditor } from '@/components/RichText';
import { WorkList } from './Work';
import { GradebookTab } from './Gradebook';
import { DiscussionsTab } from './Discussions';
import { LiveTab, CourseSettingsTab, ProgressTab } from './CourseExtras';

export const courseBase = (role: string) => (role === 'staff' ? '/teach' : '/learn');

export function CoursesPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const all = can('courses.manage_any');
  const q = useQuery({ queryKey: ['courses', all], queryFn: () => api.page<CourseSummary>('/courses', { pageSize: 100, all: all || undefined }) });
  return (
    <>
      <PageHeader title={t('lms.myCourses', 'My courses')} />
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.rows.length ? (
        <Card>
          <EmptyState title={t('lms.noCourses', 'No courses yet')} description={t('lms.noCoursesHelp', 'Courses appear here once the office assigns them.')} />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.rows.map((c) => (
            <li key={c.id}>
              <CourseCard c={c} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CourseCard({ c }: { c: CourseSummary }) {
  const { t } = useTranslation();
  const due = c.next_due ? dueLabel(c.next_due.due_at) : null;
  return (
    <Link to={`courses/${c.id}`} className="block h-full rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <BookOpen className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold">{c.name}</div>
          <div className="truncate text-xs text-fg-muted">{[c.section_name, c.term_name, c.teachers].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {c.progress_percent != null && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-xs text-fg-muted">
            <span>{t('lms.progress', 'Progress')}</span>
            <span>{c.progress_percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-surface-2" role="progressbar" aria-label={t('lms.progress', 'Progress')} aria-valuenow={c.progress_percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 rounded-full bg-primary" style={{ width: `${c.progress_percent}%` }} />
          </div>
        </div>
      )}
      {c.next_due && due && (
        <div className="mt-3 text-xs">
          <Badge tone={due.tone === 'neutral' ? 'info' : due.tone}>{due.text}</Badge> <span className="text-fg-muted">{c.next_due.title}</span>
        </div>
      )}
    </Link>
  );
}

export const useCourse = (id: number) => useQuery({ queryKey: ['course', id], queryFn: () => api.get<CourseHome>(`/courses/${id}`) });

const ITEM_ICON: Record<Item['kind'], typeof FileText> = {
  page: FileText,
  file: Package,
  link: Link2,
  video: Video,
  embed: Film,
  assessment: ClipboardList,
  live: MonitorPlay,
  scorm: Package,
};

export function CourseHomePage() {
  const { t } = useTranslation();
  const id = Number(useParams().courseId);
  const q = useCourse(id);
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const staff = c.role === 'staff';
  return (
    <>
      <PageHeader
        title={c.course.name}
        subtitle={[c.course.code, c.course.section_name, c.staff.map((s) => s.name).join(', ')].filter(Boolean).join(' · ')}
        actions={
          c.resume_item_id ? (
            <Link to={`items/${c.resume_item_id}`}>
              <Button>{c.progress?.done ? t('lms.continue', 'Continue') : t('lms.start', 'Start')}</Button>
            </Link>
          ) : undefined
        }
      />
      {c.course.archived && <Alert tone="warning" className="mb-4">{t('lms.archived', 'This course belongs to an archived year and is read-only.')}</Alert>}
      {c.progress && (
        <div className="mb-4 flex items-center gap-3 text-sm">
          <div className="h-2 flex-1 rounded-full bg-surface-2" role="progressbar" aria-valuenow={c.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('lms.progress', 'Progress')}>
            <div className="h-2 rounded-full bg-primary" style={{ width: `${c.progress.percent}%` }} />
          </div>
          <span className="tabular-nums text-fg-muted">
            {c.progress.done}/{c.progress.total}
          </span>
        </div>
      )}
      <Tabs
        tabs={[
          { id: 'content', label: t('lms.content', 'Content'), content: () => <ContentTab home={c} /> },
          { id: 'work', label: t('lms.work', 'Work'), content: () => <WorkList courseId={id} role={c.role} canEdit={c.can_edit} /> },
          { id: 'grades', label: t('lms.grades', 'Grades'), content: () => <GradebookTab courseId={id} role={c.role} canEdit={c.can_edit} /> },
          { id: 'discussions', label: t('lms.discussions', 'Discussions'), content: () => <DiscussionsTab courseId={id} role={c.role} /> },
          { id: 'live', label: t('lms.live', 'Live classes'), content: () => <LiveTab courseId={id} role={c.role} canEdit={c.can_edit} /> },
          { id: 'progress', label: t('lms.people', 'People & progress'), hidden: !staff, content: () => <ProgressTab courseId={id} /> },
          { id: 'tutor', label: t('ai.tutor', 'Ask the tutor'), hidden: c.role !== 'student', content: () => <TutorTab courseId={id} /> },
          { id: 'copilot', label: t('ai.copilot', 'Copilot'), hidden: !staff || !c.can_edit, content: () => <CopilotTab courseId={id} /> },
          { id: 'settings', label: t('lms.settings', 'Settings'), hidden: !staff || !c.can_edit, content: () => <CourseSettingsTab home={c} /> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- content

function ContentTab({ home }: { home: CourseHome }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const staff = home.role === 'staff' && home.can_edit;
  const [adding, setAdding] = useState<number | null>(null);
  const [newModule, setNewModule] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['course', home.course.id] });
  const run = (fn: () => Promise<unknown>) => fn().then(refresh, (e) => toast('error', errorMessage(e)));

  const addModule = useMutation({
    mutationFn: () => api.post(`/courses/${home.course.id}/modules`, { title: newModule, published: false }),
    onSuccess: () => {
      setNewModule('');
      void refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const move = (list: { id: number }[], i: number, dir: -1 | 1, url: string) => {
    const ids = list.map((x) => x.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => api.put(url, { ids }));
  };
  const saveModule = (m: Module, patch: Partial<Module>) =>
    run(() =>
      api.patch(`/modules/${m.id}`, {
        title: m.title,
        description: m.description,
        published: m.published,
        unlock_at: m.unlock_at,
        prerequisite_module_id: m.prerequisite_module_id,
        mastery_percent: m.mastery_percent == null ? null : Number(m.mastery_percent),
        ...patch,
      })
    );

  if (!home.modules.length && !staff) return <Card><EmptyState title={t('lms.noContent', 'Nothing has been published yet')} /></Card>;
  return (
    <div className="space-y-4">
      {home.modules.map((m, mi) => (
        <Card key={m.id} className={cn('overflow-hidden', m.locked && 'opacity-80')}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 font-semibold">
                {m.locked && <Lock className="size-4 text-fg-muted" aria-label={t('lms.locked', 'Locked')} />}
                {m.done && <CheckCircle2 className="size-4 text-success" aria-label={t('lms.done', 'Done')} />}
                {m.title}
              </h2>
              {m.lock_reason && <p className="text-xs text-fg-muted">{m.lock_reason}</p>}
              {staff && (m.prerequisite_module_id || m.unlock_at) && (
                <p className="text-xs text-fg-muted">
                  {m.unlock_at && t('lms.opensOn', 'Opens {{date}}', { date: formatDate(m.unlock_at) })}
                  {m.prerequisite_module_id && ` · ${t('lms.after', 'after')} “${home.modules.find((x) => x.id === m.prerequisite_module_id)?.title ?? '…'}”`}
                  {m.mastery_percent && ` (${Number(m.mastery_percent)}%)`}
                </p>
              )}
            </div>
            {staff && (
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant={m.published ? 'secondary' : 'primary'} onClick={() => saveModule(m, { published: !m.published })}>
                  {m.published ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  {m.published ? t('lms.published', 'Published') : t('lms.publish', 'Publish')}
                </Button>
                <ModuleRules m={m} modules={home.modules} onSave={(p) => saveModule(m, p)} />
                <Button size="sm" variant="ghost" aria-label={t('common.moveUp', 'Move up')} onClick={() => move(home.modules, mi, -1, `/courses/${home.course.id}/modules/order`)}>
                  <ArrowUp className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label={t('common.moveDown', 'Move down')} onClick={() => move(home.modules, mi, 1, `/courses/${home.course.id}/modules/order`)}>
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('common.delete', 'Delete')}
                  onClick={() => window.confirm(t('lms.deleteModule', 'Delete this module and everything in it?')) && run(() => api.delete(`/modules/${m.id}?force=true`))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </div>
          <ul className="divide-y divide-border">
            {m.items.map((it, ii) => {
              const Icon = ITEM_ICON[it.kind];
              const body = (
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  {home.role === 'student' ? (
                    it.done ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-label={t('lms.done', 'Done')} /> : <Circle className="size-5 shrink-0 text-fg-muted" aria-label={t('lms.notDone', 'Not done')} />
                  ) : (
                    <Icon className="size-5 shrink-0 text-fg-muted" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{it.title}</span>
                    <span className="block text-xs text-fg-muted">
                      {t(`lms.kind.${it.kind}`, it.kind)}
                      {it.due_at && ` · ${dueLabel(it.due_at).text}`}
                      {it.lock_reason && ` · ${it.lock_reason}`}
                      {staff && !it.published && ` · ${t('lms.hidden', 'hidden')}`}
                    </span>
                  </span>
                </span>
              );
              const href = it.kind === 'assessment' && it.assessment_id ? `work/${it.assessment_id}` : `items/${it.id}`;
              return (
                <li key={it.id} className="flex items-center gap-2 px-4 py-2.5">
                  {it.locked ? <div className="flex flex-1 items-center opacity-60">{body}</div> : <Link to={href} className="flex flex-1 items-center rounded hover:text-primary">{body}</Link>}
                  {staff && (
                    <div className="flex items-center">
                      <Button size="sm" variant="ghost" aria-label={t('common.moveUp', 'Move up')} onClick={() => move(m.items, ii, -1, `/modules/${m.id}/items/order`)}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={t('common.moveDown', 'Move down')} onClick={() => move(m.items, ii, 1, `/modules/${m.id}/items/order`)}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={it.published ? t('lms.hide', 'Hide') : t('lms.show', 'Show')} onClick={() => run(() => api.patch(`/content-items/${it.id}`, { published: !it.published }))}>
                        {it.published ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => window.confirm(t('lms.deleteItem', 'Delete this item?')) && run(() => api.delete(`/content-items/${it.id}`))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
            {!m.items.length && <li className="px-4 py-4 text-sm text-fg-muted">{t('lms.emptyModule', 'Nothing in this module yet')}</li>}
          </ul>
          {staff && (
            <div className="border-t border-border px-4 py-2">
              <Button size="sm" variant="outline" onClick={() => setAdding(m.id)}>
                <Plus className="size-4" /> {t('lms.addContent', 'Add content')}
              </Button>
            </div>
          )}
        </Card>
      ))}
      {staff && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newModule.trim()) addModule.mutate();
          }}
        >
          <Input className="max-w-sm" placeholder={t('lms.newModule', 'New module, e.g. Week 1')} value={newModule} onChange={(e) => setNewModule(e.target.value)} aria-label={t('lms.newModule', 'New module')} />
          <Button type="submit" loading={addModule.isPending}>
            <Plus className="size-4" /> {t('lms.addModule', 'Add module')}
          </Button>
        </form>
      )}
      {adding && <AddItemDialog courseId={home.course.id} moduleId={adding} onClose={() => setAdding(null)} onDone={refresh} />}
    </div>
  );
}

/** Drip release: open on a date, or after another module (optionally with a minimum score). */
function ModuleRules({ m, modules, onSave }: { m: Module; modules: Module[]; onSave: (p: Partial<Module>) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [unlock, setUnlock] = useState(m.unlock_at ? m.unlock_at.slice(0, 16) : '');
  const [pre, setPre] = useState(m.prerequisite_module_id ? String(m.prerequisite_module_id) : '');
  const [mastery, setMastery] = useState(m.mastery_percent ? String(Number(m.mastery_percent)) : '');
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Lock className="size-4" /> {t('lms.releaseAction', 'Release')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('lms.releaseRules', 'When students can open “{{title}}”', { title: m.title })}>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ unlock_at: unlock ? new Date(unlock).toISOString() : null, prerequisite_module_id: pre ? Number(pre) : null, mastery_percent: pre && mastery ? mastery : null });
            setOpen(false);
          }}
        >
          <Field label={t('lms.opensAt', 'Opens on')} optional>
            {(a) => <Input {...a} type="datetime-local" value={unlock} onChange={(e) => setUnlock(e.target.value)} />}
          </Field>
          <Field label={t('lms.prerequisite', 'Only after finishing')} optional>
            {(a) => (
              <Select {...a} value={pre} onChange={(e) => setPre(e.target.value)}>
                <option value="">{t('common.none', '—')}</option>
                {modules.filter((x) => x.id !== m.id).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {pre && (
            <Field label={t('lms.mastery', 'With at least this score in it (%)')} optional hint={t('lms.masteryHint', 'From released grades of the graded work in that module.')}>
              {(a) => <Input {...a} type="number" min={0} max={100} value={mastery} onChange={(e) => setMastery(e.target.value)} />}
            </Field>
          )}
          <div className="flex justify-end">
            <Button type="submit">{t('common.save', 'Save')}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

const KINDS: { kind: Item['kind'] | 'new_assessment'; label: string; icon: typeof FileText }[] = [
  { kind: 'page', label: 'Page', icon: FileText },
  { kind: 'file', label: 'File', icon: Package },
  { kind: 'video', label: 'Video', icon: Video },
  { kind: 'link', label: 'Link', icon: Link2 },
  { kind: 'new_assessment', label: 'Assignment or quiz', icon: ClipboardList },
  { kind: 'scorm', label: 'SCORM package', icon: Package },
];

function AddItemDialog({ courseId, moduleId, onClose, onDone }: { courseId: number; moduleId: number; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const [kind, setKind] = useState<(typeof KINDS)[number]['kind']>('page');
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [completion, setCompletion] = useState<'view' | 'mark_done'>('view');
  const save = useMutation({
    mutationFn: async () => {
      if (kind === 'new_assessment') return navigate(`work/new?module=${moduleId}`);
      if (kind === 'scorm') {
        if (!file) throw new Error(t('lms.chooseFile', 'Choose a file'));
        return api.upload('POST', `/courses/${courseId}/scorm?module_id=${moduleId}`, file);
      }
      let file_id: number | null = null;
      if (kind === 'file') {
        if (!file) throw new Error(t('lms.chooseFile', 'Choose a file'));
        file_id = (await api.upload<{ id: number }>('POST', '/files?purpose=course', file)).id;
      }
      return api.post('/content-items', { module_id: moduleId, kind, title: title || file?.name || 'Untitled', body_html: html, url, file_id, completion });
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (e) => toast('error', e instanceof Error && !(e as { status?: number }).status ? e.message : errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={t('lms.addContent', 'Add content')} className="max-w-2xl">
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div role="radiogroup" aria-label={t('lms.kindOf', 'Kind')} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              onClick={() => setKind(k.kind)}
              className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', kind === k.kind ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2')}
            >
              <k.icon className="size-4" aria-hidden /> {t(`lms.add.${k.kind}`, k.label)}
            </button>
          ))}
        </div>
        {kind !== 'new_assessment' && kind !== 'scorm' && (
          <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} required={kind !== 'file'} />}</Field>
        )}
        {kind === 'page' && <RichEditor label={t('lms.pageBody', 'Page')} value={html} onChange={setHtml} minHeight="min-h-56" />}
        {(kind === 'link' || kind === 'video') && (
          <Field label={kind === 'video' ? t('lms.videoUrl', 'YouTube, Vimeo, Loom or Google Drive link') : t('lms.url', 'Web address')}>
            {(a) => <Input {...a} type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" dir="ltr" />}
          </Field>
        )}
        {(kind === 'file' || kind === 'scorm') && (
          <Field label={kind === 'scorm' ? t('lms.scormZip', 'SCORM 1.2 / 2004 package (.zip)') : t('lms.file', 'File (PDF, slides, documents, audio, video)')}>
            {(a) => <Input {...a} type="file" accept={kind === 'scorm' ? '.zip' : undefined} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
        )}
        {(kind === 'page' || kind === 'file' || kind === 'video' || kind === 'link') && (
          <Field label={t('lms.completionLabel', 'Counts as done when the student')}>
            {(a) => (
              <Select {...a} value={completion} onChange={(e) => setCompletion(e.target.value as 'view')}>
                <option value="view">{t('lms.completion.view', 'opens it')}</option>
                <option value="mark_done">{t('lms.completion.mark_done', 'marks it done')}</option>
              </Select>
            )}
          </Field>
        )}
        {kind === 'new_assessment' && <p className="text-sm text-fg-muted">{t('lms.newWorkHelp', 'You’ll set up the assignment or quiz on the next screen; it is added to this module.')}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" loading={save.isPending}>
            {kind === 'new_assessment' ? t('common.continue', 'Continue') : t('common.add', 'Add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

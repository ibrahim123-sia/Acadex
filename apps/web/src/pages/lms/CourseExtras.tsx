// Course tabs beyond content and work: live classes, everyone's progress, and the course
// settings (certificate, content import, starter templates, groups, polls).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Award, FileUp, LayoutTemplate, MonitorPlay, Plus, Users, Vote } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { CourseHome, CourseRole } from '@/lib/lms';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Input, Select, Spinner, Textarea, useToast } from '@/components/ui';

// ---------------------------------------------------------------- live classes

interface Live {
  id: number;
  title: string;
  provider: string;
  starts_at: string;
  duration_minutes: number;
  recording_url: string;
  joined: number;
  join_url?: string;
  host_url?: string;
}

export function LiveTab({ courseId, role, canEdit }: { courseId: number; role: CourseRole; canEdit: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['live', courseId], queryFn: () => api.get<Live[]>(`/courses/${courseId}/live`) });
  const [f, setF] = useState({ title: '', provider: 'jitsi', join_url: '', starts_at: '', duration_minutes: '45' });
  const add = useMutation({
    mutationFn: () => api.post(`/courses/${courseId}/live`, { ...f, starts_at: new Date(f.starts_at).toISOString(), duration_minutes: Number(f.duration_minutes) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['live', courseId] });
      setF((x) => ({ ...x, title: '', join_url: '' }));
      toast('success', t('lms.liveScheduled', 'Scheduled; students were told'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const join = useMutation({
    mutationFn: (id: number) => api.post<{ join_url: string }>(`/live/${id}/join`, {}),
    onSuccess: (r) => window.open(r.join_url, '_blank', 'noopener'),
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      {role === 'staff' && canEdit && (
        <Card className="p-4">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Field label={t('common.title', 'Title')} className="lg:col-span-2">{(a) => <Input {...a} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
            <Field label={t('lms.provider', 'Tool')}>
              {(a) => (
                <Select {...a} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>
                  <option value="jitsi">Jitsi ({t('lms.jitsiAuto', 'room made for you')})</option>
                  <option value="zoom">Zoom</option>
                  <option value="meet">Google Meet</option>
                  <option value="teams">Microsoft Teams</option>
                </Select>
              )}
            </Field>
            <Field label={t('lms.startsAt', 'Starts')}>{(a) => <Input {...a} type="datetime-local" required value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />}</Field>
            <Field label={t('lms.minutes', 'Minutes')}>{(a) => <Input {...a} type="number" min={5} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: e.target.value })} />}</Field>
            {f.provider !== 'jitsi' && (
              <Field label={t('lms.meetingLink', 'Meeting link')} optional hint={t('lms.meetingAuto', 'Leave empty when your institution has connected this tool — Acadex creates the meeting.')} className="sm:col-span-2 lg:col-span-4">
                {(a) => <Input {...a} type="url" dir="ltr" value={f.join_url} onChange={(e) => setF({ ...f, join_url: e.target.value })} />}
              </Field>
            )}
            <div className="flex items-end">
              <Button type="submit" loading={add.isPending}>
                <Plus className="size-4" /> {t('lms.schedule', 'Schedule')}
              </Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-fg-muted">{t('lms.liveAttendance', 'Students who join through Acadex are marked present (late after 10 minutes).')}</p>
        </Card>
      )}
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        rowKey={(r) => r.id}
        empty={t('lms.noLive', 'No live classes scheduled')}
        columns={[
          { key: 't', header: t('common.title', 'Title'), cell: (r) => <span className="font-medium">{r.title}</span> },
          { key: 's', header: t('lms.startsAt', 'Starts'), cell: (r) => `${formatDateTime(r.starts_at)} · ${r.duration_minutes}′` },
          { key: 'p', header: t('lms.provider', 'Tool'), cell: (r) => (r.host_url ? <a href={r.host_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{r.provider} · {t('lms.startAsHost', 'start as host')}</a> : r.provider), hideOnMobile: true },
          { key: 'j', header: t('lms.joined', 'Joined'), cell: (r) => r.joined, hideOnMobile: true },
          {
            key: 'a',
            header: '',
            cell: (r) =>
              r.recording_url ? (
                <a href={r.recording_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{t('lms.recording', 'Recording')}</a>
              ) : role !== 'guardian' && new Date(r.starts_at).getTime() + r.duration_minutes * 60000 > Date.now() - 30 * 60000 ? (
                <Button size="sm" onClick={() => join.mutate(r.id)} loading={join.isPending}>
                  <MonitorPlay className="size-4" /> {t('lms.join', 'Join')}
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------- progress

export function ProgressTab({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['progress', courseId], queryFn: () => api.get<{ student_id: number; name: string; roll_no: string | null; done: number; total: number; percent: number; last_active: string | null }[]>(`/courses/${courseId}/progress`) });
  return (
    <DataTable
      rows={q.data}
      loading={q.isPending}
      error={q.error}
      rowKey={(r) => r.student_id}
      empty={t('lms.noStudents', 'No students in this course')}
      columns={[
        { key: 'n', header: t('common.student', 'Student'), cell: (r) => <span className="font-medium">{r.name}</span> },
        {
          key: 'p',
          header: t('lms.progress', 'Progress'),
          cell: (r) => (
            <div className="flex items-center gap-2">
              <div className="h-2 w-24 rounded-full bg-surface-2">
                <div className="h-2 rounded-full bg-primary" style={{ width: `${r.percent}%` }} />
              </div>
              <span className="tabular-nums text-xs">{r.percent}%</span>
            </div>
          ),
        },
        { key: 'l', header: t('lms.lastActive', 'Last active'), cell: (r) => (r.last_active ? formatRelative(r.last_active) : '—'), hideOnMobile: true },
      ]}
    />
  );
}

// ---------------------------------------------------------------- settings

export function CourseSettingsTab({ home }: { home: CourseHome }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CertificateCard courseId={home.course.id} />
      <ImportCard courseId={home.course.id} />
      <GroupsCard courseId={home.course.id} />
      <PollCard courseId={home.course.id} />
    </div>
  );
}

function CertificateCard({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cert-template', courseId], queryFn: () => api.get<{ template: { title: string; body: string; auto_issue: boolean; min_progress_percent: number; min_grade_percent: string | null } | null; issued: { id: number; student: string; issued_at: string; verify_code: string }[] }>(`/courses/${courseId}/certificate-template`) });
  const [f, setF] = useState<{ title: string; body: string; min_progress_percent: string; min_grade_percent: string } | null>(null);
  const v = f ?? {
    title: q.data?.template?.title ?? '{{course}} — certificate of completion',
    body: q.data?.template?.body ?? 'This certifies that {{student}} completed {{course}} at {{institution}} on {{date}}.',
    min_progress_percent: String(q.data?.template?.min_progress_percent ?? 100),
    min_grade_percent: q.data?.template?.min_grade_percent == null ? '' : String(Number(q.data.template.min_grade_percent)),
  };
  const save = useMutation({
    mutationFn: () => api.put(`/courses/${courseId}/certificate-template`, { title: v.title, body: v.body, auto_issue: true, min_progress_percent: Number(v.min_progress_percent), min_grade_percent: v.min_grade_percent === '' ? null : Number(v.min_grade_percent) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cert-template', courseId] });
      toast('success', t('common.saved', 'Saved'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const issue = useMutation({
    mutationFn: () => api.post<{ issued: number }>(`/courses/${courseId}/certificates/issue`, {}),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['cert-template', courseId] });
      toast('success', t('lms.issuedN', '{{n}} certificate(s) issued', { n: r.issued }));
    },
  });
  if (q.isPending) return <Card className="p-4"><Spinner /></Card>;
  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Award className="size-4" aria-hidden /> {t('lms.certificate', 'Certificate of completion')}</h2>
      <Field label={t('common.title', 'Title')}>{(a) => <Input {...a} value={v.title} onChange={(e) => setF({ ...v, title: e.target.value })} />}</Field>
      <Field label={t('lms.certText', 'Text')} hint="{{student}} {{course}} {{institution}} {{date}} {{grade}}">{(a) => <Textarea {...a} value={v.body} onChange={(e) => setF({ ...v, body: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('lms.minProgress', 'Progress needed (%)')}>{(a) => <Input {...a} type="number" min={0} max={100} value={v.min_progress_percent} onChange={(e) => setF({ ...v, min_progress_percent: e.target.value })} />}</Field>
        <Field label={t('lms.minGrade', 'Grade needed (%)')} optional>{(a) => <Input {...a} type="number" min={0} max={100} value={v.min_grade_percent} onChange={(e) => setF({ ...v, min_grade_percent: e.target.value })} />}</Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} loading={save.isPending}>{t('common.save', 'Save')}</Button>
        {q.data?.template && <Button variant="outline" onClick={() => issue.mutate()} loading={issue.isPending}>{t('lms.issueNow', 'Issue to everyone who qualifies')}</Button>}
      </div>
      {!!q.data?.issued.length && <p className="text-xs text-fg-muted">{t('lms.issuedSoFar', '{{n}} issued so far; each has a verification code.', { n: q.data.issued.length })}</p>}
    </Card>
  );
}

function ImportCard({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [format, setFormat] = useState('imscc');
  const [file, setFile] = useState<File | null>(null);
  const templates = useQuery({ queryKey: ['course-templates'], queryFn: () => api.get<{ key: string; title: string; description: string; modules: number }[]>('/course-templates') });
  const done = (r: { modules: number; pages: number; assessments: number; questions: number; skipped: string[] }) => {
    void qc.invalidateQueries({ queryKey: ['course', courseId] });
    toast('success', t('lms.importDone', 'Imported: {{m}} modules, {{p}} pages, {{a}} assessments, {{q}} questions (hidden until you publish them)', { m: r.modules, p: r.pages, a: r.assessments, q: r.questions }));
  };
  const imp = useMutation({
    mutationFn: () => api.upload<{ modules: number; pages: number; assessments: number; questions: number; skipped: string[] }>('POST', `/courses/${courseId}/import?format=${format}`, file!),
    onSuccess: done,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: (key: string) => api.post<{ modules: number; pages: number; assessments: number; questions: number; skipped: string[] }>(`/courses/${courseId}/apply-template`, { key }),
    onSuccess: done,
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><FileUp className="size-4" aria-hidden /> {t('lms.import', 'Bring content in')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('lms.importFrom', 'From')}>
          {(a) => (
            <Select {...a} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="imscc">Common Cartridge (.imscc — Canvas, Blackboard, Schoology)</option>
              <option value="mbz">Moodle backup (.mbz)</option>
              <option value="qti">QTI questions (.xml / .zip)</option>
            </Select>
          )}
        </Field>
        <Field label={t('lms.file', 'File')}>{(a) => <Input {...a} type="file" accept=".imscc,.zip,.mbz,.xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
      </div>
      <Button onClick={() => imp.mutate()} disabled={!file} loading={imp.isPending}>{t('lms.importNow', 'Import')}</Button>
      <div className="border-t border-border pt-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><LayoutTemplate className="size-4" aria-hidden /> {t('lms.templates', 'Start from a template')}</h3>
        <ul className="space-y-2">
          {templates.data?.map((tp) => (
            <li key={tp.key} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">{tp.title}</span>
                <span className="block text-xs text-fg-muted">{tp.description}</span>
              </span>
              <Button size="sm" variant="outline" onClick={() => apply.mutate(tp.key)}>{t('common.add', 'Add')}</Button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function GroupsCard({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['group-sets', courseId], queryFn: () => api.get<{ id: number; name: string; self_signup: boolean; groups: { id: number; name: string; members: { student_id: number; name: string }[] }[] }[]>(`/courses/${courseId}/group-sets`) });
  const [name, setName] = useState('');
  const [size, setSize] = useState('3');
  const add = useMutation({
    mutationFn: () => api.post(`/courses/${courseId}/group-sets`, { name, auto_size: Number(size) || undefined }),
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: ['group-sets', courseId] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Users className="size-4" aria-hidden /> {t('lms.groups', 'Groups')}</h2>
      {q.data?.map((s) => (
        <details key={s.id} className="rounded-lg border border-border p-2 text-sm">
          <summary className="cursor-pointer font-medium">{s.name} <Badge>{s.groups.length}</Badge></summary>
          <ul className="mt-2 space-y-1">
            {s.groups.map((g) => (
              <li key={g.id}>
                <span className="font-medium">{g.name}:</span> {g.members.map((m) => m.name).join(', ') || '—'}
              </li>
            ))}
          </ul>
        </details>
      ))}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Field label={t('lms.groupSetName', 'New set of groups')}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('lms.groupEg', 'e.g. Project teams')} />}</Field>
        <Field label={t('lms.perGroup', 'Students per group')}>{(a) => <Input {...a} className="w-24" type="number" min={1} value={size} onChange={(e) => setSize(e.target.value)} />}</Field>
        <Button type="submit" variant="outline" loading={add.isPending}>{t('lms.makeGroups', 'Make groups')}</Button>
      </form>
    </Card>
  );
}

function PollCard({ courseId }: { courseId: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const polls = useQuery({ queryKey: ['polls', courseId], queryFn: () => api.get<{ id: number; question: string; options: string[]; votes: number }[]>(`/courses/${courseId}/polls`) });
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/polls', { offering_id: courseId, question, options: options.split('\n').map((o) => o.trim()).filter(Boolean) }),
    onSuccess: () => {
      setQuestion('');
      setOptions('');
      void qc.invalidateQueries({ queryKey: ['polls', courseId] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Card className="space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Vote className="size-4" aria-hidden /> {t('lms.polls', 'Quick polls')}</h2>
      {polls.data?.length ? (
        <ul className="space-y-1 text-sm">
          {polls.data.map((p) => (
            <li key={p.id}>
              {p.question} <span className="text-xs text-fg-muted">· {t('lms.votesN', '{{n}} votes', { n: p.votes })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t('lms.noPolls', 'No polls yet')} />
      )}
      <Field label={t('lms.pollQuestion', 'Question')}>{(a) => <Input {...a} value={question} onChange={(e) => setQuestion(e.target.value)} />}</Field>
      <Field label={t('lms.pollOptions', 'Answers, one per line')}>{(a) => <Textarea {...a} value={options} onChange={(e) => setOptions(e.target.value)} />}</Field>
      <Button variant="outline" onClick={() => add.mutate()} disabled={!question.trim()} loading={add.isPending}>{t('lms.askPoll', 'Ask the class')}</Button>
      <Alert>{t('lms.pollsWhere', 'Students answer polls on the course Discussions tab.')}</Alert>
    </Card>
  );
}

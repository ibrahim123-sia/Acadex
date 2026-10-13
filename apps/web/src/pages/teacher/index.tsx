import { useEffect, useRef, useState } from 'react';
import { Route, Routes } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { BookOpen, ClipboardList, Plus, Save, Users } from 'lucide-react';
import { ASSESSMENT_TYPES, ATTENDANCE_STATUSES, assignmentBody, type AttendanceStatus } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { formatDate, todayISO } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Pager, Select, Spinner, StatCard, Textarea, useToast } from '@/components/ui';
import { RequireAuth } from '@/components/RequireAuth';
import { AnnouncementList } from '../admin/Office';

interface TeacherClass {
  id: number;
  name: string;
  code: string;
  students: number;
}
const useMyClasses = () => useQuery({ queryKey: ['my-sections'], queryFn: () => api.get<TeacherClass[]>('/me/teacher/sections') });

function TeacherDashboard() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['teacher-overview'],
    queryFn: () =>
      api.get<{ profile: { first_name: string } | null; sections: { id: number; name: string }[]; subjects: { id: number; subject: string; section_name: string }[]; studentCount: number }>(
        '/me/teacher/overview'
      ),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageHeader title={t('teacher.welcome', 'Welcome, {{name}}', { name: d.profile?.first_name ?? '' })} subtitle={t('teacher.subtitle', 'Your teaching at a glance')} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label={t('teacher.myClasses', 'My sections')} value={d.sections.length} icon={BookOpen} />
        <StatCard label={t('teacher.mySubjects', 'My subjects')} value={d.subjects.length} icon={ClipboardList} tone="warning" />
        <StatCard label={t('teacher.myStudents', 'My students')} value={d.studentCount} icon={Users} tone="success" />
      </div>
      <DataTable
        rows={d.subjects}
        rowKey={(r) => r.id}
        empty={t('teacher.noSubjects', 'No subjects assigned yet. Ask your institution administrator.')}
        columns={[
          { key: 'subject', header: t('teacher.subject', 'Subject'), cell: (s) => <span className="font-medium">{s.subject}</span> },
          { key: 'class', header: t('common.class', 'Class'), cell: (s) => s.section_name },
        ]}
      />
    </>
  );
}

const STATUS_STYLE: Record<AttendanceStatus, string> = {
  Present: 'bg-success text-white',
  Absent: 'bg-danger text-white',
  Leave: 'bg-warning text-white',
};
const STATUS_KEY: Record<string, AttendanceStatus> = { p: 'Present', a: 'Absent', l: 'Leave' };

function ClassPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const sections = useMyClasses();
  useEffect(() => {
    if (!value && sections.data?.[0]) onChange(String(sections.data[0].id));
  }, [sections.data, value, onChange]);
  return (
    <Field label={t('common.class', 'Class')}>
      {(a) => (
        <Select {...a} value={value} onChange={(e) => onChange(e.target.value)}>
          {sections.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

interface RosterStudent {
  id: number;
  roll_no: string | null;
  name: string;
  status: AttendanceStatus | null;
}

function TeacherAttendance() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [sectionId, setClassId] = useState('');
  const [date, setDate] = useState(todayISO);
  const [marks, setMarks] = useState<Record<number, AttendanceStatus>>({});
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const roster = useQuery({
    queryKey: ['roster', sectionId, date],
    queryFn: () => api.get<{ date: string; students: RosterStudent[] }>(`/me/teacher/class/${sectionId}/roster`, { date }),
    enabled: !!sectionId,
  });
  useEffect(() => {
    if (roster.data) setMarks(Object.fromEntries(roster.data.students.filter((s) => s.status).map((s) => [s.id, s.status!])));
  }, [roster.data]);
  const save = useMutation({
    mutationFn: () =>
      api.post('/me/teacher/attendance', {
        section_id: Number(sectionId),
        date,
        records: Object.entries(marks).map(([id, status]) => ({ student_id: Number(id), status })),
      }),
    onSuccess: () => {
      toast('success', t('teacher.attendanceSaved', 'Attendance saved'));
      void qc.invalidateQueries({ queryKey: ['roster', sectionId, date] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const students = roster.data?.students ?? [];
  const markedCount = Object.keys(marks).length;
  const set = (id: number, s: AttendanceStatus) => setMarks((m) => ({ ...m, [id]: s }));

  return (
    <>
      <PageHeader title={t('nav.attendance', 'Attendance')} subtitle={t('teacher.attendanceSubtitle', 'Tip: focus a student and press P, A or L')} />
      <Card className="mb-4 grid gap-4 p-4 sm:grid-cols-3 sm:items-end">
        <ClassPicker value={sectionId} onChange={setClassId} />
        <Field label={t('teacher.date', 'Date')}>{(a) => <Input {...a} type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Button variant="outline" disabled={!students.length} onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, 'Present' as const])))}>
          {t('teacher.allPresent', 'Mark everyone present')}
        </Button>
      </Card>
      {roster.isPending && sectionId ? (
        <Spinner />
      ) : roster.isError ? (
        <ErrorState error={roster.error} onRetry={() => roster.refetch()} />
      ) : !students.length ? (
        <Card>
          <EmptyState title={t('teacher.noStudents', 'No students in this class')} />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {students.map((s, i) => (
              <li
                key={s.id}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                tabIndex={0}
                onKeyDown={(e) => {
                  const st = STATUS_KEY[e.key.toLowerCase()];
                  if (st) {
                    set(s.id, st);
                    rows.current[i + 1]?.focus();
                  }
                }}
                className="flex flex-wrap items-center gap-3 px-4 py-3 focus:bg-surface-2 focus:outline-none"
              >
                <span className="w-16 font-mono text-xs text-fg-muted">{s.roll_no ?? '—'}</span>
                <span className="min-w-32 flex-1 font-medium">{s.name}</span>
                <div className="flex gap-1" role="radiogroup" aria-label={s.name}>
                  {ATTENDANCE_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      role="radio"
                      aria-checked={marks[s.id] === st}
                      onClick={() => set(s.id, st)}
                      className={cn('rounded-lg px-3 py-1.5 text-xs font-semibold', marks[s.id] === st ? STATUS_STYLE[st] : 'bg-surface-2 text-fg-muted hover:bg-border')}
                    >
                      {t(`status.${st}`, st)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {students.length > 0 && (
        <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t border-border bg-background py-3">
          <span className="text-sm text-fg-muted">{t('teacher.marked', '{{marked}} of {{total}} marked', { marked: markedCount, total: students.length })}</span>
          <Button loading={save.isPending} disabled={!markedCount} onClick={() => save.mutate()}>
            <Save className="size-4" /> {t('teacher.saveAttendance', 'Save attendance')}
          </Button>
        </div>
      )}
    </>
  );
}

function TeacherGradebook() {
  const { t } = useTranslation();
  const toast = useToast();
  const [sectionId, setClassId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof ASSESSMENT_TYPES)[number]>('Quiz');
  const [total, setTotal] = useState('100');
  const [marks, setMarks] = useState<Record<number, string>>({});
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const roster = useQuery({
    queryKey: ['roster', sectionId, 'grades'],
    queryFn: () => api.get<{ students: RosterStudent[] }>(`/me/teacher/class/${sectionId}/roster`),
    enabled: !!sectionId,
  });
  useEffect(() => setMarks({}), [sectionId]);
  const totalNum = Number(total);
  const invalid = Object.values(marks).some((m) => m !== '' && (Number(m) < 0 || Number(m) > totalNum || Number.isNaN(Number(m))));
  const save = useMutation({
    mutationFn: () =>
      api.post('/me/teacher/grades', {
        section_id: Number(sectionId),
        assignment_type: type,
        assignment_name: name,
        total_marks: totalNum,
        records: Object.entries(marks)
          .filter(([, v]) => v !== '')
          .map(([id, v]) => ({ student_id: Number(id), obtained_marks: Number(v) })),
      }),
    onSuccess: () => {
      toast('success', t('teacher.gradesSaved', 'Grades saved'));
      setMarks({});
      setName('');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const students = roster.data?.students ?? [];
  return (
    <>
      <PageHeader title={t('nav.gradebook', 'Gradebook')} subtitle={t('teacher.gradebookSubtitle', 'Enter marks for an assessment — Enter moves to the next student')} />
      <Card className="mb-4 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <ClassPicker value={sectionId} onChange={setClassId} />
        <Field label={t('teacher.assessment', 'Assessment')}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('teacher.assessmentPh', 'e.g. Algebra quiz 1')} />}</Field>
        <Field label={t('teacher.type', 'Type')}>
          {(a) => (
            <Select {...a} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {ASSESSMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`assessment.${x}`, x)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('teacher.totalMarks', 'Total marks')}>{(a) => <Input {...a} type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} />}</Field>
      </Card>
      {roster.isPending && sectionId ? (
        <Spinner />
      ) : roster.isError ? (
        <ErrorState error={roster.error} onRetry={() => roster.refetch()} />
      ) : !students.length ? (
        <Card>
          <EmptyState title={t('teacher.noStudents', 'No students in this class')} />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {students.map((s, i) => {
              const v = marks[s.id] ?? '';
              const bad = v !== '' && (Number(v) < 0 || Number(v) > totalNum || Number.isNaN(Number(v)));
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-16 font-mono text-xs text-fg-muted">{s.roll_no ?? '—'}</span>
                  <label htmlFor={`m-${s.id}`} className="flex-1 font-medium">
                    {s.name}
                  </label>
                  <Input
                    id={`m-${s.id}`}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={totalNum}
                    step="any"
                    value={v}
                    aria-invalid={bad || undefined}
                    onChange={(e) => setMarks((m) => ({ ...m, [s.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        inputs.current[i + 1]?.focus();
                      }
                    }}
                    className="w-24"
                    placeholder={`/ ${total}`}
                  />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {invalid && (
        <Alert tone="danger" className="mt-3">
          {t('teacher.marksRange', 'Marks must be between 0 and {{total}}', { total })}
        </Alert>
      )}
      {students.length > 0 && (
        <div className="sticky bottom-0 mt-4 flex justify-end border-t border-border bg-background py-3">
          <Button loading={save.isPending} disabled={!name.trim() || invalid || !Object.values(marks).some((m) => m !== '')} onClick={() => save.mutate()}>
            <Save className="size-4" /> {t('teacher.saveGrades', 'Save grades')}
          </Button>
        </div>
      )}
    </>
  );
}

interface AssignmentRow {
  id: number;
  title: string;
  description: string;
  due_date: string | null;
  section_name: string;
  subject: string | null;
  submissions: number;
}

function TeacherAssignments() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const sections = useMyClasses();
  const list = usePagedList<AssignmentRow>('/me/teacher/assignments');
  const form = useForm<z.input<typeof assignmentBody>>({ resolver: zodResolver(assignmentBody), defaultValues: { section_id: '' as unknown as number, title: '', description: '', due_date: '' } });
  const m = useMutation({
    mutationFn: (v: z.input<typeof assignmentBody>) => api.post('/me/teacher/assignments', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/me/teacher/assignments'] });
      form.reset();
      setOpen(false);
    },
  });
  const e = form.formState.errors;
  return (
    <>
      <PageHeader
        title={t('nav.assignments', 'Assignments')}
        subtitle={t('teacher.assignmentsSubtitle', 'Set work for a whole class at once')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> {t('teacher.newAssignment', 'New assignment')}
          </Button>
        }
      />
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('teacher.noAssignments', 'No assignments yet')}
        columns={[
          { key: 'title', header: t('admin.title', 'Title'), cell: (a) => <span className="font-medium">{a.title}</span> },
          { key: 'class', header: t('common.class', 'Class'), cell: (a) => a.section_name, hideOnMobile: true },
          { key: 'due', header: t('teacher.due', 'Due'), cell: (a) => formatDate(a.due_date) },
          { key: 'subs', header: t('teacher.submissions', 'Submissions'), cell: (a) => <Badge>{a.submissions}</Badge> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('teacher.newAssignment', 'New assignment')}>
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <Field label={t('common.class', 'Class')} error={e.section_id ? t('teacher.chooseClass', 'Choose a class') : undefined}>
            {(a) => (
              <Select {...a} {...form.register('section_id')}>
                <option value="">{t('teacher.chooseClass', 'Choose a class')}…</option>
                {sections.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({t('teacher.studentsCount', '{{count}} students', { count: c.students })})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('admin.title', 'Title')} error={e.title?.message}>
            {(a) => <Input {...a} {...form.register('title')} />}
          </Field>
          <Field label={t('teacher.instructions', 'Instructions')} optional>
            {(a) => <Textarea {...a} rows={4} {...form.register('description')} />}
          </Field>
          <Field label={t('teacher.due', 'Due')} optional>
            {(a) => <Input {...a} type="date" {...form.register('due_date')} />}
          </Field>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('teacher.assign', 'Assign to class')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function TeacherAnnouncements() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.announcements', 'Announcements')} subtitle={t('teacher.announcementsSubtitle', 'Notices for staff')} />
      <AnnouncementList path="/me/announcements" />
    </>
  );
}

export default function TeacherRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="teaching.access"><TeacherDashboard /></RequireAuth>} />
      <Route path="attendance" element={<RequireAuth permission="attendance.mark"><TeacherAttendance /></RequireAuth>} />
      <Route path="gradebook" element={<RequireAuth permission="grades.enter"><TeacherGradebook /></RequireAuth>} />
      <Route path="assignments" element={<RequireAuth permission="assignments.manage"><TeacherAssignments /></RequireAuth>} />
      <Route path="announcements" element={<RequireAuth permission="teaching.access"><TeacherAnnouncements /></RequireAuth>} />
    </Routes>
  );
}

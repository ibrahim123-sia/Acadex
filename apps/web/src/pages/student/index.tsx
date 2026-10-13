import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, FileText, TrendingUp, Upload, Wallet } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, DataTable, Dialog, ErrorState, Field, Input, PageHeader, Pager, Spinner, StatCard, StatusBadge, useToast } from '@/components/ui';
import { RequireAuth } from '@/components/RequireAuth';
import { AnnouncementList } from '../admin/Office';

export interface Overview {
  profile: { id: number; first_name: string; last_name: string; roll_no: string | null; class_name: string | null } | null;
  grades: { subject: string | null; assignment_type: string; assignment_name: string; obtained_marks: string; total_marks: string; percentage: string | null }[];
  attendance: { status: string; c: number }[];
  fee: { total_fee: string; paid_amount: string; remaining_balance: string; payment_status: string } | null;
}

/** Summary cards + grades for one learner (used by students and parents). */
export function LearnerSummary({ data, onReportCard }: { data: Overview; onReportCard: () => void }) {
  const { t } = useTranslation();
  const total = data.attendance.reduce((a, x) => a + x.c, 0);
  const present = data.attendance.find((x) => x.status === 'Present')?.c ?? 0;
  const attendancePct = total ? Math.round((present / total) * 100) : null;
  const avg = data.grades.length ? Math.round(data.grades.reduce((a, g) => a + Number(g.percentage ?? 0), 0) / data.grades.length) : null;
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label={t('student.average', 'Average score')} value={avg == null ? '—' : `${avg}%`} icon={TrendingUp} />
        <StatCard
          label={t('nav.attendance', 'Attendance')}
          value={attendancePct == null ? '—' : `${attendancePct}%`}
          sub={total ? t('student.daysPresent', '{{present}} of {{total}} days present', { present, total }) : undefined}
          icon={CalendarCheck}
          tone={attendancePct != null && attendancePct < 75 ? 'danger' : 'success'}
        />
        <StatCard
          label={t('nav.fees', 'Fees')}
          value={data.fee ? t(`status.${data.fee.payment_status}`, data.fee.payment_status) : '—'}
          sub={data.fee ? t('student.due', '{{amount}} due', { amount: formatMoney(data.fee.remaining_balance) }) : undefined}
          icon={Wallet}
          tone="warning"
        />
      </div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">{t('student.grades', 'Grades')}</h2>
        <Button variant="outline" size="sm" onClick={onReportCard}>
          <FileText className="size-4" /> {t('admin.reportCard', 'Report card')}
        </Button>
      </div>
      <DataTable
        rows={data.grades}
        rowKey={(_g, i) => i}
        empty={t('student.noGrades', 'No grades yet')}
        columns={[
          { key: 'subject', header: t('teacher.subject', 'Subject'), cell: (g) => <span className="font-medium">{g.subject ?? '—'}</span> },
          { key: 'name', header: t('teacher.assessment', 'Assessment'), cell: (g) => g.assignment_name, hideOnMobile: true },
          { key: 'marks', header: t('student.marks', 'Marks'), cell: (g) => `${Number(g.obtained_marks)}/${Number(g.total_marks)}` },
          { key: 'pct', header: '%', cell: (g) => <Badge tone={Number(g.percentage) >= 50 ? 'success' : 'danger'}>{g.percentage}%</Badge> },
        ]}
      />
    </>
  );
}

function StudentDashboard() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['student-overview'], queryFn: () => api.get<Overview>('/me/student/overview') });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data.profile;
  return (
    <>
      <PageHeader title={t('student.welcome', 'Hi, {{name}}', { name: p?.first_name ?? '' })} subtitle={p?.class_name ?? undefined} />
      <LearnerSummary
        data={q.data}
        onReportCard={() => p && api.download(`/pdf/report-card/${p.id}`, `report-card-${p.roll_no || p.id}.pdf`).catch((e) => toast('error', errorMessage(e)))}
      />
      <h2 className="mb-3 mt-8 font-semibold">{t('nav.announcements', 'Announcements')}</h2>
      <AnnouncementList path="/me/announcements" />
    </>
  );
}

interface StudentAssignment {
  id: number;
  title: string;
  description: string;
  due_date: string | null;
  subject: string | null;
  submitted: number;
}

function StudentAssignments() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const list = usePagedList<StudentAssignment>('/me/student/assignments');
  const [active, setActive] = useState<StudentAssignment | null>(null);
  const [link, setLink] = useState('');
  const submit = useMutation({
    mutationFn: () => api.post('/me/student/submissions', { assignment_id: active!.id, title: active!.title, file_link: link }),
    onSuccess: () => {
      toast('success', t('student.submitted', 'Submitted'));
      setActive(null);
      setLink('');
      void qc.invalidateQueries({ queryKey: ['/me/student/assignments'] });
    },
  });
  return (
    <>
      <PageHeader title={t('nav.assignments', 'Assignments')} subtitle={t('student.assignmentsSubtitle', 'Your work and what you have handed in')} />
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('student.noAssignments', 'No assignments yet')}
        columns={[
          {
            key: 'title',
            header: t('admin.title', 'Title'),
            cell: (a) => (
              <div>
                <div className="font-medium">{a.title}</div>
                {a.description && <div className="line-clamp-2 text-xs text-fg-muted">{a.description}</div>}
              </div>
            ),
          },
          { key: 'subject', header: t('teacher.subject', 'Subject'), cell: (a) => a.subject ?? '—', hideOnMobile: true },
          { key: 'due', header: t('teacher.due', 'Due'), cell: (a) => formatDate(a.due_date) },
          {
            key: 'status',
            header: t('common.status', 'Status'),
            cell: (a) => (a.submitted ? <StatusBadge value="Paid" label={t('student.handedIn', 'Handed in')} /> : <StatusBadge value="Pending" label={t('student.todo', 'To do')} />),
          },
          {
            key: 'act',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (a) =>
              !a.submitted && (
                <Button variant="ghost" size="sm" onClick={() => setActive(a)}>
                  <Upload className="size-4" /> {t('student.submit', 'Submit')}
                </Button>
              ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <Dialog open={!!active} onClose={() => (setActive(null), submit.reset())} title={t('student.submitTitle', 'Submit: {{title}}', { title: active?.title ?? '' })}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <Field label={t('student.link', 'Link to your work')} hint={t('student.linkHint', 'A Google Drive, OneDrive or other https:// link')}>
            {(a) => <Input {...a} type="url" dir="ltr" required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" />}
          </Field>
          {submit.isError && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={submit.isPending}>
              <Upload className="size-4" /> {t('student.submit', 'Submit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export default function StudentRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="learner.access"><StudentDashboard /></RequireAuth>} />
      <Route path="assignments" element={<RequireAuth permission="learner.access"><StudentAssignments /></RequireAuth>} />
    </Routes>
  );
}

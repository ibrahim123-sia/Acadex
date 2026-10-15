import { Navigate, Route, Routes } from 'react-router';
import { StudentHome } from '../lms/Dashboards';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, FileText, TrendingUp, Wallet } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Badge, Button, DataTable, ErrorState, PageHeader, Spinner, StatCard, useToast } from '@/components/ui';
import { RequireAuth } from '@/components/RequireAuth';

export interface Overview {
  profile: { id: number; first_name: string; last_name: string; roll_no: string | null; section_name: string | null } | null;
  grades: { subject: string | null; assignment_type: string; assignment_name: string; obtained_marks: string; total_marks: string; percentage: string | null }[];
  attendance: { status: string; c: number }[];
  fee: { total_fee: string; paid_amount: string; remaining_balance: string; payment_status: string } | null;
}

/** Summary cards + grades for one learner (used by students and parents). */
export function LearnerSummary({ data, onReportCard }: { data: Overview; onReportCard: () => void }) {
  const { t } = useTranslation();
  const count = (st: string) => data.attendance.find((x) => x.status === st)?.c ?? 0;
  const present = count('Present') + count('Late');
  const total = present + count('Absent');
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
      <PageHeader title={t('student.welcome', 'Hi, {{name}}', { name: p?.first_name ?? '' })} subtitle={p?.section_name ?? undefined} />
      <LearnerSummary
        data={q.data}
        onReportCard={() => p && api.download(`/pdf/report-card/${p.id}`, `report-card-${p.roll_no || p.id}.pdf`).catch((e) => toast('error', errorMessage(e)))}
      />
    </>
  );
}


export default function StudentRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="learner.access"><StudentHome /></RequireAuth>} />
      <Route path="overview" element={<RequireAuth permission="learner.access"><StudentDashboard /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/learn" replace />} />
    </Routes>
  );
}

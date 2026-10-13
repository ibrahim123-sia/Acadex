import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookOpen, GraduationCap, Users, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';

interface DashboardData {
  students: number;
  teachers: number;
  classes: number;
  feeCollected: number;
  feeOutstanding: number;
  feeStatus: { payment_status: string; c: number }[];
  classDistribution: { name: string; students: number }[];
  recentStudents: { id: number; first_name: string; last_name: string; roll_no: string | null }[];
}

const PIE: Record<string, string> = { Paid: 'var(--success)', Partial: 'var(--warning)', Pending: 'var(--danger)' };
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--fg)' };

export function AdminDashboard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['school-dashboard'], queryFn: () => api.get<DashboardData>('/school/dashboard') });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const feePie = d.feeStatus.map((f) => ({ name: t(`status.${f.payment_status}`, f.payment_status), key: f.payment_status, value: f.c }));
  return (
    <>
      <PageHeader title={t('nav.dashboard', 'Dashboard')} subtitle={t('admin.dashboardSubtitle', 'Your school at a glance')} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('nav.students', 'Students')} value={d.students} icon={Users} />
        <StatCard label={t('nav.teachers', 'Teachers')} value={d.teachers} icon={GraduationCap} tone="warning" />
        <StatCard label={t('nav.classes', 'Classes')} value={d.classes} icon={BookOpen} tone="success" />
        <StatCard
          label={t('admin.feesCollected', 'Fees collected')}
          value={formatMoney(d.feeCollected)}
          sub={t('admin.outstanding', '{{amount}} outstanding', { amount: formatMoney(d.feeOutstanding) })}
          icon={Wallet}
          tone="danger"
        />
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">{t('admin.feeStatus', 'Fee status')}</h2>
          {feePie.length ? (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie data={feePie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {feePie.map((e) => (
                      <Cell key={e.key} fill={PIE[e.key] ?? 'var(--fg-muted)'} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title={t('admin.noFees', 'No fee records yet')} />
          )}
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">{t('admin.studentsByClass', 'Students by class')}</h2>
          {d.classDistribution.length ? (
            <div dir="ltr">
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={d.classDistribution}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--fg-muted)' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--fg-muted)' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="students" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title={t('admin.noClasses', 'No classes yet')} />
          )}
        </Card>
      </div>
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">{t('admin.recentAdmissions', 'Recent admissions')}</h2>
        {d.recentStudents.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.recentStudents.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="grid size-9 place-items-center rounded-full bg-primary-soft font-semibold text-primary">{s.first_name[0]}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {s.first_name} {s.last_name}
                  </div>
                  <div className="text-xs text-fg-muted">{s.roll_no}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t('admin.noStudents', 'No students yet')} />
        )}
      </Card>
    </>
  );
}

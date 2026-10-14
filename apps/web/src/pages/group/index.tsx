// The group administrator's portal: every institution of the group side by side.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2, GraduationCap, Users, Wallet } from 'lucide-react';
import { Route, Routes } from 'react-router';
import { RequireAuth } from '@/components/RequireAuth';
import { api } from '@/lib/api';
import { Badge, Card, DataTable, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';

interface Overview {
  groups: { id: number; name: string }[];
  institutions: {
    id: number;
    name: string;
    type: string;
    status: string;
    plan: string;
    currency: string;
    campuses: number;
    students: number;
    staff: number;
    sections: number;
    fee_collected: number;
    fee_outstanding: number;
    attendance_rate: string | null;
  }[];
}

const money = (n: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

function GroupOverview() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['group-overview'], queryFn: () => api.get<Overview>('/group/overview') });
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const all = q.data.institutions;
  const sum = (k: 'students' | 'staff' | 'campuses') => all.reduce((x, i) => x + i[k], 0);
  // money only adds up within one currency
  const currencies = [...new Set(all.map((i) => i.currency))];
  return (
    <>
      <PageHeader title={q.data.groups.map((g) => g.name).join(', ')} subtitle={t('group.subtitle', '{{n}} institutions', { n: all.length })} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('group.institutions', 'Institutions')} value={all.length} icon={Building2} />
        <StatCard label={t('group.campuses', 'Campuses')} value={sum('campuses')} icon={Building2} tone="success" />
        <StatCard label={t('nav.students', 'Students')} value={sum('students')} icon={Users} />
        <StatCard label={t('nav.staff', 'Staff')} value={sum('staff')} icon={GraduationCap} tone="warning" />
      </div>
      {currencies.length === 1 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <StatCard label={t('admin.feesCollected', 'Fees collected')} value={money(all.reduce((x, i) => x + i.fee_collected, 0), currencies[0]!)} icon={Wallet} tone="success" />
          <StatCard label={t('dashboard.outstanding', 'Outstanding')} value={money(all.reduce((x, i) => x + i.fee_outstanding, 0), currencies[0]!)} icon={Wallet} tone="danger" />
        </div>
      )}
      <Card className="p-5">
        <DataTable
          rows={all}
          rowKey={(i) => i.id}
          columns={[
            {
              key: 'name',
              header: t('common.name', 'Name'),
              cell: (i) => (
                <div>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-fg-muted">
                    {t(`institutionType.${i.type}`, i.type)} · {i.campuses} {t('group.campusesShort', 'campuses')}
                  </div>
                </div>
              ),
            },
            { key: 'status', header: t('common.status', 'Status'), cell: (i) => <Badge tone={i.status === 'active' ? 'success' : 'danger'}>{t(`status.${i.status}`, i.status)}</Badge>, hideOnMobile: true },
            { key: 'students', header: t('nav.students', 'Students'), cell: (i) => i.students },
            { key: 'staff', header: t('nav.staff', 'Staff'), cell: (i) => i.staff, hideOnMobile: true },
            { key: 'att', header: t('dashboard.attendance7', 'Attendance (7 days)'), cell: (i) => (i.attendance_rate == null ? '—' : `${i.attendance_rate}%`) },
            { key: 'fees', header: t('admin.feesCollected', 'Fees collected'), cell: (i) => money(i.fee_collected, i.currency), hideOnMobile: true },
            { key: 'due', header: t('dashboard.outstanding', 'Outstanding'), cell: (i) => money(i.fee_outstanding, i.currency), hideOnMobile: true },
          ]}
        />
      </Card>
    </>
  );
}

export default function GroupRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="group.read"><GroupOverview /></RequireAuth>} />
    </Routes>
  );
}

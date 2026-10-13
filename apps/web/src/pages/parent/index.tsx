import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge, useToast } from '@/components/ui';
import { RequireAuth } from '@/components/RequireAuth';
import { LearnerSummary, type Overview } from '../student';

interface Child {
  id: number;
  roll_no: string | null;
  name: string;
  class_name: string | null;
  fee_status: string;
}

function ParentDashboard() {
  const { t } = useTranslation();
  const toast = useToast();
  const children = useQuery({ queryKey: ['children'], queryFn: () => api.get<Child[]>('/parent/children') });
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (selected == null && children.data?.[0]) setSelected(children.data[0].id);
  }, [children.data, selected]);
  const overview = useQuery({
    queryKey: ['child', selected],
    queryFn: () => api.get<Overview>(`/parent/child/${selected}/overview`),
    enabled: selected != null,
  });

  if (children.isPending) return <Spinner />;
  if (children.isError) return <ErrorState error={children.error} onRetry={() => children.refetch()} />;
  if (!children.data.length)
    return (
      <>
        <PageHeader title={t('nav.children', 'My children')} />
        <Card>
          <EmptyState title={t('parent.none', 'No children are linked to your account yet')} description={t('parent.noneHelp', 'Ask the institution office to link your children.')} />
        </Card>
      </>
    );
  const child = children.data.find((c) => c.id === selected);
  return (
    <>
      <PageHeader title={t('nav.children', 'My children')} />
      <ul className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="tablist">
        {children.data.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              role="tab"
              aria-selected={c.id === selected}
              onClick={() => setSelected(c.id)}
              className={cn('w-full rounded-xl border bg-surface p-4 text-start transition-colors', c.id === selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:bg-surface-2')}
            >
              <div className="font-semibold">{c.name}</div>
              <div className="text-xs text-fg-muted">
                {c.class_name ?? '—'} · {c.roll_no ?? '—'}
              </div>
              <div className="mt-2">
                <StatusBadge value={c.fee_status} label={t(`status.${c.fee_status}`, c.fee_status)} />
              </div>
            </button>
          </li>
        ))}
      </ul>
      {overview.isPending ? (
        <Spinner />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : (
        <LearnerSummary
          data={overview.data}
          onReportCard={() => child && api.download(`/pdf/report-card/${child.id}`, `report-card-${child.roll_no || child.id}.pdf`).catch((e) => toast('error', errorMessage(e)))}
        />
      )}
    </>
  );
}

export default function ParentRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="guardian.access"><ParentDashboard /></RequireAuth>} />
    </Routes>
  );
}

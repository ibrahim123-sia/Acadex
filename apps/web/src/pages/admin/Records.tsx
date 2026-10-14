// The recycle bin (restore, or delete for good) and the audit trail (who changed what, when).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Badge, Button, ConfirmDialog, DataTable, Input, PageHeader, Pager, Select, Tabs, useToast } from '@/components/ui';

interface BinRow {
  entity: string;
  id: number;
  name: string;
  kind: string;
  deleted_at: string;
  deleted_by_name: string | null;
  days_left: number;
}
interface AuditRow {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  detail: string;
  actor: string;
}

function RecycleBin() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['recycle-bin'], queryFn: () => api.get<BinRow[]>('/institution/recycle-bin') });
  const [purging, setPurging] = useState<BinRow | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['recycle-bin'] });
    void qc.invalidateQueries({ queryKey: ['/institution/students'] });
    void qc.invalidateQueries({ queryKey: ['/institution/teachers'] });
    void qc.invalidateQueries({ queryKey: ['structure'] });
  };
  const restore = useMutation({
    mutationFn: (r: BinRow) => api.post(`/institution/recycle-bin/${r.entity}/${r.id}/restore`),
    onSuccess: (_, r) => {
      toast('success', t('bin.restored', '{{name}} restored', { name: r.name }));
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const purge = useMutation({
    mutationFn: (r: BinRow) => api.delete(`/institution/recycle-bin/${r.entity}/${r.id}`, { confirm: `${r.entity}/${r.id}` }),
    onSuccess: () => {
      setPurging(null);
      refresh();
    },
  });
  return (
    <>
      <p className="mb-3 text-sm text-fg-muted">{t('bin.help', 'Deleted records wait here for 30 days. Restoring brings everything back, including sign-in.')}</p>
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => `${r.entity}-${r.id}`}
        empty={t('bin.empty', 'The recycle bin is empty')}
        columns={[
          { key: 'name', header: t('common.name', 'Name'), cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'kind', header: t('bin.kind', 'Kind'), cell: (r) => <Badge>{t(`bin.entity.${r.entity}`, r.kind)}</Badge> },
          { key: 'when', header: t('bin.deleted', 'Deleted'), cell: (r) => `${formatDate(r.deleted_at)}${r.deleted_by_name ? ` · ${r.deleted_by_name}` : ''}`, hideOnMobile: true },
          { key: 'left', header: t('bin.daysLeft', 'Kept for'), cell: (r) => t('bin.days', '{{n}} days', { n: r.days_left }), hideOnMobile: true },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <Button variant="outline" size="sm" loading={restore.isPending && restore.variables === r} onClick={() => restore.mutate(r)}>
                  <RotateCcw className="size-4" /> {t('bin.restore', 'Restore')}
                </Button>
                <Button variant="ghost" size="sm" aria-label={t('bin.purge', 'Delete for good')} onClick={() => setPurging(r)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={!!purging}
        title={t('bin.purgeTitle', 'Delete {{name}} for good?', { name: purging?.name })}
        confirmLabel={t('bin.purge', 'Delete for good')}
        typeToConfirm={t('bin.word', 'DELETE')}
        busy={purge.isPending}
        error={purge.error}
        onConfirm={() => purging && purge.mutate(purging)}
        onClose={() => {
          setPurging(null);
          purge.reset();
        }}
      >
        {t('bin.purgeHelp', 'This removes the record, its sign-in and its files, and cannot be undone. Grades and attendance of a deleted student are removed too.')}
      </ConfirmDialog>
    </>
  );
}

const ENTITY_FILTERS = ['students', 'teachers', 'guardians', 'guardianships', 'sections', 'courses', 'course_offerings', 'enrollments', 'tuition_fee', 'roles', 'user_roles', 'institutions', 'Auth'];

function AuditTrail() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = usePagedList<AuditRow>('/institution/audit', { entity, from, to });
  const describe = (a: AuditRow) =>
    a.changes && Object.keys(a.changes).length
      ? Object.entries(a.changes)
          .map(([k, v]) => (Array.isArray(v) ? `${k}: ${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}` : `${k} ${String(v)}`))
          .join('; ')
      : a.detail;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-auto" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label={t('audit.what', 'What')}>
          <option value="">{t('audit.everything', 'Everything')}</option>
          {ENTITY_FILTERS.map((e) => (
            <option key={e} value={e}>
              {t(`audit.entity.${e}`, e === 'Auth' ? 'Sign-ins & security' : e.replace(/_/g, ' '))}
            </option>
          ))}
        </Select>
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('audit.from', 'From')} />
        <Input type="date" className="w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('audit.to', 'To')} />
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(a) => a.id}
        empty={t('audit.empty', 'Nothing recorded for this filter')}
        columns={[
          { key: 'when', header: t('common.date', 'Date'), cell: (a) => <span className="whitespace-nowrap text-xs">{new Date(a.created_at).toLocaleString()}</span> },
          { key: 'who', header: t('audit.who', 'Who'), cell: (a) => a.actor },
          {
            key: 'what',
            header: t('audit.what', 'What'),
            cell: (a) => (
              <span>
                <Badge tone={['delete', 'purge', 'sign_in_failed', 'refresh_token_reused'].includes(a.action) ? 'danger' : a.action === 'create' ? 'success' : 'neutral'}>{t(`auditAction.${a.action}`, a.action.replace(/_/g, ' '))}</Badge>{' '}
                <span className="text-fg-muted">
                  {t(`audit.entity.${a.entity}`, a.entity.replace(/_/g, ' '))}
                  {a.entity_id && ` #${a.entity_id}`}
                </span>
              </span>
            ),
          },
          { key: 'detail', header: t('audit.detail', 'Details'), cell: (a) => <span className="line-clamp-2 break-all text-xs text-fg-muted">{describe(a)}</span>, hideOnMobile: true },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </>
  );
}

export function AdminRecords() {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <>
      <PageHeader title={t('nav.records', 'Records')} subtitle={t('records.subtitle', 'Deleted records and the history of every change')} />
      <Tabs
        tabs={[
          { id: 'bin', label: t('bin.title', 'Recycle bin'), hidden: !can('recycle_bin.manage'), content: () => <RecycleBin /> },
          { id: 'audit', label: t('audit.title', 'Audit trail'), hidden: !can('audit.read'), content: () => <AuditTrail /> },
        ]}
      />
    </>
  );
}

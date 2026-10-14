// ID cards and certificates: print cards for a whole class, see everything issued, download or
// revoke. (Single certificates are issued from a student's record.)
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ban, FileDown, IdCard, Printer } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useTerms } from '@/lib/terms';
import { Badge, Button, Card, ConfirmDialog, DataTable, Field, Input, PageHeader, Select, Tabs, useToast } from '@/components/ui';
import { sectionName, useSectionOptions } from './structure-data';

interface CardRow {
  id: number;
  verify_code: string;
  valid_until: string;
  issued_at: string;
  revoked_at: string | null;
  holder_id: number;
  name: string;
  number: string | null;
  detail: string | null;
}
interface IssuedRow {
  id: number;
  kind: string;
  serial_no: string;
  title: string;
  issued_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  student_id: number | null;
  student_name: string | null;
  roll_no: string | null;
  issued_by_name: string | null;
}

function Cards() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const toast = useToast();
  const qc = useQueryClient();
  const sections = useSectionOptions({ status: 'active' });
  const [section, setSection] = useState('');
  const [holder, setHolder] = useState<'student' | 'staff'>('student');
  const list = useQuery({ queryKey: ['id-cards', holder, section], queryFn: () => api.get<CardRow[]>('/institution/id-cards', { holder_type: holder, section_id: section || undefined }) });
  const issue = useMutation({
    mutationFn: () => api.post<{ count: number }>('/institution/id-cards', { holder_type: 'student', section_id: Number(section) }),
    onSuccess: (r) => {
      toast('success', t('idcards.issuedN', '{{n}} cards issued', { n: r.count }));
      void qc.invalidateQueries({ queryKey: ['id-cards'] });
      void print();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const issueStaff = useMutation({
    mutationFn: async () => {
      const staff = await api.get<{ id: number; status: string }[]>('/institution/teachers', { pageSize: 100 });
      const r = await api.post<{ cards: { id: number }[] }>('/institution/id-cards', { holder_type: 'staff', holder_ids: staff.filter((s) => s.status !== 'left').map((s) => s.id) });
      await api.download(`/institution/id-cards/pdf?ids=${r.cards.map((c) => c.id).join(',')}`, 'staff-id-cards.pdf');
      return r.cards.length;
    },
    onSuccess: (n) => {
      toast('success', t('idcards.issuedN', '{{n}} cards issued', { n }));
      void qc.invalidateQueries({ queryKey: ['id-cards'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: number) => api.post(`/institution/id-cards/${id}/revoke`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['id-cards'] }), onError: (e) => toast('error', errorMessage(e)) });
  const print = () => api.download(`/institution/id-cards/pdf?section_id=${section}`, `id-cards-${section}.pdf`).catch((e) => toast('error', errorMessage(e)));
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label={t('idcards.for', 'Cards for')}>
          {(a) => (
            <Select {...a} value={holder} onChange={(e) => setHolder(e.target.value as 'student' | 'staff')}>
              <option value="student">{term('student', true)}</option>
              <option value="staff">{t('nav.staff', 'Staff')}</option>
            </Select>
          )}
        </Field>
        {holder === 'student' && (
          <Field label={term('section')}>
            {(a) => (
              <Select {...a} value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="">{t('common.choose', 'Choose…')}</option>
                {sections.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sectionName(s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {holder === 'staff' && (
          <Button loading={issueStaff.isPending} onClick={() => issueStaff.mutate()}>
            <IdCard className="size-4" /> {t('idcards.issueStaff', 'Issue for all staff and print')}
          </Button>
        )}
        {holder === 'student' && (
          <>
            <Button disabled={!section} loading={issue.isPending} onClick={() => issue.mutate()}>
              <IdCard className="size-4" /> {t('idcards.issueClass', 'Issue for everyone and print')}
            </Button>
            <Button variant="outline" disabled={!section || !list.data?.some((c) => !c.revoked_at)} onClick={() => void print()}>
              <Printer className="size-4" /> {t('idcards.reprint', 'Print current cards')}
            </Button>
          </>
        )}
      </Card>
      <p className="text-sm text-fg-muted">{t('idcards.help', 'Each card has a QR code. Scanning it shows whether the card is valid, with the first name only.')}</p>
      <DataTable
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(c) => c.id}
        empty={t('idcards.noneYet', 'No cards issued yet')}
        columns={[
          { key: 'name', header: t('common.name', 'Name'), cell: (c) => <span className="font-medium">{c.name}</span> },
          { key: 'detail', header: holder === 'student' ? term('section') : t('staff.designation', 'Designation'), cell: (c) => c.detail ?? '—', hideOnMobile: true },
          { key: 'code', header: t('idcards.code', 'Code'), cell: (c) => <span className="font-mono text-xs">{c.verify_code}</span>, hideOnMobile: true },
          { key: 'valid', header: t('idcards.validUntil', 'Valid until'), cell: (c) => (c.revoked_at ? <Badge tone="danger">{t('certificates.revoked', 'Revoked')}</Badge> : formatDate(c.valid_until)) },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (c) =>
              !c.revoked_at && (
                <Button variant="ghost" size="sm" aria-label={t('idcards.revoke', 'Revoke (lost card)')} onClick={() => revoke.mutate(c.id)}>
                  <Ban className="size-4" />
                </Button>
              ),
          },
        ]}
      />
    </div>
  );
}

function Issued() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['issued-documents'], queryFn: () => api.get<IssuedRow[]>('/institution/issued-documents') });
  const [revoking, setRevoking] = useState<IssuedRow | null>(null);
  const [reason, setReason] = useState('');
  const revoke = useMutation({
    mutationFn: () => api.post(`/institution/issued-documents/${revoking!.id}/revoke`, { reason }),
    onSuccess: () => {
      setRevoking(null);
      setReason('');
      void qc.invalidateQueries({ queryKey: ['issued-documents'] });
    },
  });
  return (
    <>
      <p className="mb-3 text-sm text-fg-muted">{t('certificates.registerHelp', 'Issue certificates and letters from a student’s record (Certificates & ID tab). Every document is numbered and can be verified by its QR code.')}</p>
      <DataTable
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(d) => d.id}
        empty={t('certificates.none', 'Nothing issued yet')}
        columns={[
          { key: 'serial', header: t('certificates.serial', 'Number'), cell: (d) => <span className="font-mono text-xs">{d.serial_no}</span> },
          { key: 'title', header: t('certificates.kind', 'Document'), cell: (d) => d.title },
          {
            key: 'student',
            header: t('common.name', 'Name'),
            cell: (d) =>
              d.student_id ? (
                <Link to={`/admin/students/${d.student_id}#certificates`} className="text-primary hover:underline">
                  {d.student_name}
                </Link>
              ) : (
                '—'
              ),
          },
          { key: 'date', header: t('common.date', 'Date'), cell: (d) => formatDate(d.issued_at), hideOnMobile: true },
          { key: 'by', header: t('certificates.by', 'Prepared by'), cell: (d) => d.issued_by_name ?? '—', hideOnMobile: true },
          {
            key: 'status',
            header: t('common.status', 'Status'),
            cell: (d) => (d.revoked_at ? <Badge tone="danger" title={d.revoke_reason ?? ''}>{t('certificates.revoked', 'Revoked')}</Badge> : <Badge tone="success">{t('certificates.valid', 'Valid')}</Badge>),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions', 'Actions')}</span>,
            cell: (d) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" aria-label={t('common.download', 'Download')} onClick={() => void api.download(`/institution/issued-documents/${d.id}/pdf`, `${d.serial_no}.pdf`).catch((e) => toast('error', errorMessage(e)))}>
                  <FileDown className="size-4" />
                </Button>
                {!d.revoked_at && (
                  <Button variant="ghost" size="sm" aria-label={t('certificates.revoke', 'Revoke')} onClick={() => setRevoking(d)}>
                    <Ban className="size-4" />
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <ConfirmDialog open={!!revoking} title={t('certificates.revokeTitle', 'Revoke {{serial}}?', { serial: revoking?.serial_no })} confirmLabel={t('certificates.revoke', 'Revoke')} busy={revoke.isPending} error={revoke.error} onConfirm={() => reason.trim() && revoke.mutate()} onClose={() => setRevoking(null)}>
        <p className="mb-2">{t('certificates.revokeHelp', 'Verification will show it as revoked. This cannot be undone.')}</p>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('certificates.reasonPlaceholder', 'Why (required)')} aria-label={t('certificates.reason', 'Reason')} />
      </ConfirmDialog>
    </>
  );
}

export function AdminDocuments() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.documents', 'ID cards & certificates')} />
      <Tabs
        tabs={[
          { id: 'cards', label: t('idcards.tab', 'ID cards'), content: () => <Cards /> },
          { id: 'issued', label: t('certificates.tab', 'Certificates & letters'), content: () => <Issued /> },
        ]}
      />
    </>
  );
}

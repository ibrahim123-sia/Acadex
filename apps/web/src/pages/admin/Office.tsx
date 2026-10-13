// Classes, fees and announcements.
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { FileText, Megaphone, Plus, Wallet } from 'lucide-react';
import { announcementBody, AUDIENCES, collectFeeBody, createClassBody } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import { useDebounced, usePagedList } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Pager, Select, Spinner, StatCard, StatusBadge, Textarea, useToast } from '@/components/ui';

// ---------------- classes ----------------
interface ClassRow {
  id: number;
  code: string;
  name: string;
  section: string;
  students: number;
  subjects: number;
}

export function AdminClasses() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const list = usePagedList<ClassRow>('/institution/classes', {}, 100);
  const form = useForm<z.input<typeof createClassBody>>({ resolver: zodResolver(createClassBody), defaultValues: { code: '', name: '', section: 'A' } });
  const m = useMutation({
    mutationFn: (v: z.input<typeof createClassBody>) => api.post('/institution/classes', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/institution/classes'] });
      form.reset();
      setOpen(false);
    },
  });
  return (
    <>
      <PageHeader
        title={t('nav.classes', 'Classes')}
        subtitle={t('admin.classesSubtitle', 'Sections and enrolment')}
        actions={
          can('classes.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('admin.createClass', 'Create a class')}
            </Button>
          )
        }
      />
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.rows.length ? (
        <Card>
          <EmptyState title={t('admin.noClasses', 'No classes yet')} />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.rows.map((c) => (
            <li key={c.id}>
              <Card className="p-5">
                <div className="text-lg font-bold">{c.name}</div>
                <div className="text-xs text-fg-muted">
                  {t('admin.section', 'Section {{section}}', { section: c.section })} · {c.code}
                </div>
                <div className="mt-4 flex gap-6 text-sm">
                  <div>
                    <div className="text-xl font-semibold">{c.students}</div>
                    <div className="text-fg-muted">{t('nav.students', 'Students')}</div>
                  </div>
                  <div>
                    <div className="text-xl font-semibold">{c.subjects}</div>
                    <div className="text-fg-muted">{t('admin.subjects', 'Subjects')}</div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={t('admin.createClass', 'Create a class')}>
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.classCode', 'Code')} error={form.formState.errors.code?.message}>
              {(a) => <Input {...a} placeholder="C6" dir="ltr" {...form.register('code')} />}
            </Field>
            <Field label={t('admin.sectionLabel', 'Section')}>{(a) => <Input {...a} {...form.register('section')} />}</Field>
          </div>
          <Field label={t('common.name', 'Name')} error={form.formState.errors.name?.message}>
            {(a) => <Input {...a} placeholder="Class VI" {...form.register('name')} />}
          </Field>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('common.create', 'Create')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

// ---------------- fees ----------------
interface FeeRow {
  id: number;
  receipt_id: string;
  total_fee: string;
  paid_amount: string;
  remaining_balance: string;
  payment_status: string;
  payment_date: string;
  student: string;
  roll_no: string | null;
}

/** Pick a student by searching (lists are paginated, so no giant dropdown). */
function StudentPicker({ value, onChange }: { value: number | ''; onChange: (id: number) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const results = useQuery({
    queryKey: ['student-search', debounced],
    queryFn: () => api.get<{ id: number; first_name: string; last_name: string; roll_no: string | null }[]>('/institution/students', { search: debounced, pageSize: 10 }),
  });
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchStudents', 'Search by name or roll number…')} aria-label={t('admin.findStudent', 'Find a student')} />
      <ul className="mt-1 max-h-44 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="listbox" aria-label={t('admin.matchingStudents', 'Matching students')}>
        {!results.data?.length ? (
          <li className="px-3 py-2 text-sm text-fg-muted">{t('admin.noMatches', 'No students match your search')}</li>
        ) : (
          results.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === s.id}
                onClick={() => onChange(s.id)}
                className={cn('w-full px-3 py-2 text-start text-sm', value === s.id ? 'bg-primary-soft font-medium text-primary' : 'hover:bg-surface-2')}
              >
                {s.first_name} {s.last_name} <span className="text-fg-muted">({s.roll_no ?? '—'})</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function CollectFeeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useForm<z.input<typeof collectFeeBody>>({ resolver: zodResolver(collectFeeBody), defaultValues: { student_id: '' as unknown as number, total_fee: '' as unknown as number, paid_amount: 0 } });
  const m = useMutation({
    mutationFn: (v: z.input<typeof collectFeeBody>) => api.post('/institution/fees', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/institution/fees'] });
      void qc.invalidateQueries({ queryKey: ['fees-summary'] });
      form.reset();
      onClose();
    },
  });
  const studentId = form.watch('student_id');
  const e = form.formState.errors;
  return (
    <Dialog open={open} onClose={onClose} title={t('admin.collectFee', 'Record a fee payment')}>
      <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
        <Field label={t('common.student', 'Student')} error={e.student_id ? t('admin.chooseStudent', 'Choose a student') : undefined}>
          {() => <StudentPicker value={(studentId as number) || ''} onChange={(id) => form.setValue('student_id', id, { shouldValidate: true })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.totalFee', 'Total fee')} error={e.total_fee?.message}>
            {(a) => <Input {...a} type="number" inputMode="decimal" min={0} {...form.register('total_fee')} />}
          </Field>
          <Field label={t('admin.paidAmount', 'Paid now')} error={e.paid_amount?.message}>
            {(a) => <Input {...a} type="number" inputMode="decimal" min={0} {...form.register('paid_amount')} />}
          </Field>
        </div>
        {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" loading={m.isPending}>
            {t('admin.saveReceipt', 'Save receipt')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function AdminFees() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const list = usePagedList<FeeRow>('/institution/fees');
  const summary = useQuery({ queryKey: ['fees-summary'], queryFn: () => api.get<{ collected: number; outstanding: number }>('/institution/fees/summary') });
  return (
    <>
      <PageHeader
        title={t('nav.fees', 'Fees')}
        subtitle={t('admin.feesSubtitle', 'Collections and receipts')}
        actions={
          can('fees.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('admin.collectFee', 'Record a fee payment')}
            </Button>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label={t('admin.collected', 'Collected')} value={summary.data ? formatMoney(summary.data.collected) : '…'} icon={Wallet} tone="success" />
        <StatCard label={t('admin.outstandingLabel', 'Outstanding')} value={summary.data ? formatMoney(summary.data.outstanding) : '…'} icon={Wallet} tone="danger" />
        <StatCard label={t('admin.receipts', 'Receipts')} value={list.data?.total ?? '…'} icon={FileText} />
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('admin.noFees', 'No fee records yet')}
        columns={[
          { key: 'receipt', header: t('admin.receipt', 'Receipt'), cell: (f) => <span className="font-mono text-xs">{f.receipt_id}</span>, hideOnMobile: true },
          {
            key: 'student',
            header: t('common.student', 'Student'),
            cell: (f) => (
              <div>
                <div className="font-medium">{f.student}</div>
                <div className="text-xs text-fg-muted">{formatDate(f.payment_date)}</div>
              </div>
            ),
          },
          { key: 'total', header: t('admin.totalFee', 'Total fee'), cell: (f) => formatMoney(f.total_fee), hideOnMobile: true },
          { key: 'paid', header: t('admin.paid', 'Paid'), cell: (f) => formatMoney(f.paid_amount) },
          { key: 'balance', header: t('admin.balance', 'Balance'), cell: (f) => formatMoney(f.remaining_balance), hideOnMobile: true },
          { key: 'status', header: t('common.status', 'Status'), cell: (f) => <StatusBadge value={f.payment_status} label={t(`status.${f.payment_status}`, f.payment_status)} /> },
          {
            key: 'voucher',
            header: <span className="sr-only">{t('admin.voucher', 'Voucher')}</span>,
            cell: (f) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => api.download(`/pdf/fee-voucher/${f.id}`, `voucher-${f.receipt_id}.pdf`).catch((e) => toast('error', errorMessage(e)))}
                aria-label={t('admin.voucher', 'Voucher')}
              >
                <FileText className="size-4" /> <span className="hidden md:inline">{t('admin.voucher', 'Voucher')}</span>
              </Button>
            ),
          },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      <CollectFeeDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---------------- announcements ----------------
interface Announcement {
  id: number;
  title: string;
  description: string;
  target_audience: string;
  created_at?: string;
  end_date: string | null;
}

export function AnnouncementList({ path }: { path: string }) {
  const { t } = useTranslation();
  const list = usePagedList<Announcement>(path, {}, 20);
  if (list.isPending) return <Spinner />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data.rows.length)
    return (
      <Card>
        <EmptyState title={t('admin.noAnnouncements', 'No announcements yet')} />
      </Card>
    );
  return (
    <>
      <ul className="space-y-3">
        {list.data.rows.map((a) => (
          <li key={a.id}>
            <Card className="flex items-start gap-3 p-5">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
                <Megaphone className="size-[18px]" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.title}</div>
                <p className="mt-0.5 whitespace-pre-line text-sm text-fg-muted">{a.description}</p>
                {a.end_date && <div className="mt-1 text-xs text-fg-muted">{t('admin.until', 'Until {{date}}', { date: formatDate(a.end_date) })}</div>}
              </div>
              <Badge tone="info">{t(`audience.${a.target_audience}`, a.target_audience)}</Badge>
            </Card>
          </li>
        ))}
      </ul>
      <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />
    </>
  );
}

export function AdminAnnouncements() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof announcementBody>>({ resolver: zodResolver(announcementBody), defaultValues: { title: '', target_audience: 'All', description: '', end_date: '' } });
  const m = useMutation({
    mutationFn: (v: z.input<typeof announcementBody>) => api.post('/institution/announcements', v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/institution/announcements'] });
      form.reset();
      setOpen(false);
    },
  });
  useEffect(() => {
    if (!open) m.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = form.formState.errors;
  return (
    <>
      <PageHeader
        title={t('nav.announcements', 'Announcements')}
        subtitle={t('admin.announcementsSubtitle', 'Notices for the institution')}
        actions={
          can('announcements.manage') && (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> {t('admin.newAnnouncement', 'New announcement')}
            </Button>
          )
        }
      />
      <AnnouncementList path="/institution/announcements" />
      <Dialog open={open} onClose={() => setOpen(false)} title={t('admin.newAnnouncement', 'New announcement')}>
        <form className="space-y-4" noValidate onSubmit={form.handleSubmit((v) => m.mutate(v))}>
          <Field label={t('admin.title', 'Title')} error={e.title?.message}>
            {(a) => <Input {...a} {...form.register('title')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.audience', 'Audience')}>
              {(a) => (
                <Select {...a} {...form.register('target_audience')}>
                  {AUDIENCES.map((x) => (
                    <option key={x} value={x}>
                      {t(`audience.${x}`, x)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('admin.showUntil', 'Show until')} optional>
              {(a) => <Input {...a} type="date" {...form.register('end_date')} />}
            </Field>
          </div>
          <Field label={t('admin.message', 'Message')} error={e.description?.message}>
            {(a) => <Textarea {...a} rows={5} {...form.register('description')} />}
          </Field>
          {m.isError && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" loading={m.isPending}>
              {t('admin.publish', 'Publish')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

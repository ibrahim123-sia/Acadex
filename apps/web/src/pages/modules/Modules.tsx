// The optional institute modules: Library (desk and catalogue), HR & payroll, Transport,
// Hostel, Inventory & assets, Visitors — and the personal pages (my payslips and leave, my
// library books and my bus).
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Barcode, BookPlus, FileText, LogOut, Plus } from 'lucide-react';
import { STAFF_LEAVE_KINDS } from '@acadex/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { useDebounced, usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';

/** Search people (for borrowers, hosts, assignees). */
function PersonPicker({ value, onChange, label, roles }: { value: number | null; onChange: (id: number | null, name?: string) => void; label: string; roles?: string[] }) {
  const [q, setQ] = useState('');
  const d = useDebounced(q);
  const list = useQuery({ queryKey: ['contacts', d], queryFn: () => api.get<{ id: number; full_name: string; role: string; detail: string | null }[]>('/messages/contacts', { q: d }), enabled: d.length > 1 });
  const [picked, setPicked] = useState<string>('');
  return (
    <div className="space-y-1">
      <Field label={label}>{(a) => <Input {...a} value={picked || q} onChange={(e) => { setPicked(''); onChange(null); setQ(e.target.value); }} placeholder="…" />}</Field>
      {!value && d.length > 1 && (
        <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded border border-border text-sm">
          {list.data?.filter((p) => !roles || roles.includes(p.role)).map((p) => (
            <li key={p.id}><button type="button" className="flex w-full justify-between px-3 py-1.5 text-start hover:bg-surface-2" onClick={() => { setPicked(p.full_name); onChange(p.id, p.full_name); }}><span>{p.full_name}</span><span className="text-xs text-fg-muted">{p.role}{p.detail ? ` · ${p.detail}` : ''}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search students (their record ids — transport and hostel). */
function StudentPicker({ value, onChange, label }: { value: number | null; onChange: (id: number | null) => void; label: string }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState('');
  const d = useDebounced(q);
  const list = useQuery({ queryKey: ['students-pick', d], queryFn: () => api.get<{ id: number; first_name: string; last_name: string; roll_no: string | null; section_name?: string | null }[]>('/institution/students', { search: d, pageSize: 20 }), enabled: d.length > 1 });
  return (
    <div className="space-y-1">
      <Field label={label}>{(a) => <Input {...a} value={picked || q} onChange={(e) => { setPicked(''); onChange(null); setQ(e.target.value); }} placeholder="…" />}</Field>
      {!value && d.length > 1 && (
        <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded border border-border text-sm">
          {list.data?.map((p) => (
            <li key={p.id}><button type="button" className="flex w-full justify-between px-3 py-1.5 text-start hover:bg-surface-2" onClick={() => { setPicked(`${p.first_name} ${p.last_name}`); onChange(p.id); }}><span>{p.first_name} {p.last_name}</span><span className="text-xs text-fg-muted">{p.roll_no}{p.section_name ? ` · ${p.section_name}` : ''}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- library

export function LibraryPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.library', 'Library')} />
      <Tabs tabs={[
        { id: 'desk', label: t('lib.desk', 'Issue & return'), content: () => <LibraryDesk /> },
        { id: 'catalogue', label: t('lib.catalogue', 'Catalogue'), content: () => <Catalogue /> },
        { id: 'loans', label: t('lib.loans', 'Loans & fines'), content: () => <Loans /> },
        { id: 'settings', label: t('nav.settings', 'Settings'), content: () => <LibrarySettings /> },
      ]} />
    </>
  );
}

function LibraryDesk() {
  const { t } = useTranslation();
  const toast = useToast();
  const [barcode, setBarcode] = useState('');
  const [borrower, setBorrower] = useState<number | null>(null);
  const [ret, setRet] = useState('');
  const issue = useMutation({ mutationFn: () => api.post<{ title: string; borrower: string; due_on: string }>('/library/issue', { barcode, borrower_id: borrower }), onSuccess: (r) => { toast('success', t('lib.issued', '{{title}} → {{who}}, due {{due}}', { title: r.title, who: r.borrower, due: formatDate(r.due_on) })); setBarcode(''); } });
  const back = useMutation({ mutationFn: (lost: boolean) => api.post<{ title: string; days_late: number; fine: number }>('/library/return', { barcode: ret, lost }), onSuccess: (r) => { toast(r.fine ? 'error' : 'success', r.fine ? t('lib.fine', '{{title}} returned {{d}} days late — fine {{f}}', { title: r.title, d: r.days_late, f: formatMoney(r.fine) }) : t('lib.returned', '{{title}} returned', { title: r.title })); setRet(''); } });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t('lib.issue', 'Issue a book')}</h2>
        <Field label={t('lib.barcode', 'Barcode (scan)')}>{(a) => <Input {...a} autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)} />}</Field>
        <PersonPicker label={t('lib.borrower', 'Borrower')} value={borrower} onChange={(id) => setBorrower(id)} roles={['student', 'teacher', 'institution_admin']} />
        <MutationError error={issue.error} />
        <Button disabled={!barcode || !borrower} loading={issue.isPending} onClick={() => issue.mutate()}><Barcode className="size-4" /> {t('lib.issueBtn', 'Issue')}</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t('lib.return', 'Return a book')}</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (ret) back.mutate(false); }} className="space-y-3">
          <Field label={t('lib.barcode', 'Barcode (scan)')}>{(a) => <Input {...a} value={ret} onChange={(e) => setRet(e.target.value)} />}</Field>
          <MutationError error={back.error} />
          <div className="flex gap-2"><Button type="submit" loading={back.isPending}>{t('lib.returnBtn', 'Return')}</Button><Button type="button" variant="ghost" disabled={!ret} onClick={() => back.mutate(true)}>{t('lib.lost', 'Mark lost')}</Button></div>
        </form>
      </Card>
    </div>
  );
}

function Catalogue() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const d = useDebounced(q);
  const list = usePagedList<{ id: number; title: string; authors: string; isbn: string; category: string; shelf: string; copies: number; available: number }>('/library/books', { q: d || undefined });
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2"><Input aria-label={t('common.search', 'Search')} placeholder={t('lib.search', 'Title, author, ISBN')} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" /><Button onClick={() => setAdding(true)}><BookPlus className="size-4" /> {t('lib.addBook', 'Add a book')}</Button></div>
      <DataTable rows={list.data?.rows} loading={list.isPending} error={list.error} rowKey={(r) => r.id} empty={t('lib.empty', 'No books yet')} columns={[
        { key: 't', header: t('lib.title', 'Title'), cell: (r) => <span className="font-medium">{r.title}<span className="block text-xs text-fg-muted">{r.authors}</span></span> },
        { key: 'c', header: t('lib.category', 'Category'), cell: (r) => r.category, hideOnMobile: true },
        { key: 's', header: t('lib.shelf', 'Shelf'), cell: (r) => r.shelf, hideOnMobile: true },
        { key: 'a', header: t('lib.available', 'Available'), cell: (r) => <Badge tone={r.available ? 'success' : 'warning'}>{r.available} / {r.copies}</Badge> },
      ]} />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {adding && <AddBook onClose={() => { setAdding(false); void list.refetch(); }} />}
    </>
  );
}

function AddBook({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({ title: '', authors: '', isbn: '', publisher: '', category: '', shelf: '', copies: '' });
  const m = useMutation({ mutationFn: () => api.post('/library/books', { ...v, copies: v.copies.split(/[\s,]+/).filter(Boolean) }), onSuccess: onClose });
  const f = (k: keyof typeof v, label: string, opt = true) => <Field label={label} optional={opt}>{(a) => <Input {...a} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}</Field>;
  return (
    <Dialog open onClose={onClose} title={t('lib.addBook', 'Add a book')}>
      <div className="space-y-3">
        {f('title', t('lib.title', 'Title'), false)}
        {f('authors', t('lib.authors', 'Authors'))}
        <div className="grid gap-3 sm:grid-cols-2">{f('isbn', 'ISBN')}{f('category', t('lib.category', 'Category'))}</div>
        <div className="grid gap-3 sm:grid-cols-2">{f('publisher', t('lib.publisher', 'Publisher'))}{f('shelf', t('lib.shelf', 'Shelf'))}</div>
        <Field label={t('lib.copies', 'Barcodes of the copies')} hint={t('lib.copiesHint', 'One per copy, separated by spaces or commas')}>{(a) => <Textarea {...a} rows={2} value={v.copies} onChange={(e) => setV({ ...v, copies: e.target.value })} />}</Field>
        <MutationError error={m.error} />
        <Button disabled={!v.title} loading={m.isPending} onClick={() => m.mutate()}>{t('common.save', 'Save')}</Button>
      </div>
    </Dialog>
  );
}

function Loans() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('open');
  const list = usePagedList<{ id: number; title: string; barcode: string; borrower: string; due_on: string; returned_at: string | null; fine: number; fine_paid: boolean; overdue: boolean }>('/library/loans', { status });
  const pay = useMutation({ mutationFn: (id: number) => api.post(`/library/loans/${id}/pay-fine`), onSuccess: () => list.refetch() });
  return (
    <>
      <div className="mb-3 flex gap-2">{['open', 'overdue', 'fines', 'all'].map((s) => <Button key={s} size="sm" variant={status === s ? 'primary' : 'outline'} onClick={() => setStatus(s)}>{t(`lib.s.${s}`, s)}</Button>)}</div>
      <DataTable rows={list.data?.rows} loading={list.isPending} error={list.error} rowKey={(r) => r.id} columns={[
        { key: 't', header: t('lib.title', 'Title'), cell: (r) => <span>{r.title}<span className="block text-xs text-fg-muted">{r.barcode}</span></span> },
        { key: 'b', header: t('lib.borrower', 'Borrower'), cell: (r) => r.borrower },
        { key: 'd', header: t('lib.due', 'Due'), cell: (r) => <span className={r.overdue ? 'text-danger' : ''}>{formatDate(r.due_on)}</span> },
        { key: 'f', header: t('lib.fineCol', 'Fine'), cell: (r) => (r.fine > 0 ? (r.fine_paid ? <Badge tone="success">{formatMoney(r.fine)}</Badge> : <Button size="sm" variant="outline" onClick={() => pay.mutate(r.id)}>{t('lib.collect', 'Collect {{f}}', { f: formatMoney(r.fine) })}</Button>) : '—') },
      ]} />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </>
  );
}

function LibrarySettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/library/settings'], queryFn: () => api.get<{ loan_days: number; fine_per_day: number; max_loans: number }>('/library/settings') });
  const [v, setV] = useState<{ loan_days: number; fine_per_day: number; max_loans: number } | null>(null);
  const save = useMutation({ mutationFn: () => api.put('/library/settings', v ?? q.data), onSuccess: () => toast('success', t('common.saved', 'Saved')) });
  if (!q.data) return <Spinner />;
  const cur = v ?? q.data;
  return (
    <Card className="max-w-md space-y-3 p-5">
      {(['loan_days', 'fine_per_day', 'max_loans'] as const).map((k) => <Field key={k} label={t(`lib.${k}`, { loan_days: 'Loan period (days)', fine_per_day: 'Fine per day late', max_loans: 'Books per person' }[k])}>{(a) => <Input {...a} type="number" min={0} value={cur[k]} onChange={(e) => setV({ ...cur, [k]: Number(e.target.value) })} />}</Field>)}
      <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
    </Card>
  );
}

// ---------------------------------------------------------------- HR and payroll

export function HrPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.hr', 'HR & payroll')} />
      <Tabs tabs={[
        { id: 'payroll', label: t('hr.payroll', 'Payroll'), content: () => <Payroll /> },
        { id: 'salaries', label: t('hr.salaries', 'Salaries'), content: () => <Salaries /> },
        { id: 'leave', label: t('hr.leave', 'Staff leave'), content: () => <StaffLeave manage /> },
        { id: 'structures', label: t('hr.structures', 'Salary structures'), content: () => <Structures /> },
      ]} />
    </>
  );
}

function Payroll() {
  const { t } = useTranslation();
  const runs = useQuery({ queryKey: ['/hr/payroll'], queryFn: () => api.get<{ id: number; month: string; status: string; total_gross: number; total_net: number; payslips: number }[]>('/hr/payroll') });
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [open, setOpen] = useState<number | null>(null);
  const create = useMutation({ mutationFn: () => api.post<{ id: number }>('/hr/payroll', { month }), onSuccess: (r) => { void runs.refetch(); setOpen(r.id); } });
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2"><Field label={t('hr.month', 'Month')}>{(a) => <Input {...a} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field><Button loading={create.isPending} onClick={() => create.mutate()}>{t('hr.run', 'Run payroll')}</Button></div>
      <MutationError error={create.error} />
      <DataTable rows={runs.data} loading={runs.isPending} error={runs.error} rowKey={(r) => r.id} empty={t('hr.noRuns', 'No payroll yet')} columns={[
        { key: 'm', header: t('hr.month', 'Month'), cell: (r) => <button className="font-medium text-primary hover:underline" onClick={() => setOpen(r.id)}>{r.month}</button> },
        { key: 's', header: t('common.status', 'Status'), cell: (r) => <StatusBadge value={r.status === 'draft' ? 'draft' : r.status === 'approved' ? 'approved' : 'paid'} label={r.status} /> },
        { key: 'n', header: t('hr.payslips', 'Payslips'), cell: (r) => r.payslips },
        { key: 'g', header: t('hr.gross', 'Gross'), cell: (r) => formatMoney(r.total_gross) },
        { key: 'net', header: t('hr.net', 'Net'), cell: (r) => formatMoney(r.total_net) },
      ]} />
      {open && <PayrollRun id={open} onClose={() => { setOpen(null); void runs.refetch(); }} />}
    </>
  );
}

function PayrollRun({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['payroll', id], queryFn: () => api.get<{ month: string; status: string; payslips: { id: number; name: string; basic: number; earnings: { name: string; amount: number }[]; deductions: { name: string; amount: number }[]; gross: number; net: number }[] }>(`/hr/payroll/${id}`) });
  const act = useMutation({ mutationFn: (a: 'approve' | 'paid') => api.post(`/hr/payroll/${id}/${a}`), onSuccess: () => q.refetch() });
  const del = useMutation({ mutationFn: () => api.delete(`/hr/payroll/${id}`), onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title={`${t('hr.payroll', 'Payroll')} ${q.data?.month ?? ''}`} className="max-w-3xl">
      {!q.data ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {q.data.status === 'draft' && <><Button size="sm" onClick={() => act.mutate('approve')}>{t('hr.approve', 'Approve (staff can see payslips)')}</Button><Button size="sm" variant="ghost" onClick={() => del.mutate()}>{t('hr.discard', 'Discard')}</Button></>}
            {q.data.status === 'approved' && <Button size="sm" onClick={() => act.mutate('paid')}>{t('hr.markPaid', 'Mark salaries paid')}</Button>}
            <StatusBadge value={q.data.status === 'paid' ? 'paid' : q.data.status === 'approved' ? 'approved' : 'draft'} label={q.data.status} />
          </div>
          <MutationError error={act.error} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-fg-muted">{[t('common.name', 'Name'), t('hr.basic', 'Basic'), t('hr.earnings', 'Earnings'), t('hr.deductions', 'Deductions'), t('hr.net', 'Net'), ''].map((h) => <th key={h} className="px-2 py-1 text-start">{h}</th>)}</tr></thead>
              <tbody>{q.data.payslips.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-2 py-1">{p.name}</td><td className="px-2 py-1 tabular-nums">{formatMoney(p.basic)}</td>
                  <td className="px-2 py-1 text-xs">{p.earnings.map((e) => `${e.name} ${formatMoney(e.amount)}`).join(', ') || '—'}</td>
                  <td className="px-2 py-1 text-xs">{p.deductions.map((e) => `${e.name} ${formatMoney(e.amount)}`).join(', ') || '—'}</td>
                  <td className="px-2 py-1 font-semibold tabular-nums">{formatMoney(p.net)}</td>
                  <td className="px-2 py-1"><Button size="sm" variant="ghost" onClick={() => api.download(`/hr/payslips/${p.id}/pdf`, `payslip-${p.name}.pdf`)}><FileText className="size-3.5" /> PDF</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Salaries() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/hr/salaries'], queryFn: () => api.get<{ teacher_id: number; name: string; designation: string; basic: number | null; structure_id: number | null; structure: string | null; bank_account: string | null; effective_from: string | null }[]>('/hr/salaries') });
  const structures = useQuery({ queryKey: ['/hr/structures'], queryFn: () => api.get<{ id: number; name: string }[]>('/hr/structures') });
  const [edit, setEdit] = useState<{ teacher_id: number; name: string; basic: string; structure_id: string; bank_account: string; effective_from: string } | null>(null);
  const save = useMutation({ mutationFn: () => api.put('/hr/salaries', { ...edit, basic: Number(edit!.basic), structure_id: edit!.structure_id ? Number(edit!.structure_id) : null }), onSuccess: () => { setEdit(null); void q.refetch(); } });
  return (
    <>
      <DataTable rows={q.data} loading={q.isPending} error={q.error} rowKey={(r) => r.teacher_id} columns={[
        { key: 'n', header: t('common.name', 'Name'), cell: (r) => <span>{r.name}<span className="block text-xs text-fg-muted">{r.designation}</span></span> },
        { key: 'b', header: t('hr.basic', 'Basic'), cell: (r) => (r.basic != null ? formatMoney(r.basic) : '—') },
        { key: 's', header: t('hr.structure', 'Structure'), cell: (r) => r.structure ?? '—', hideOnMobile: true },
        { key: 'f', header: t('hr.from', 'From'), cell: (r) => (r.effective_from ? formatDate(r.effective_from) : '—'), hideOnMobile: true },
        { key: 'a', header: '', cell: (r) => <Button size="sm" variant="outline" onClick={() => setEdit({ teacher_id: r.teacher_id, name: r.name, basic: String(r.basic ?? ''), structure_id: String(r.structure_id ?? ''), bank_account: r.bank_account ?? '', effective_from: new Date().toISOString().slice(0, 10) })}>{t('hr.setSalary', 'Set salary')}</Button> },
      ]} />
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit.name}>
          <div className="space-y-3">
            <Field label={t('hr.basic', 'Basic salary (monthly)')}>{(a) => <Input {...a} type="number" min={0} value={edit.basic} onChange={(e) => setEdit({ ...edit, basic: e.target.value })} />}</Field>
            <Field label={t('hr.structure', 'Structure')} optional>{(a) => <Select {...a} value={edit.structure_id} onChange={(e) => setEdit({ ...edit, structure_id: e.target.value })}><option value="">—</option>{structures.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            <Field label={t('hr.bank', 'Bank account')} optional>{(a) => <Input {...a} value={edit.bank_account} onChange={(e) => setEdit({ ...edit, bank_account: e.target.value })} />}</Field>
            <Field label={t('hr.from', 'Effective from')}>{(a) => <Input {...a} type="date" value={edit.effective_from} onChange={(e) => setEdit({ ...edit, effective_from: e.target.value })} />}</Field>
            <MutationError error={save.error} />
            <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function Structures() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/hr/structures'], queryFn: () => api.get<{ id: number; name: string; components: { name: string; kind: string; calc: string; value: number }[] }[]>('/hr/structures') });
  const [name, setName] = useState('');
  const [rows, setRows] = useState<{ name: string; kind: 'earning' | 'deduction'; calc: 'fixed' | 'percent_of_basic'; value: number }[]>([{ name: 'House rent', kind: 'earning', calc: 'percent_of_basic', value: 45 }, { name: 'Income tax', kind: 'deduction', calc: 'percent_of_basic', value: 5 }]);
  const add = useMutation({ mutationFn: () => api.post('/hr/structures', { name, components: rows }), onSuccess: () => { setName(''); void q.refetch(); } });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5">
        <Field label={t('common.name', 'Name')}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('hr.structureHint', 'e.g. Teaching staff')} />}</Field>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_8rem_5rem_auto] gap-1">
            <Input aria-label={t('common.name', 'Name')} value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Select aria-label={t('hr.kind', 'Kind')} value={r.kind} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'earning' } : x)))}><option value="earning">{t('hr.earning', 'earning')}</option><option value="deduction">{t('hr.deduction', 'deduction')}</option></Select>
            <Select aria-label={t('hr.calc', 'How')} value={r.calc} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, calc: e.target.value as 'fixed' } : x)))}><option value="percent_of_basic">{t('hr.percent', '% of basic')}</option><option value="fixed">{t('hr.fixed', 'fixed amount')}</option></Select>
            <Input aria-label={t('hr.value', 'Value')} type="number" value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: Number(e.target.value) } : x)))} />
            <Button size="sm" variant="ghost" aria-label={t('common.remove', 'Remove')} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setRows([...rows, { name: '', kind: 'earning', calc: 'fixed', value: 0 }])}><Plus className="size-3.5" /> {t('hr.addLine', 'Add a line')}</Button>
        <MutationError error={add.error} />
        <Button disabled={!name} loading={add.isPending} onClick={() => add.mutate()}>{t('common.save', 'Save')}</Button>
      </Card>
      <Card className="divide-y divide-border p-2 text-sm">
        {q.data?.map((s) => <div key={s.id} className="p-2"><b>{s.name}</b><p className="text-xs text-fg-muted">{s.components.map((c) => `${c.name} (${c.kind === 'earning' ? '+' : '−'}${c.calc === 'fixed' ? c.value : `${c.value}%`})`).join(', ')}</p></div>)}
        {!q.data?.length && <EmptyState title={t('hr.noStructures', 'No structures yet')} />}
      </Card>
    </div>
  );
}

function StaffLeave({ manage = false }: { manage?: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/hr/leaves'], queryFn: () => api.get<{ id: number; name: string; kind: string; from_date: string; to_date: string; days: number; reason: string; status: string }[]>('/hr/leaves') });
  const bal = useQuery({ queryKey: ['/hr/leave-balances'], queryFn: () => api.get<{ kind: string; entitled: number; used: number; left: number }[]>('/hr/leave-balances'), enabled: !manage });
  const [v, setV] = useState({ kind: 'casual', from_date: '', to_date: '', reason: '' });
  const add = useMutation({ mutationFn: () => api.post('/hr/leaves', v), onSuccess: () => { setV({ kind: 'casual', from_date: '', to_date: '', reason: '' }); void q.refetch(); void bal.refetch(); } });
  const decide = useMutation({ mutationFn: (x: { id: number; status: string }) => api.patch(`/hr/leaves/${x.id}`, { status: x.status }), onSuccess: () => q.refetch() });
  return (
    <div className="space-y-4">
      {!manage && (
        <Card className="space-y-3 p-4">
          {bal.data && <div className="flex flex-wrap gap-2">{bal.data.map((b) => <Badge key={b.kind} tone="info">{t(`hr.k.${b.kind}`, b.kind)}: {b.left} / {b.entitled}</Badge>)}</div>}
          <div className="grid gap-2 sm:grid-cols-4">
            <Select aria-label={t('hr.kind', 'Kind')} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{STAFF_LEAVE_KINDS.map((k) => <option key={k} value={k}>{t(`hr.k.${k}`, k)}</option>)}</Select>
            <Input aria-label={t('hr.fromDate', 'From')} type="date" value={v.from_date} onChange={(e) => setV({ ...v, from_date: e.target.value })} />
            <Input aria-label={t('hr.toDate', 'To')} type="date" value={v.to_date} onChange={(e) => setV({ ...v, to_date: e.target.value })} />
            <Input aria-label={t('hr.reason', 'Reason')} placeholder={t('hr.reason', 'Reason')} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </div>
          <MutationError error={add.error} />
          <Button size="sm" disabled={!v.from_date || !v.to_date} loading={add.isPending} onClick={() => add.mutate()}>{t('hr.request', 'Request leave')}</Button>
        </Card>
      )}
      <MutationError error={decide.error} />
      <DataTable rows={q.data} loading={q.isPending} error={q.error} rowKey={(r) => r.id} empty={t('hr.noLeave', 'No leave requests')} columns={[
        ...(manage ? [{ key: 'n', header: t('common.name', 'Name'), cell: (r: { name: string }) => r.name }] : []),
        { key: 'k', header: t('hr.kind', 'Kind'), cell: (r) => t(`hr.k.${r.kind}`, r.kind) },
        { key: 'd', header: t('hr.dates', 'Dates'), cell: (r) => `${formatDate(r.from_date)} – ${formatDate(r.to_date)} (${r.days})` },
        { key: 's', header: t('common.status', 'Status'), cell: (r) => <StatusBadge value={r.status} /> },
        { key: 'a', header: '', cell: (r) => r.status === 'pending' && (manage ? (
          <span className="flex gap-1"><Button size="sm" onClick={() => decide.mutate({ id: r.id, status: 'approved' })}>{t('hr.approveShort', 'Approve')}</Button><Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, status: 'rejected' })}>{t('hr.reject', 'Reject')}</Button></span>
        ) : <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, status: 'cancelled' })}>{t('ptm.cancel', 'Cancel')}</Button>) },
      ]} />
    </div>
  );
}

/** Staff: my payslips and my leave. */
export function MyHrPage() {
  const { t } = useTranslation();
  const slips = useQuery({ queryKey: ['/hr/payslips/mine'], queryFn: () => api.get<{ id: number; month: string; gross: number; net: number; deductions: { name: string; amount: number }[] }[]>('/hr/payslips/mine') });
  return (
    <>
      <PageHeader title={t('nav.myHr', 'Pay & leave')} />
      <Tabs tabs={[
        { id: 'pay', label: t('hr.payslips', 'Payslips'), content: () => <DataTable rows={slips.data} loading={slips.isPending} error={slips.error} rowKey={(r) => r.id} empty={t('hr.noSlips', 'No payslips yet')} columns={[
          { key: 'm', header: t('hr.month', 'Month'), cell: (r) => r.month },
          { key: 'g', header: t('hr.gross', 'Gross'), cell: (r) => formatMoney(r.gross) },
          { key: 'n', header: t('hr.net', 'Net'), cell: (r) => <b>{formatMoney(r.net)}</b> },
          { key: 'p', header: '', cell: (r) => <Button size="sm" variant="outline" onClick={() => api.download(`/hr/payslips/${r.id}/pdf`, `payslip-${r.month}.pdf`)}><FileText className="size-3.5" /> PDF</Button> },
        ]} /> },
        { id: 'leave', label: t('hr.leave', 'Leave'), content: () => <StaffLeave /> },
      ]} />
    </>
  );
}

// ---------------------------------------------------------------- transport and hostel

export function TransportPage() {
  const { t } = useTranslation();
  const vehicles = useQuery({ queryKey: ['/transport/vehicles'], queryFn: () => api.get<{ id: number; registration: string; capacity: number; driver_name: string; driver_phone: string }[]>('/transport/vehicles') });
  const routes = useQuery({ queryKey: ['/transport/routes'], queryFn: () => api.get<{ id: number; name: string; registration: string | null; capacity: number | null; riders: number; fee: number; stops: { name: string; time: string }[] }[]>('/transport/routes') });
  const riders = useQuery({ queryKey: ['/transport/assignments'], queryFn: () => api.get<{ id: number; student: string; roll_no: string | null; section: string | null; route: string; stop: string }[]>('/transport/assignments') });
  const [veh, setVeh] = useState({ registration: '', capacity: '30', driver_name: '', driver_phone: '' });
  const [route, setRoute] = useState({ name: '', vehicle_id: '', fee: '', stops: '' });
  const [assign, setAssign] = useState<{ student: number | null; route_id: string; stop: string }>({ student: null, route_id: '', stop: '' });
  const addVeh = useMutation({ mutationFn: () => api.post('/transport/vehicles', { ...veh, capacity: Number(veh.capacity) }), onSuccess: () => { setVeh({ registration: '', capacity: '30', driver_name: '', driver_phone: '' }); void vehicles.refetch(); } });
  const addRoute = useMutation({ mutationFn: () => api.post('/transport/routes', { name: route.name, vehicle_id: route.vehicle_id ? Number(route.vehicle_id) : null, fee: Number(route.fee || 0), stops: route.stops.split('\n').filter(Boolean).map((l) => { const [name, time] = l.split('@').map((x) => x.trim()); return { name: name!, time: time ?? '' }; }) }), onSuccess: () => { setRoute({ name: '', vehicle_id: '', fee: '', stops: '' }); void routes.refetch(); } });
  const addRider = useMutation({ mutationFn: () => api.post('/transport/assignments', { student_id: assign.student, route_id: Number(assign.route_id), stop: assign.stop, from_date: new Date().toISOString().slice(0, 10) }), onSuccess: () => { void riders.refetch(); void routes.refetch(); } });
  return (
    <>
      <PageHeader title={t('nav.transport', 'Transport')} />
      <Tabs tabs={[
        { id: 'routes', label: t('tr.routes', 'Routes'), content: () => (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2 p-4">
              <Field label={t('tr.routeName', 'Route')}>{(a) => <Input {...a} value={route.name} onChange={(e) => setRoute({ ...route, name: e.target.value })} />}</Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('tr.vehicle', 'Vehicle')} optional>{(a) => <Select {...a} value={route.vehicle_id} onChange={(e) => setRoute({ ...route, vehicle_id: e.target.value })}><option value="">—</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}</Select>}</Field>
                <Field label={t('tr.fee', 'Monthly fee')}>{(a) => <Input {...a} type="number" min={0} value={route.fee} onChange={(e) => setRoute({ ...route, fee: e.target.value })} />}</Field>
              </div>
              <Field label={t('tr.stops', 'Stops (one per line: name @ 07:15)')} optional>{(a) => <Textarea {...a} rows={3} value={route.stops} onChange={(e) => setRoute({ ...route, stops: e.target.value })} />}</Field>
              <MutationError error={addRoute.error} />
              <Button size="sm" disabled={!route.name} loading={addRoute.isPending} onClick={() => addRoute.mutate()}>{t('common.add', 'Add')}</Button>
            </Card>
            <Card className="divide-y divide-border p-2 text-sm">{routes.data?.map((r) => <div key={r.id} className="p-2"><b>{r.name}</b> · {r.registration ?? '—'} · {t('tr.riders', '{{n}} riders', { n: r.riders })}{r.capacity ? ` / ${r.capacity}` : ''} · {formatMoney(r.fee)}<p className="text-xs text-fg-muted">{r.stops.map((s) => `${s.name}${s.time ? ` ${s.time}` : ''}`).join(' → ')}</p></div>)}</Card>
          </div>
        ) },
        { id: 'riders', label: t('tr.riders2', 'Students'), content: () => (
          <div className="space-y-3">
            <Card className="grid gap-2 p-4 sm:grid-cols-4 sm:items-end">
              <StudentPicker label={t('common.student', 'Student')} value={assign.student} onChange={(id) => setAssign({ ...assign, student: id })} />
              <Field label={t('tr.routeName', 'Route')}>{(a) => <Select {...a} value={assign.route_id} onChange={(e) => setAssign({ ...assign, route_id: e.target.value })}><option value="">—</option>{routes.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}</Field>
              <Field label={t('tr.stop', 'Stop')} optional>{(a) => <Input {...a} value={assign.stop} onChange={(e) => setAssign({ ...assign, stop: e.target.value })} />}</Field>
              <Button disabled={!assign.student || !assign.route_id} loading={addRider.isPending} onClick={() => addRider.mutate()}>{t('tr.assign', 'Assign')}</Button>
              <MutationError error={addRider.error} />
            </Card>
            <DataTable rows={riders.data} loading={riders.isPending} error={riders.error} rowKey={(r) => r.id} columns={[
              { key: 's', header: t('common.student', 'Student'), cell: (r) => `${r.student}${r.section ? ` · ${r.section}` : ''}` },
              { key: 'r', header: t('tr.routeName', 'Route'), cell: (r) => r.route },
              { key: 'p', header: t('tr.stop', 'Stop'), cell: (r) => r.stop || '—' },
            ]} />
          </div>
        ) },
        { id: 'vehicles', label: t('tr.vehicles', 'Vehicles'), content: () => (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2 p-4">
              <Field label={t('tr.reg', 'Registration')}>{(a) => <Input {...a} value={veh.registration} onChange={(e) => setVeh({ ...veh, registration: e.target.value })} />}</Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label={t('tr.capacity', 'Seats')}>{(a) => <Input {...a} type="number" value={veh.capacity} onChange={(e) => setVeh({ ...veh, capacity: e.target.value })} />}</Field>
                <Field label={t('tr.driver', 'Driver')} optional>{(a) => <Input {...a} value={veh.driver_name} onChange={(e) => setVeh({ ...veh, driver_name: e.target.value })} />}</Field>
                <Field label={t('tr.phone', 'Phone')} optional>{(a) => <Input {...a} type="tel" value={veh.driver_phone} onChange={(e) => setVeh({ ...veh, driver_phone: e.target.value })} />}</Field>
              </div>
              <MutationError error={addVeh.error} />
              <Button size="sm" disabled={!veh.registration} loading={addVeh.isPending} onClick={() => addVeh.mutate()}>{t('common.add', 'Add')}</Button>
            </Card>
            <Card className="divide-y divide-border p-2 text-sm">{vehicles.data?.map((v) => <div key={v.id} className="p-2"><b>{v.registration}</b> · {v.capacity} · {v.driver_name} {v.driver_phone}</div>)}</Card>
          </div>
        ) },
        { id: 'bill', label: t('tr.bill', 'Fees'), content: () => <BillModule kind="transport" /> },
      ]} />
    </>
  );
}

function BillModule({ kind }: { kind: 'transport' | 'hostel' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [v, setV] = useState({ month: new Date().toISOString().slice(0, 7), due_date: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) });
  const m = useMutation({ mutationFn: () => api.post<{ invoices: number; skipped: number }>('/modules/bill', { kind, ...v }), onSuccess: (r) => toast('success', t('tr.billed', '{{n}} invoices created ({{s}} already billed)', { n: r.invoices, s: r.skipped })) });
  return (
    <Card className="max-w-md space-y-3 p-5">
      <p className="text-sm text-fg-muted">{t('tr.billHelp', 'Creates one invoice per student for the month, with the route or room fee. Running it again skips students already billed.')}</p>
      <Field label={t('hr.month', 'Month')}>{(a) => <Input {...a} type="month" value={v.month} onChange={(e) => setV({ ...v, month: e.target.value })} />}</Field>
      <Field label={t('tr.due', 'Due date')}>{(a) => <Input {...a} type="date" value={v.due_date} onChange={(e) => setV({ ...v, due_date: e.target.value })} />}</Field>
      <MutationError error={m.error} />
      <Button loading={m.isPending} onClick={() => m.mutate()}>{t('tr.createInvoices', 'Create invoices')}</Button>
    </Card>
  );
}

export function HostelPage() {
  const { t } = useTranslation();
  const rooms = useQuery({ queryKey: ['/hostel/rooms'], queryFn: () => api.get<{ id: number; hostel: string; name: string; capacity: number; occupied: number; fee: number; residents: { id: number; student: string; from_date: string }[] | null }[]>('/hostel/rooms') });
  const [v, setV] = useState({ hostel: '', name: '', capacity: '2', fee: '' });
  const [alloc, setAlloc] = useState<{ room: number; student: number | null } | null>(null);
  const add = useMutation({ mutationFn: () => api.post('/hostel/rooms', { ...v, capacity: Number(v.capacity), fee: Number(v.fee || 0) }), onSuccess: () => { setV({ ...v, name: '' }); void rooms.refetch(); } });
  const place = useMutation({ mutationFn: () => api.post('/hostel/allocations', { room_id: alloc!.room, student_id: alloc!.student, from_date: new Date().toISOString().slice(0, 10) }), onSuccess: () => { setAlloc(null); void rooms.refetch(); } });
  const end = useMutation({ mutationFn: (id: number) => api.post(`/hostel/allocations/${id}/end`), onSuccess: () => rooms.refetch() });
  return (
    <>
      <PageHeader title={t('nav.hostel', 'Hostel')} />
      <Tabs tabs={[
        { id: 'rooms', label: t('hs.rooms', 'Rooms'), content: () => (
          <div className="space-y-4">
            <Card className="grid gap-2 p-4 sm:grid-cols-5 sm:items-end">
              <Field label={t('hs.hostel', 'Hostel')}>{(a) => <Input {...a} value={v.hostel} onChange={(e) => setV({ ...v, hostel: e.target.value })} />}</Field>
              <Field label={t('hs.room', 'Room')}>{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
              <Field label={t('hs.beds', 'Beds')}>{(a) => <Input {...a} type="number" min={1} value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} />}</Field>
              <Field label={t('tr.fee', 'Monthly fee')}>{(a) => <Input {...a} type="number" min={0} value={v.fee} onChange={(e) => setV({ ...v, fee: e.target.value })} />}</Field>
              <Button disabled={!v.hostel || !v.name} loading={add.isPending} onClick={() => add.mutate()}>{t('common.add', 'Add')}</Button>
            </Card>
            <MutationError error={add.error ?? place.error} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.data?.map((r) => (
                <Card key={r.id} className="space-y-2 p-4 text-sm">
                  <div className="flex justify-between"><b>{r.hostel} · {r.name}</b><Badge tone={r.occupied >= r.capacity ? 'warning' : 'success'}>{r.occupied} / {r.capacity}</Badge></div>
                  <ul>{r.residents?.map((x) => <li key={x.id} className="flex items-center justify-between">{x.student}<Button size="sm" variant="ghost" onClick={() => end.mutate(x.id)}><LogOut className="size-3.5" /> {t('hs.leave', 'Leaves')}</Button></li>)}</ul>
                  {r.occupied < r.capacity && <Button size="sm" variant="outline" onClick={() => setAlloc({ room: r.id, student: null })}>{t('hs.place', 'Give a bed')}</Button>}
                </Card>
              ))}
            </div>
          </div>
        ) },
        { id: 'bill', label: t('tr.bill', 'Fees'), content: () => <BillModule kind="hostel" /> },
      ]} />
      {alloc && (
        <Dialog open onClose={() => setAlloc(null)} title={t('hs.place', 'Give a bed')}>
          <div className="space-y-3"><StudentPicker label={t('common.student', 'Student')} value={alloc.student} onChange={(id) => setAlloc({ ...alloc, student: id })} /><Button disabled={!alloc.student} loading={place.isPending} onClick={() => place.mutate()}>{t('common.save', 'Save')}</Button></div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------- inventory and visitors

export function InventoryPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const d = useDebounced(q);
  const list = usePagedList<{ id: number; name: string; sku: string; category: string; unit: string; quantity: number; reorder_level: number; location: string; is_asset: boolean; asset_tag: string | null; assigned_name: string | null; condition: string }>('/inventory/items', { q: d || undefined, low: low ? 'true' : undefined });
  const [v, setV] = useState({ name: '', category: '', unit: 'pcs', quantity: '0', reorder_level: '0', location: '', is_asset: false, asset_tag: '' });
  const [move, setMove] = useState<{ id: number; name: string; change: string; reason: string } | null>(null);
  const add = useMutation({ mutationFn: () => api.post('/inventory/items', { ...v, quantity: Number(v.quantity), reorder_level: Number(v.reorder_level), asset_tag: v.asset_tag || null }), onSuccess: () => { setV({ ...v, name: '', asset_tag: '' }); void list.refetch(); } });
  const doMove = useMutation({ mutationFn: () => api.post(`/inventory/items/${move!.id}/move`, { change: Number(move!.change), reason: move!.reason }), onSuccess: () => { setMove(null); void list.refetch(); } });
  return (
    <>
      <PageHeader title={t('nav.inventory', 'Inventory & assets')} />
      <Card className="mb-4 grid gap-2 p-4 sm:grid-cols-6 sm:items-end">
        <Field label={t('common.name', 'Name')} className="sm:col-span-2">{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label={t('inv.category', 'Category')} optional>{(a) => <Input {...a} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />}</Field>
        {v.is_asset ? <Field label={t('inv.tag', 'Asset tag')}>{(a) => <Input {...a} value={v.asset_tag} onChange={(e) => setV({ ...v, asset_tag: e.target.value })} />}</Field> : <Field label={t('inv.qty', 'Quantity')}>{(a) => <Input {...a} type="number" min={0} value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} />}</Field>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.is_asset} onChange={(e) => setV({ ...v, is_asset: e.target.checked })} /> {t('inv.asset', 'Asset (tracked one by one)')}</label>
        <Button disabled={!v.name} loading={add.isPending} onClick={() => add.mutate()}>{t('common.add', 'Add')}</Button>
      </Card>
      <MutationError error={add.error} />
      <div className="mb-3 flex flex-wrap gap-2"><Input aria-label={t('common.search', 'Search')} placeholder={t('common.search', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> {t('inv.low', 'Running low')}</label></div>
      <DataTable rows={list.data?.rows} loading={list.isPending} error={list.error} rowKey={(r) => r.id} empty={t('inv.empty', 'Nothing here')} columns={[
        { key: 'n', header: t('common.name', 'Name'), cell: (r) => <span className="font-medium">{r.name}<span className="block text-xs text-fg-muted">{r.category}{r.asset_tag ? ` · ${r.asset_tag}` : ''}</span></span> },
        { key: 'q', header: t('inv.qty', 'Quantity'), cell: (r) => (r.is_asset ? <Badge>{r.condition.replace('_', ' ')}</Badge> : <span className={r.quantity <= r.reorder_level ? 'font-semibold text-danger' : ''}>{r.quantity} {r.unit}</span>) },
        { key: 'w', header: t('inv.where', 'Where / who'), cell: (r) => r.assigned_name ?? r.location ?? '—', hideOnMobile: true },
        { key: 'a', header: '', cell: (r) => !r.is_asset && <Button size="sm" variant="outline" onClick={() => setMove({ id: r.id, name: r.name, change: '', reason: '' })}>{t('inv.move', 'In / out')}</Button> },
      ]} />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {move && (
        <Dialog open onClose={() => setMove(null)} title={move.name}>
          <div className="space-y-3">
            <Field label={t('inv.change', 'Change (+ in, − out)')}>{(a) => <Input {...a} type="number" value={move.change} onChange={(e) => setMove({ ...move, change: e.target.value })} />}</Field>
            <Field label={t('hr.reason', 'Reason')} optional>{(a) => <Input {...a} value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />}</Field>
            <MutationError error={doMove.error} />
            <Button disabled={!Number(move.change)} loading={doMove.isPending} onClick={() => doMove.mutate()}>{t('common.save', 'Save')}</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function VisitorsPage() {
  const { t } = useTranslation();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const q = useQuery({ queryKey: ['/visitors', day], queryFn: () => api.get<{ id: number; name: string; phone: string; purpose: string; host: string | null; student: string | null; pass_code: string; check_in: string; check_out: string | null }[]>('/visitors', { date: day }) });
  const [v, setV] = useState<{ name: string; phone: string; purpose: string; host: number | null }>({ name: '', phone: '', purpose: '', host: null });
  const add = useMutation({ mutationFn: () => api.post<{ pass_code: string }>('/visitors', { name: v.name, phone: v.phone, purpose: v.purpose, host_user_id: v.host }), onSuccess: () => { setV({ name: '', phone: '', purpose: '', host: null }); void q.refetch(); } });
  const out = useMutation({ mutationFn: (id: number) => api.post(`/visitors/${id}/checkout`), onSuccess: () => q.refetch() });
  return (
    <>
      <PageHeader title={t('nav.visitors', 'Visitors')} />
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <Card className="h-fit space-y-3 p-4">
          <Field label={t('vis.name', 'Visitor')}>{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
          <Field label={t('tr.phone', 'Phone')} optional>{(a) => <Input {...a} type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}</Field>
          <Field label={t('vis.purpose', 'Purpose')}>{(a) => <Input {...a} value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })} />}</Field>
          <PersonPicker label={t('vis.host', 'Meeting (optional)')} value={v.host} onChange={(id) => setV({ ...v, host: id })} />
          <MutationError error={add.error} />
          <Button disabled={!v.name || !v.purpose} loading={add.isPending} onClick={() => add.mutate()}>{t('vis.checkIn', 'Check in & print pass')}</Button>
          {add.data && <Alert tone="success">{t('vis.pass', 'Gate pass: {{code}}', { code: add.data.pass_code })}</Alert>}
        </Card>
        <div>
          <Input type="date" aria-label={t('common.date', 'Date')} value={day} onChange={(e) => setDay(e.target.value)} className="mb-3 w-48" />
          <DataTable rows={q.data} loading={q.isPending} error={q.error} rowKey={(r) => r.id} empty={t('vis.none', 'No visitors')} columns={[
            { key: 'n', header: t('vis.name', 'Visitor'), cell: (r) => <span>{r.name}<span className="block text-xs text-fg-muted">{r.purpose}{r.host ? ` · ${r.host}` : ''}</span></span> },
            { key: 'p', header: t('vis.passShort', 'Pass'), cell: (r) => <code>{r.pass_code}</code> },
            { key: 'i', header: t('vis.in', 'In'), cell: (r) => formatDateTime(r.check_in).slice(-5) },
            { key: 'o', header: t('vis.out', 'Out'), cell: (r) => (r.check_out ? formatDateTime(r.check_out).slice(-5) : <Button size="sm" variant="outline" onClick={() => out.mutate(r.id)}>{t('vis.checkOut', 'Check out')}</Button>) },
          ]} />
        </div>
      </div>
    </>
  );
}

/** Students and guardians: library books and the school bus. */
export function MyServicesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const loans = useQuery({ queryKey: ['/library/my-loans'], queryFn: () => api.get<{ id: number; title: string; due_on: string; returned_at: string | null; overdue: boolean; fine: number; fine_paid: boolean; borrower: string }[]>('/library/my-loans').catch(() => null) });
  const bus = useQuery({ queryKey: ['/transport/mine'], queryFn: () => api.get<{ student: string; route: string; stop: string; registration: string | null; driver_name: string | null; driver_phone: string | null; stops: { name: string; time: string }[] }[]>('/transport/mine').catch(() => null) });
  const renew = useMutation({ mutationFn: (id: number) => api.post(`/library/loans/${id}/renew`), onSuccess: () => loans.refetch() });
  return (
    <>
      <PageHeader title={t('nav.services', 'Library & transport')} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">{t('nav.library', 'Library')}</h2>
          {loans.data === null ? <p className="text-sm text-fg-muted">{t('mod.off', 'Not used at your institution')}</p> : !loans.data?.length ? <EmptyState title={t('lib.noLoans', 'No books on loan')} /> : (
            <ul className="divide-y divide-border text-sm">{loans.data.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{l.title}{user?.role === 'parent' && <span className="text-fg-muted"> · {l.borrower}</span>}<span className={`block text-xs ${l.overdue ? 'text-danger' : 'text-fg-muted'}`}>{l.returned_at ? t('lib.returnedOn', 'returned') : t('lib.dueOn', 'due {{d}}', { d: formatDate(l.due_on) })}{l.fine > 0 && !l.fine_paid ? ` · ${t('lib.fineDue', 'fine {{f}}', { f: formatMoney(l.fine) })}` : ''}</span></span>{!l.returned_at && !l.overdue && user?.role !== 'parent' && <Button size="sm" variant="ghost" onClick={() => renew.mutate(l.id)}>{t('lib.renew', 'Renew')}</Button>}</li>)}</ul>
          )}
          <MutationError error={renew.error} />
        </Card>
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">{t('nav.transport', 'Transport')}</h2>
          {bus.data === null ? <p className="text-sm text-fg-muted">{t('mod.off', 'Not used at your institution')}</p> : !bus.data?.length ? <EmptyState title={t('tr.none', 'No school transport')} /> : bus.data.map((b, i) => (
            <div key={i} className="text-sm"><b>{b.student}</b>: {b.route}{b.stop ? ` · ${b.stop}` : ''}<p className="text-xs text-fg-muted">{b.registration} · {b.driver_name} {b.driver_phone}</p><p className="text-xs">{b.stops.map((s) => `${s.name}${s.time ? ` ${s.time}` : ''}`).join(' → ')}</p></div>
          ))}
        </Card>
      </div>
    </>
  );
}

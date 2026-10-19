// Finance set-up and back office: fee structures (with invoice generation), discounts and
// scholarships, expenses, reconciliation, reports and exports, and settings (fee visibility,
// reminders, payment providers and the bank account on vouchers).
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, FileUp, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useChannels } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, ConfirmDialog, CopyButton, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, Pager, Select, Spinner, useToast } from '@/components/ui';
import { DownloadButton, StudentSearch, thisMonth, useInvalidate, useStructure } from './common';

// ---------------------------------------------------------------- fee structures

interface StructureRow {
  id: number;
  name: string;
  academic_year: string | null;
  campus: string | null;
  program: string | null;
  level: string | null;
  per_installment: string;
  one_time: string;
  installments: number;
  invoices: number;
  active: boolean;
}
interface StructureDetail {
  id: number;
  name: string;
  academic_year_id: number | null;
  campus_id: number | null;
  program_id: number | null;
  program_level_id: number | null;
  late_fine: { kind: string; amount?: number; grace_days?: number; max?: number };
  active: boolean;
  items: { head: string; amount: string; frequency: string }[];
  installments: { id: number; label: string; due_date: string; invoices: number }[];
}

export function StructuresTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['/finance/structures'], queryFn: () => api.get<StructureRow[]>('/finance/structures') });
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const [generate, setGenerate] = useState<StructureRow | null>(null);
  return (
    <div className="space-y-4">
      {can('fees.setup') && (
        <div className="flex justify-end">
          <Button onClick={() => setEdit('new')}>
            <Plus className="size-4" /> {t('fees.newStructure', 'New fee structure')}
          </Button>
        </div>
      )}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Spinner />
      ) : q.data.length === 0 ? (
        <EmptyState title={t('fees.noStructures', 'No fee structures yet')} description={t('fees.noStructuresHelp', 'A structure says what a group of students pays (tuition, admission, exam…) and when, in instalments.')} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{s.name}</h3>
                  <p className="text-xs text-fg-muted">{[s.academic_year, s.campus, s.program, s.level].filter(Boolean).join(' · ') || t('fees.everyone', 'All students')}</p>
                </div>
                {!s.active && <Badge>{t('common.off', 'Off')}</Badge>}
              </div>
              <div className="text-sm">
                {t('fees.perInstalment', '{{amount}} per instalment × {{n}}', { amount: formatMoney(s.per_installment), n: s.installments })}
                {Number(s.one_time) > 0 && <span className="text-fg-muted"> + {formatMoney(s.one_time)} {t('fees.once', 'once')}</span>}
              </div>
              <div className="text-xs text-fg-muted">{t('fees.invoicesCount', '{{n}} invoices', { n: s.invoices })}</div>
              {can('fees.setup') && (
                <div className="mt-auto flex gap-2">
                  <Button size="sm" onClick={() => setGenerate(s)}>
                    <Wand2 className="size-4" /> {t('fees.generate', 'Generate invoices')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(s.id)} aria-label={t('common.edit', 'Edit')}>
                    <Pencil className="size-4" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {edit && <StructureEditor id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {generate && <GenerateDialog s={generate} onClose={() => setGenerate(null)} />}
    </div>
  );
}

function StructureEditor({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const structure = useStructure();
  const existing = useQuery({ queryKey: [`/finance/structures/${id}`], queryFn: () => api.get<StructureDetail>(`/finance/structures/${id}`), enabled: !!id });
  const [v, setV] = useState<StructureDetail | null>(null);
  const cur: StructureDetail =
    v ??
    existing.data ?? {
      id: 0,
      name: '',
      academic_year_id: structure.data?.academic_years.find((y) => y.is_current)?.id ?? null,
      campus_id: null,
      program_id: null,
      program_level_id: null,
      late_fine: { kind: 'none' },
      active: true,
      items: [{ head: 'Tuition', amount: '', frequency: 'per_installment' }],
      installments: [{ id: 0, label: 'First instalment', due_date: todayISO(), invoices: 0 }],
    };
  const set = (patch: Partial<StructureDetail>) => setV({ ...cur, ...patch });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: cur.name,
        academic_year_id: cur.academic_year_id,
        campus_id: cur.campus_id,
        program_id: cur.program_id,
        program_level_id: cur.program_level_id,
        late_fine: cur.late_fine.kind === 'none' ? { kind: 'none' } : { ...cur.late_fine, amount: Number(cur.late_fine.amount ?? 0), grace_days: Number(cur.late_fine.grace_days ?? 0), ...(cur.late_fine.max ? { max: Number(cur.late_fine.max) } : {}) },
        active: cur.active,
        items: cur.items.map((i) => ({ ...i, amount: Number(i.amount) })),
        installments: cur.installments.map((i) => ({ ...(i.id ? { id: i.id } : {}), label: i.label, due_date: i.due_date })),
      };
      return id ? api.put(`/finance/structures/${id}`, body) : api.post('/finance/structures', body);
    },
    onSuccess: async () => {
      await invalidate('/finance/structures');
      onClose();
    },
  });
  const program = structure.data?.programs.find((p) => p.id === cur.program_id);
  if (id && !existing.data) return <Dialog open onClose={onClose} title={t('fees.structure', 'Fee structure')}><Spinner /></Dialog>;
  return (
    <Dialog open onClose={onClose} title={id ? cur.name : t('fees.newStructure', 'New fee structure')} className="max-w-3xl">
      <div className="space-y-5">
        <Field label={t('common.name', 'Name')}>{(a) => <Input {...a} value={cur.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('fees.structureExample', 'e.g. Class 1–5 fees 2026–27')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('common.year', 'Academic year')} optional>
            {(a) => (
              <Select {...a} value={cur.academic_year_id ?? ''} onChange={(e) => set({ academic_year_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{t('common.any', 'Any')}</option>
                {structure.data?.academic_years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('common.campus', 'Campus')} optional>
            {(a) => (
              <Select {...a} value={cur.campus_id ?? ''} onChange={(e) => set({ campus_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{t('common.any', 'Any')}</option>
                {structure.data?.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('common.program', 'Program')} optional>
            {(a) => (
              <Select {...a} value={cur.program_id ?? ''} onChange={(e) => set({ program_id: e.target.value ? Number(e.target.value) : null, program_level_id: null })}>
                <option value="">{t('common.any', 'Any')}</option>
                {structure.data?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('common.level', 'Level')} optional>
            {(a) => (
              <Select {...a} value={cur.program_level_id ?? ''} disabled={!program} onChange={(e) => set({ program_level_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{t('common.any', 'Any')}</option>
                {program?.levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('fees.heads', 'Fee heads')}</h3>
          <div className="space-y-2">
            {cur.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_9rem_auto] gap-2">
                <Input aria-label={t('fees.head', 'Fee head')} value={it.head} onChange={(e) => set({ items: cur.items.map((x, j) => (j === i ? { ...x, head: e.target.value } : x)) })} />
                <Input aria-label={t('fees.amount', 'Amount')} type="number" inputMode="decimal" value={it.amount} onChange={(e) => set({ items: cur.items.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} />
                <Select aria-label={t('fees.frequency', 'How often')} value={it.frequency} onChange={(e) => set({ items: cur.items.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)) })}>
                  <option value="per_installment">{t('fees.everyInstalment', 'Every instalment')}</option>
                  <option value="once">{t('fees.firstOnly', 'Once (first)')}</option>
                </Select>
                <Button variant="ghost" size="icon" aria-label={t('common.remove', 'Remove')} onClick={() => set({ items: cur.items.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => set({ items: [...cur.items, { head: '', amount: '', frequency: 'per_installment' }] })}>
              <Plus className="size-4" /> {t('fees.addHead', 'Add a fee head')}
            </Button>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('fees.instalments', 'Instalments')}</h3>
          <div className="space-y-2">
            {cur.installments.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_10rem_auto] gap-2">
                <Input aria-label={t('common.name', 'Name')} value={it.label} onChange={(e) => set({ installments: cur.installments.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <Input aria-label={t('fees.dueDate', 'Due')} type="date" value={it.due_date} onChange={(e) => set({ installments: cur.installments.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)) })} />
                <Button variant="ghost" size="icon" disabled={it.invoices > 0} aria-label={t('common.remove', 'Remove')} onClick={() => set({ installments: cur.installments.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => set({ installments: [...cur.installments, { id: 0, label: `${t('fees.instalment', 'Instalment')} ${cur.installments.length + 1}`, due_date: todayISO(), invoices: 0 }] })}>
              <Plus className="size-4" /> {t('fees.addInstalment', 'Add an instalment')}
            </Button>
          </div>
        </section>
        <section className="grid gap-3 sm:grid-cols-4">
          <Field label={t('fees.lateFine', 'Late fine')}>
            {(a) => (
              <Select {...a} value={cur.late_fine.kind} onChange={(e) => set({ late_fine: { ...cur.late_fine, kind: e.target.value } })}>
                <option value="none">{t('fees.noFine', 'None')}</option>
                <option value="flat">{t('fees.flatFine', 'Once, after the due date')}</option>
                <option value="per_day">{t('fees.perDayFine', 'Per day late')}</option>
              </Select>
            )}
          </Field>
          {cur.late_fine.kind !== 'none' && (
            <>
              <Field label={t('fees.amount', 'Amount')}>{(a) => <Input {...a} type="number" value={cur.late_fine.amount ?? ''} onChange={(e) => set({ late_fine: { ...cur.late_fine, amount: Number(e.target.value) } })} />}</Field>
              <Field label={t('fees.graceDays', 'Days of grace')}>{(a) => <Input {...a} type="number" value={cur.late_fine.grace_days ?? 0} onChange={(e) => set({ late_fine: { ...cur.late_fine, grace_days: Number(e.target.value) } })} />}</Field>
              {cur.late_fine.kind === 'per_day' && <Field label={t('fees.maxFine', 'At most')} optional>{(a) => <Input {...a} type="number" value={cur.late_fine.max ?? ''} onChange={(e) => set({ late_fine: { ...cur.late_fine, max: Number(e.target.value) || undefined } })} />}</Field>}
            </>
          )}
        </section>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cur.active} onChange={(e) => set({ active: e.target.checked })} /> {t('fees.structureActive', 'In use')}
        </label>
        <MutationError error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button loading={save.isPending} disabled={!cur.name} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

interface Plan {
  students: number;
  invoices: number;
  already: number;
  total: number;
  preview?: { student_id: number; name: string; label: string; due_date: string; total: number; lines: { label: string; amount: number }[] }[];
  created?: number;
}

function GenerateDialog({ s, onClose }: { s: StructureRow; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const toast = useToast();
  const detail = useQuery({ queryKey: [`/finance/structures/${s.id}`], queryFn: () => api.get<StructureDetail>(`/finance/structures/${s.id}`) });
  const [insts, setInsts] = useState<number[]>([]);
  const body = { installment_ids: insts.length ? insts : undefined };
  const preview = useQuery({ queryKey: ['generate-preview', s.id, insts], queryFn: () => api.post<Plan>(`/finance/structures/${s.id}/generate`, body) });
  const commit = useMutation({
    mutationFn: () => api.post<Plan>(`/finance/structures/${s.id}/generate`, { ...body, commit: true }),
    onSuccess: async (r) => {
      await invalidate('/finance');
      toast('success', t('fees.generated', '{{n}} invoices created', { n: r.created }));
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t('fees.generateFor', 'Generate invoices: {{name}}', { name: s.name })} className="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {detail.data?.installments.map((i) => (
            <label key={i.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={insts.includes(i.id)} onChange={(e) => setInsts(e.target.checked ? [...insts, i.id] : insts.filter((x) => x !== i.id))} />
              {i.label} <span className="text-fg-muted">({formatDate(i.due_date)})</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-fg-muted">{t('fees.generateHelp', 'Leave all unticked for every instalment. Discounts and scholarships are applied; students who already have an invoice are skipped.')}</p>
        {preview.error ? (
          <ErrorState error={preview.error} />
        ) : !preview.data ? (
          <Spinner />
        ) : (
          <>
            <Alert tone="info">
              {t('fees.generateSummary', '{{invoices}} new invoices for {{students}} students, {{total}} in all. {{already}} already exist.', {
                invoices: preview.data.invoices,
                students: preview.data.students,
                total: formatMoney(preview.data.total),
                already: preview.data.already,
              })}
            </Alert>
            <ul className="max-h-60 divide-y divide-border overflow-y-auto text-sm">
              {preview.data.preview?.map((p, i) => (
                <li key={i} className="flex justify-between gap-2 py-1.5">
                  <span>
                    {p.name} <span className="text-fg-muted">· {p.label}</span>
                    {p.lines.some((l) => l.amount < 0) && <Badge tone="success" className="ms-1">{t('fees.discounted', 'discount')}</Badge>}
                  </span>
                  <span className="tabular-nums">{formatMoney(p.total)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <MutationError error={commit.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button loading={commit.isPending} disabled={!preview.data?.invoices} onClick={() => commit.mutate()}>
            {t('fees.createN', 'Create {{n}} invoices', { n: preview.data?.invoices ?? 0 })}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- discounts

interface DiscountRow {
  id: number;
  name: string;
  kind: string;
  method: string;
  value: string;
  heads: string[];
  sibling_from: number | null;
  active: boolean;
  students: number;
}

export function DiscountsTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const q = useQuery({ queryKey: ['/finance/discounts'], queryFn: () => api.get<DiscountRow[]>('/finance/discounts') });
  const [edit, setEdit] = useState<DiscountRow | 'new' | null>(null);
  const [assign, setAssign] = useState<DiscountRow | null>(null);
  const [del, setDel] = useState<DiscountRow | null>(null);
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/finance/discounts/${id}`), onSuccess: async () => { await invalidate('/finance/discounts'); setDel(null); } });
  const kindLabel: Record<string, string> = { discount: t('fees.discount', 'Discount'), scholarship: t('fees.scholarship', 'Scholarship'), sibling: t('fees.sibling', 'Sibling'), waiver: t('fees.waiver', 'Waiver') };
  return (
    <div className="space-y-4">
      {can('fees.setup') && (
        <div className="flex justify-end">
          <Button onClick={() => setEdit('new')}><Plus className="size-4" /> {t('fees.newDiscount', 'New discount or scholarship')}</Button>
        </div>
      )}
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.id}
        empty={t('fees.noDiscounts', 'No discounts or scholarships yet')}
        columns={[
          { key: 'name', header: t('common.name', 'Name'), cell: (d) => <span className="font-medium">{d.name} {!d.active && <Badge>{t('common.off', 'Off')}</Badge>}</span> },
          { key: 'kind', header: t('fees.kind', 'Kind'), cell: (d) => kindLabel[d.kind] ?? d.kind },
          { key: 'value', header: t('fees.value', 'Value'), cell: (d) => (d.method === 'percent' ? `${Number(d.value)}%` : formatMoney(d.value)) + (d.heads.length ? ` · ${d.heads.join(', ')}` : '') },
          { key: 'who', header: t('fees.appliesTo', 'Applies to'), cell: (d) => (d.kind === 'sibling' ? t('fees.siblingFrom', 'Child {{n}} onwards', { n: d.sibling_from }) : t('fees.studentsCount', '{{n}} students', { n: d.students })), hideOnMobile: true },
          {
            key: 'actions',
            header: '',
            cell: (d) =>
              can('fees.setup') && (
                <div className="flex justify-end gap-1">
                  {d.kind !== 'sibling' && <Button size="sm" variant="ghost" onClick={() => setAssign(d)}>{t('fees.give', 'Give to a student')}</Button>}
                  <Button size="icon" variant="ghost" aria-label={t('common.edit', 'Edit')} onClick={() => setEdit(d)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => setDel(d)}><Trash2 className="size-4" /></Button>
                </div>
              ),
          },
        ]}
      />
      {edit && <DiscountDialog d={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {assign && <AssignDiscountDialog d={assign} onClose={() => setAssign(null)} />}
      <ConfirmDialog open={!!del} title={t('fees.deleteDiscount', 'Delete {{name}}?', { name: del?.name })} confirmLabel={t('common.delete', 'Delete')} busy={remove.isPending} error={remove.error} onConfirm={() => del && remove.mutate(del.id)} onClose={() => setDel(null)}>
        {t('fees.deleteDiscountHelp', 'Invoices already issued keep their discount lines.')}
      </ConfirmDialog>
    </div>
  );
}

function DiscountDialog({ d, onClose }: { d: DiscountRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [v, setV] = useState({ name: d?.name ?? '', kind: d?.kind ?? 'discount', method: d?.method ?? 'percent', value: d?.value ?? '', heads: d?.heads.join(', ') ?? '', sibling_from: String(d?.sibling_from ?? 2), active: d?.active ?? true });
  const m = useMutation({
    mutationFn: () => {
      const body = { ...v, value: Number(v.value), heads: v.heads.split(',').map((h) => h.trim()).filter(Boolean), sibling_from: v.kind === 'sibling' ? Number(v.sibling_from) : null };
      return d ? api.put(`/finance/discounts/${d.id}`, body) : api.post('/finance/discounts', body);
    },
    onSuccess: async () => { await invalidate('/finance/discounts'); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={d ? d.name : t('fees.newDiscount', 'New discount or scholarship')}>
      <div className="space-y-4">
        <Field label={t('common.name', 'Name')}>{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('fees.kind', 'Kind')}>
            {(a) => (
              <Select {...a} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
                <option value="discount">{t('fees.discount', 'Discount')}</option>
                <option value="scholarship">{t('fees.scholarship', 'Scholarship')}</option>
                <option value="sibling">{t('fees.sibling', 'Sibling (automatic)')}</option>
                <option value="waiver">{t('fees.waiver', 'Waiver')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('fees.method', 'Method')}>
            {(a) => (
              <Select {...a} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
                <option value="percent">%</option>
                <option value="amount">{t('fees.fixedAmount', 'Fixed amount')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('fees.value', 'Value')}>{(a) => <Input {...a} type="number" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />}</Field>
        </div>
        <Field label={t('fees.onHeads', 'On these fee heads')} optional hint={t('fees.onHeadsHint', 'Comma-separated, e.g. Tuition. Empty: every head.')}>{(a) => <Input {...a} value={v.heads} onChange={(e) => setV({ ...v, heads: e.target.value })} />}</Field>
        {v.kind === 'sibling' && <Field label={t('fees.siblingFromLabel', 'From which child (2 = second child)')}>{(a) => <Input {...a} type="number" min={2} value={v.sibling_from} onChange={(e) => setV({ ...v, sibling_from: e.target.value })} />}</Field>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> {t('fees.structureActive', 'In use')}</label>
        <MutationError error={m.error} />
        <div className="flex justify-end"><Button loading={m.isPending} onClick={() => m.mutate()}>{t('common.save', 'Save')}</Button></div>
      </div>
    </Dialog>
  );
}

function AssignDiscountDialog({ d, onClose }: { d: DiscountRow; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [students, setStudents] = useState<number[]>([]);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      for (const s of students) await api.post('/finance/student-discounts', { student_id: s, discount_id: d.id, reason });
    },
    onSuccess: async () => { await invalidate('/finance/discounts'); toast('success', t('fees.given', 'Given to {{n}} students', { n: students.length })); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title={t('fees.giveNamed', 'Give {{name}}', { name: d.name })} description={t('fees.giveHelp', 'It applies to invoices generated from now on.')}>
      <div className="space-y-4">
        <Field label={t('common.students', 'Students')}>{() => <StudentSearch value={students} onChange={setStudents} multiple />}</Field>
        <Field label={t('common.reason', 'Reason')} optional>{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <MutationError error={m.error} />
        <div className="flex justify-end"><Button loading={m.isPending} disabled={!students.length} onClick={() => m.mutate()}>{t('fees.give', 'Give to a student')}</Button></div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- expenses

interface ExpenseRow { id: number; date: string; category: string; description: string; vendor: string; amount: string; method: string; campus: string | null }

export function ExpensesTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const invalidate = useInvalidate();
  const [period, setPeriod] = useState(thisMonth());
  const list = usePagedList<ExpenseRow>('/finance/expenses', period);
  const cats = useQuery({ queryKey: ['/finance/expense-categories'], queryFn: () => api.get<string[]>('/finance/expense-categories') });
  const [v, setV] = useState({ date: todayISO(), category: 'Utilities', description: '', vendor: '', amount: '', method: 'cash' });
  const add = useMutation({ mutationFn: () => api.post('/finance/expenses', { ...v, amount: Number(v.amount) }), onSuccess: async () => { await invalidate('/finance'); setV({ ...v, description: '', vendor: '', amount: '' }); } });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/finance/expenses/${id}`), onSuccess: () => invalidate('/finance') });
  return (
    <div className="space-y-4">
      {can('finance.expenses') && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">{t('fees.recordExpense', 'Record an expense')}</h3>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label={t('common.date', 'Date')}>{(a) => <Input {...a} type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />}</Field>
            <Field label={t('fees.category', 'Category')}>
              {(a) => (
                <>
                  <Input {...a} list="expense-cats" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} />
                  <datalist id="expense-cats">{cats.data?.map((c) => <option key={c} value={c} />)}</datalist>
                </>
              )}
            </Field>
            <Field label={t('fees.vendor', 'Paid to')} optional>{(a) => <Input {...a} value={v.vendor} onChange={(e) => setV({ ...v, vendor: e.target.value })} />}</Field>
            <Field label={t('fees.description', 'Description')} optional>{(a) => <Input {...a} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
            <Field label={t('fees.amount', 'Amount')}>{(a) => <Input {...a} type="number" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}</Field>
            <Field label={t('fees.method', 'Method')}>
              {(a) => (
                <Select {...a} value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
                  <option value="cash">{t('fees.cash', 'Cash')}</option>
                  <option value="bank">{t('fees.bankTransfer', 'Bank')}</option>
                  <option value="cheque">{t('fees.cheque', 'Cheque')}</option>
                  <option value="card">{t('fees.card', 'Card')}</option>
                  <option value="online">{t('fees.online', 'Online')}</option>
                </Select>
              )}
            </Field>
          </div>
          <MutationError error={add.error} />
          <div className="mt-3 flex justify-end"><Button loading={add.isPending} disabled={!v.amount} onClick={() => add.mutate()}><Plus className="size-4" /> {t('common.add', 'Add')}</Button></div>
        </Card>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.from', 'From')}>{(a) => <Input {...a} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />}</Field>
        <Field label={t('common.to', 'To')}>{(a) => <Input {...a} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />}</Field>
      </div>
      <DataTable
        rows={list.data?.rows}
        loading={list.isPending}
        error={list.error}
        onRetry={() => list.refetch()}
        rowKey={(r) => r.id}
        empty={t('fees.noExpenses', 'No expenses in this period')}
        columns={[
          { key: 'date', header: t('common.date', 'Date'), cell: (e) => formatDate(e.date) },
          { key: 'cat', header: t('fees.category', 'Category'), cell: (e) => e.category },
          { key: 'desc', header: t('fees.description', 'Description'), cell: (e) => [e.vendor, e.description].filter(Boolean).join(' — '), hideOnMobile: true },
          { key: 'amount', header: t('fees.amount', 'Amount'), cell: (e) => <span className="tabular-nums">{formatMoney(e.amount)}</span> },
          { key: 'x', header: '', cell: (e) => can('finance.expenses') && <Button size="icon" variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => remove.mutate(e.id)}><Trash2 className="size-4" /></Button> },
        ]}
      />
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </div>
  );
}

// ---------------------------------------------------------------- reconciliation

interface ReconcileResult {
  counts: { matched: number; missing_in_acadex: number; missing_at_provider: number; amount_mismatch: number };
  missing_in_acadex: { providerRef: string; reference?: string; amount: number; at: string }[];
  missing_at_provider: { receipt_no: string; provider_ref: string | null; amount: number; received_at: string }[];
  amount_mismatch: { receipt_no: string; provider_ref: string; ours: number; theirs: number }[];
}

export function ReconcileTab() {
  const { t } = useTranslation();
  const [v, setV] = useState({ provider: 'bank', ...thisMonth() });
  const [file, setFile] = useState<File | null>(null);
  const history = useQuery({ queryKey: ['/finance/reconciliations'], queryFn: () => api.get<{ id: number; provider: string; from_date: string; to_date: string; counts: ReconcileResult['counts']; created_at: string; created_by: string | null }[]>('/finance/reconciliations') });
  const invalidate = useInvalidate();
  const run = useMutation({
    mutationFn: () => (v.provider === 'bank' ? api.upload<ReconcileResult>('POST', '/finance/reconcile', file!, v) : api.post<ReconcileResult>('/finance/reconcile', v)),
    onSuccess: () => invalidate('/finance'),
  });
  const r = run.data;
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <p className="text-sm text-fg-muted">{t('fees.reconcileHelp', 'Compare what we recorded with what the provider settled, or with your bank statement (CSV or Excel with date, description, reference and credit columns). Matched payments are marked reconciled.')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('fees.provider', 'Against')}>
            {(a) => (
              <Select {...a} value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })}>
                <option value="bank">{t('fees.bankStatement', 'Bank statement')}</option>
                <option value="stripe">Stripe</option>
                <option value="jazzcash">JazzCash</option>
                <option value="easypaisa">Easypaisa</option>
                <option value="fake">{t('fees.testProvider', 'Test provider')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('common.from', 'From')}>{(a) => <Input {...a} type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />}</Field>
          <Field label={t('common.to', 'To')}>{(a) => <Input {...a} type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} />}</Field>
          {v.provider === 'bank' && (
            <Field label={t('fees.statementFile', 'Statement')}>{(a) => <Input {...a} type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
          )}
          <Button loading={run.isPending} disabled={v.provider === 'bank' && !file} onClick={() => run.mutate()}><FileUp className="size-4" /> {t('fees.reconcileRun', 'Reconcile')}</Button>
        </div>
        <MutationError error={run.error} />
      </Card>
      {r && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{t('fees.matched', '{{n}} matched', { n: r.counts.matched })}</Badge>
            <Badge tone={r.counts.missing_in_acadex ? 'danger' : 'neutral'}>{t('fees.notRecorded', '{{n}} not recorded here', { n: r.counts.missing_in_acadex })}</Badge>
            <Badge tone={r.counts.missing_at_provider ? 'warning' : 'neutral'}>{t('fees.notSettled', '{{n}} not in the statement', { n: r.counts.missing_at_provider })}</Badge>
            <Badge tone={r.counts.amount_mismatch ? 'danger' : 'neutral'}>{t('fees.mismatch', '{{n}} amounts differ', { n: r.counts.amount_mismatch })}</Badge>
          </div>
          {r.missing_in_acadex.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t('fees.notRecordedTitle', 'Received but not recorded')}</h4>
              <ul className="text-sm">{r.missing_in_acadex.map((x, i) => <li key={i}>{x.at.slice(0, 10)} · {x.providerRef} · {x.reference} · {formatMoney(x.amount)}</li>)}</ul>
            </div>
          )}
          {r.missing_at_provider.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t('fees.notSettledTitle', 'Recorded but not in the statement')}</h4>
              <ul className="text-sm">{r.missing_at_provider.map((x) => <li key={x.receipt_no}>{x.receipt_no} · {x.provider_ref ?? '—'} · {formatMoney(x.amount)}</li>)}</ul>
            </div>
          )}
          {r.amount_mismatch.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">{t('fees.mismatchTitle', 'Different amounts')}</h4>
              <ul className="text-sm">{r.amount_mismatch.map((x) => <li key={x.receipt_no}>{x.receipt_no}: {formatMoney(x.ours)} ≠ {formatMoney(x.theirs)}</li>)}</ul>
            </div>
          )}
        </Card>
      )}
      <DataTable
        rows={history.data}
        loading={history.isPending}
        error={history.error}
        rowKey={(h) => h.id}
        empty={t('fees.noReconciliations', 'No reconciliations yet')}
        columns={[
          { key: 'when', header: t('common.date', 'Date'), cell: (h) => formatDate(h.created_at) },
          { key: 'prov', header: t('fees.provider', 'Against'), cell: (h) => <span className="capitalize">{h.provider}</span> },
          { key: 'period', header: t('fees.period', 'Period'), cell: (h) => `${formatDate(h.from_date)} – ${formatDate(h.to_date)}`, hideOnMobile: true },
          { key: 'res', header: t('fees.result', 'Result'), cell: (h) => `${h.counts.matched} ✓ · ${h.counts.missing_in_acadex + h.counts.missing_at_provider + h.counts.amount_mismatch} !` },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------- reports

export function ReportsTab() {
  const { t } = useTranslation();
  const [p, setP] = useState(thisMonth());
  const qs = `from=${p.from}&to=${p.to}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.from', 'From')}>{(a) => <Input {...a} type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} />}</Field>
        <Field label={t('common.to', 'To')}>{(a) => <Input {...a} type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} />}</Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          { title: t('fees.incomeExpenseReport', 'Income and expenses'), help: t('fees.incomeExpenseHelp', 'Every receipt, refund and expense in the period.'), path: `/finance/reports/income-expense?${qs}&format=xlsx`, file: `income-expense-${p.from}.xlsx` },
          { title: t('fees.collectionsReport', 'Collections'), help: t('fees.collectionsHelp', 'Receipts with payer, invoice and method.'), path: `/finance/export/collections?${qs}&format=xlsx`, file: `collections-${p.from}.xlsx` },
          { title: 'Tally', help: t('fees.tallyHelp', 'Receipt vouchers as Tally XML (Gateway of Tally → Import → Vouchers).'), path: `/finance/export/tally?${qs}`, file: `tally-${p.from}.xml` },
          { title: 'QuickBooks', help: t('fees.qbHelp', 'Sales receipts CSV for QuickBooks Online import.'), path: `/finance/export/quickbooks?${qs}`, file: `quickbooks-${p.from}.csv` },
          { title: t('fees.defaulters', 'Defaulters'), help: t('fees.defaultersHelp', 'Students with overdue fees and their guardians.'), path: `/finance/defaulters?format=xlsx`, file: 'defaulters.xlsx' },
        ].map((r) => (
          <Card key={r.title} className="flex items-center justify-between gap-3 p-4">
            <div>
              <h3 className="font-semibold">{r.title}</h3>
              <p className="text-sm text-fg-muted">{r.help}</p>
            </div>
            <DownloadButton path={r.path} filename={r.file}>{t('common.download', 'Download')}</DownloadButton>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

interface Account { provider: string; label: string; connected: boolean; enabled: boolean; mode: string; public_config: Record<string, string>; secrets: { key: string; set: boolean }[]; webhook_url: string | null }

export function SettingsTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  return (
    <div className="space-y-6">
      {can('fees.setup') && <FeeSettingsCard />}
      {can('payments.configure') && <AccountsCard />}
      {!can('payments.configure') && <Alert>{t('fees.noPaymentsPermission', 'Only people who can configure payments see the provider settings.')}</Alert>}
    </div>
  );
}

function FeeSettingsCard() {
  const offered = useChannels();
  const reminderChannels = (['in_app', 'email', 'whatsapp'] as const).filter((c) => c !== 'whatsapp' || offered.data?.whatsapp);
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/finance/settings'], queryFn: () => api.get<{ show_to_students: boolean; remind_before_days: number[]; remind_after_days: number[]; reminder_channels: string[]; voucher_note: string }>('/finance/settings') });
  const [v, setV] = useState<typeof q.data | null>(null);
  const cur = v ?? q.data;
  const save = useMutation({ mutationFn: () => api.put('/finance/settings', cur), onSuccess: () => toast('success', t('common.saved', 'Saved')) });
  if (!cur) return <Spinner />;
  const days = (xs: number[]) => xs.join(', ');
  const parse = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0);
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">{t('fees.visibilityReminders', 'Visibility and reminders')}</h2>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cur.show_to_students} onChange={(e) => setV({ ...cur, show_to_students: e.target.checked })} />
        {t('fees.showToStudents', 'Show fees to students (guardians see them when their link allows)')}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('fees.remindBefore', 'Remind this many days before the due date')} hint="e.g. 7, 3">{(a) => <Input {...a} defaultValue={days(cur.remind_before_days)} onBlur={(e) => setV({ ...cur, remind_before_days: parse(e.target.value) })} />}</Field>
        <Field label={t('fees.remindAfter', 'And this many days after it')} hint="e.g. 1, 7">{(a) => <Input {...a} defaultValue={days(cur.remind_after_days)} onBlur={(e) => setV({ ...cur, remind_after_days: parse(e.target.value).filter((x) => x > 0) })} />}</Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {reminderChannels.map((c) => (
          <label key={c} className="flex items-center gap-1.5">
            <input type="checkbox" checked={cur.reminder_channels.includes(c)} onChange={(e) => setV({ ...cur, reminder_channels: e.target.checked ? [...cur.reminder_channels, c] : cur.reminder_channels.filter((x) => x !== c) })} />
            {{ in_app: t('fees.inApp', 'App'), email: 'Email', whatsapp: 'WhatsApp' }[c]}
          </label>
        ))}
      </div>
      <Field label={t('fees.voucherNote', 'Note printed on vouchers')} optional>{(a) => <Input {...a} value={cur.voucher_note} onChange={(e) => setV({ ...cur, voucher_note: e.target.value })} />}</Field>
      <MutationError error={save.error} />
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button></div>
    </Card>
  );
}

const PUBLIC_FIELDS: Record<string, { key: string; label: string }[]> = {
  bank: [
    { key: 'bank_name', label: 'Bank' },
    { key: 'branch', label: 'Branch' },
    { key: 'account_title', label: 'Account title' },
    { key: 'iban', label: 'IBAN' },
    { key: 'account_no', label: 'Account number' },
    { key: 'raast_id', label: 'Raast ID' },
  ],
};

function AccountsCard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/finance/accounts'], queryFn: () => api.get<Account[]>('/finance/accounts') });
  const [edit, setEdit] = useState<Account | null>(null);
  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{t('fees.paymentMethods', 'Payment methods')}</h2>
        <p className="text-sm text-fg-muted">{t('fees.paymentMethodsHelp', "Connect your institution's own merchant accounts. Keys are stored encrypted and never shown again. Use sandbox keys to test.")}</p>
      </div>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Spinner /> : (
        <ul className="divide-y divide-border">
          {q.data.map((a) => (
            <li key={a.provider} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium">
                  {a.label} {a.connected ? <Badge tone={a.enabled ? 'success' : 'neutral'}>{a.enabled ? a.mode : t('common.off', 'Off')}</Badge> : <Badge>{t('fees.notConnected', 'Not connected')}</Badge>}
                </div>
                {a.webhook_url && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
                    <Copy className="size-3" aria-hidden /> <span className="break-all">{a.webhook_url}</span> <CopyButton text={a.webhook_url} />
                  </div>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => setEdit(a)}>{a.connected ? t('common.edit', 'Edit') : t('fees.connect', 'Connect')}</Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <AccountDialog a={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function AccountDialog({ a, onClose }: { a: Account; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidate();
  const [enabled, setEnabled] = useState(a.connected ? a.enabled : true);
  const [mode, setMode] = useState(a.mode);
  const [pub, setPub] = useState<Record<string, string>>(a.public_config);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const m = useMutation({ mutationFn: () => api.put(`/finance/accounts/${a.provider}`, { enabled, mode, public_config: pub, secrets: Object.fromEntries(Object.entries(secrets).filter(([, x]) => x !== '')) }), onSuccess: async () => { await invalidate('/finance/accounts'); onClose(); } });
  return (
    <Dialog open onClose={onClose} title={a.label}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t('fees.enabled', 'Offer this to payers')}</label>
          {a.provider !== 'bank' && (
            <Select aria-label={t('fees.mode', 'Mode')} value={mode} onChange={(e) => setMode(e.target.value)} className="w-40">
              <option value="sandbox">{t('fees.sandbox', 'Sandbox (test)')}</option>
              <option value="live">{t('fees.live', 'Live')}</option>
            </Select>
          )}
        </div>
        {(PUBLIC_FIELDS[a.provider] ?? []).map((f) => (
          <Field key={f.key} label={f.label} optional>{(x) => <Input {...x} value={pub[f.key] ?? ''} onChange={(e) => setPub({ ...pub, [f.key]: e.target.value })} />}</Field>
        ))}
        {a.secrets.map((s) => (
          <Field key={s.key} label={s.key.replace(/_/g, ' ')} hint={s.set ? t('fees.secretSet', 'Saved — leave empty to keep it') : undefined}>
            {(x) => <Input {...x} type="password" autoComplete="off" value={secrets[s.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [s.key]: e.target.value })} />}
          </Field>
        ))}
        <MutationError error={m.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>{t('common.save', 'Save')}</Button>
        </div>
      </div>
    </Dialog>
  );
}

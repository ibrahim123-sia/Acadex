// The gradebook: staff see every student × every piece of work with the course grade, edit
// weights, override a final grade, export and lock; students and guardians see their own row.
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Lock, LockOpen, Plus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { CourseRole } from '@/lib/lms';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Spinner, useToast } from '@/components/ui';
import { useAuth } from '@/lib/auth';

interface Cell {
  points: number | null;
  earned: number | null;
  excused: boolean;
  missing: boolean;
  late_penalty_percent: number;
  status: string;
}
interface GbRow {
  student_id: number;
  name: string;
  roll_no: string | null;
  grades: Record<string, Cell | null>;
  computed_percent: number | null;
  override: { percent: number; reason: string } | null;
  percent: number | null;
  grade: { label: string; passed: boolean } | null;
}
interface Gradebook {
  columns: { id: number; title: string; kind: string; category_id: number | null; points: number; due_at: string | null }[];
  categories: { id: number; name: string; weight: number; drop_lowest: number }[];
  rows?: GbRow[];
  row?: GbRow | null;
  locked_at?: string | null;
  can_edit?: boolean;
}

const cellText = (c: Cell | null | undefined) => (!c ? '' : c.excused ? 'EX' : c.points == null ? (c.missing ? '0*' : '') : String(c.earned ?? c.points));

export function GradebookTab({ courseId, role, canEdit }: { courseId: number; role: CourseRole; canEdit: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['gradebook', courseId], queryFn: () => api.get<Gradebook>(`/courses/${courseId}/gradebook`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['gradebook', courseId] });
  const lock = useMutation({
    mutationFn: (on: boolean) => api.post(`/courses/${courseId}/gradebook/${on ? 'lock' : 'unlock'}`, {}),
    onSuccess: refresh,
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const gb = q.data;
  if (role !== 'staff') return <MyGrades gb={gb} />;
  const rows = gb.rows ?? [];
  return (
    <div className="space-y-4">
      {gb.locked_at && <Alert tone="warning">{t('lms.gradebookLocked', 'This gradebook is locked: results are published and grades can’t change.')}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => api.download(`/courses/${courseId}/gradebook/export?format=xlsx`, 'gradebook.xlsx').catch((e) => toast('error', errorMessage(e)))}>
          <Download className="size-4" /> Excel
        </Button>
        <Button variant="outline" size="sm" onClick={() => api.download(`/courses/${courseId}/gradebook/export?format=csv`, 'gradebook.csv').catch((e) => toast('error', errorMessage(e)))}>
          <Download className="size-4" /> CSV
        </Button>
        {canEdit &&
          (gb.locked_at ? (
            can('courses.manage_any') && (
              <Button size="sm" variant="outline" onClick={() => lock.mutate(false)}>
                <LockOpen className="size-4" /> {t('lms.unlock', 'Unlock')}
              </Button>
            )
          ) : (
            <Button size="sm" variant="outline" onClick={() => window.confirm(t('lms.lockConfirm', 'Lock the gradebook? Only an administrator can unlock it.')) && lock.mutate(true)}>
              <Lock className="size-4" /> {t('lms.lock', 'Lock')}
            </Button>
          ))}
      </div>
      {canEdit && !gb.locked_at && <Categories courseId={courseId} categories={gb.categories} onChange={refresh} />}
      {!rows.length ? (
        <Card>
          <EmptyState title={t('lms.noStudents', 'No students in this course')} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('lms.grades', 'Grades')}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-fg-muted">
                <th scope="col" className="sticky start-0 bg-surface-2 px-3 py-2 text-start">{t('common.student', 'Student')}</th>
                {gb.columns.map((c) => (
                  <th key={c.id} scope="col" className="min-w-20 px-2 py-2 text-center font-medium">
                    <Link to={`work/${c.id}`} className="hover:text-primary">{c.title}</Link>
                    <div className="font-normal">/{c.points}</div>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-center">{t('lms.course', 'Course')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <th scope="row" className="sticky start-0 bg-surface px-3 py-2 text-start font-medium">{r.name}</th>
                  {gb.columns.map((c) => {
                    const cell = r.grades[c.id];
                    return (
                      <td key={c.id} className={cn('px-2 py-2 text-center tabular-nums', cell?.status === 'draft' && 'text-fg-muted italic', cell?.missing && cell.points == null && 'text-danger')}>
                        {cellText(cell)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <OverrideCell courseId={courseId} row={r} disabled={!canEdit || !!gb.locked_at} onDone={refresh} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-fg-muted">{t('lms.gbLegend', 'Italic = draft (not released). EX = excused. 0* = missing. Late penalties are applied.')}</p>
        </Card>
      )}
    </div>
  );
}

function OverrideCell({ courseId, row, disabled, onDone }: { courseId: number; row: GbRow; disabled: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const set = useMutation({
    mutationFn: (v: { percent: number | null; reason: string }) => api.put(`/courses/${courseId}/final-overrides`, { student_id: row.student_id, ...v }),
    onSuccess: onDone,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const label = row.percent == null ? '—' : `${row.percent}%${row.grade ? ` ${row.grade.label}` : ''}`;
  return (
    <button
      type="button"
      disabled={disabled}
      title={row.override ? t('lms.overridden', 'Set by hand: {{r}}', { r: row.override.reason }) : t('lms.overrideHint', 'Set the course grade by hand')}
      onClick={() => {
        const p = window.prompt(t('lms.overridePrompt', 'Course grade in % (empty to go back to the calculated {{c}})', { c: row.computed_percent ?? '—' }), row.override ? String(row.override.percent) : '');
        if (p === null) return;
        if (p.trim() === '') return set.mutate({ percent: null, reason: '' });
        const reason = window.prompt(t('lms.overrideReason', 'Why?')) ?? '';
        set.mutate({ percent: Number(p), reason });
      }}
      className={cn('rounded px-1 font-semibold tabular-nums', row.grade && !row.grade.passed && 'text-danger', row.override && 'underline decoration-dotted')}
    >
      {label}
    </button>
  );
}

function Categories({ courseId, categories, onChange }: { courseId: number; categories: Gradebook['categories']; onChange: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const add = useMutation({
    mutationFn: () => api.post(`/courses/${courseId}/grade-categories`, { name, weight: Number(weight) || 0 }),
    onSuccess: () => {
      setName('');
      setWeight('');
      onChange();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (c: Gradebook['categories'][number]) => api.patch(`/grade-categories/${c.id}`, { name: c.name, weight: c.weight, drop_lowest: c.drop_lowest }),
    onSuccess: onChange,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const total = categories.reduce((n, c) => n + c.weight, 0);
  return (
    <details className="rounded-xl border border-border bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t('lms.weights', 'Categories and weights')} {categories.length > 0 && <Badge tone={total === 100 ? 'success' : 'warning'}>{total}%</Badge>}
      </summary>
      <ul className="mt-3 space-y-2">
        {categories.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-28 flex-1">{c.name}</span>
            <label className="flex items-center gap-1">
              <Input className="w-20" type="number" min={0} max={100} defaultValue={c.weight} aria-label={t('lms.weight', 'Weight %')} onBlur={(e) => Number(e.target.value) !== c.weight && update.mutate({ ...c, weight: Number(e.target.value) })} />%
            </label>
            <label className="flex items-center gap-1 text-xs text-fg-muted">
              {t('lms.dropLowest', 'drop lowest')}
              <Input className="w-16" type="number" min={0} max={20} defaultValue={c.drop_lowest} onBlur={(e) => Number(e.target.value) !== c.drop_lowest && update.mutate({ ...c, drop_lowest: Number(e.target.value) })} />
            </label>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Field label={t('lms.category', 'Category')}>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('lms.categoryEg', 'e.g. Quizzes')} />}</Field>
        <Field label={t('lms.weight', 'Weight %')}>{(a) => <Input {...a} className="w-24" type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />}</Field>
        <Button type="submit" variant="outline" loading={add.isPending}>
          <Plus className="size-4" /> {t('common.add', 'Add')}
        </Button>
      </form>
      <p className="mt-2 text-xs text-fg-muted">{t('lms.weightsHelp', 'Without weights, all points are added up. Weights need not add to 100: they are scaled.')}</p>
    </details>
  );
}

function MyGrades({ gb }: { gb: Gradebook }) {
  const { t } = useTranslation();
  const r = gb.row;
  if (!r) return <Card><EmptyState title={t('lms.noGradesYet', 'No grades yet')} /></Card>;
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-baseline gap-3 p-4">
        <span className="text-sm text-fg-muted">{t('lms.courseGrade', 'Course grade so far')}</span>
        <span className="text-2xl font-bold tabular-nums">{r.percent == null ? '—' : `${r.percent}%`}</span>
        {r.grade && <Badge tone={r.grade.passed ? 'success' : 'danger'}>{r.grade.label}</Badge>}
      </Card>
      <Card className="divide-y divide-border">
        {gb.columns.map((c) => {
          const cell = r.grades[c.id];
          return (
            <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <Link to={`work/${c.id}`} className="min-w-0 truncate hover:text-primary">{c.title}</Link>
              <span className="tabular-nums">
                {cell ? (cell.excused ? t('lms.excused', 'Excused') : cell.points == null ? (cell.missing ? <Badge tone="danger">{t('lms.missing', 'Missing')}</Badge> : '—') : `${cell.earned ?? cell.points} / ${c.points}`) : '—'}
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

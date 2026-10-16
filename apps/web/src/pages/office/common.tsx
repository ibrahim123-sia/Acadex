// Small pieces shared by the finance, exams, outcomes and admissions screens.
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useDebounced } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { Badge, Button, Input, useToast } from '@/components/ui';

/** Download a protected file (PDF, Excel) with a toast on failure. */
export function DownloadButton({ path, filename, children, variant = 'outline', size = 'sm' }: { path: string; filename: string; children: ReactNode; variant?: 'outline' | 'ghost' | 'secondary' | 'primary'; size?: 'sm' | 'md' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      loading={busy}
      onClick={() => {
        setBusy(true);
        api
          .download(path, filename)
          .catch((e) => toast('error', errorMessage(e)))
          .finally(() => setBusy(false));
      }}
    >
      <Download className="size-4" aria-hidden /> {children}
    </Button>
  );
}

/** Refetch everything under these query-key prefixes. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) => Promise.all(prefixes.map((p) => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(p) })));
}

/** Pick a student by searching (lists are paginated, so no giant dropdown). */
export function StudentSearch({ value, onChange, multiple = false }: { value: number[]; onChange: (ids: number[]) => void; multiple?: boolean }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const results = useQuery({
    queryKey: ['student-search', debounced],
    queryFn: () => api.get<{ id: number; first_name: string; last_name: string; roll_no: string | null; section_name: string | null }[]>('/institution/students', { search: debounced, pageSize: 10 }),
  });
  const toggle = (id: number) => onChange(multiple ? (value.includes(id) ? value.filter((x) => x !== id) : [...value, id]) : [id]);
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.searchStudents', 'Search by name or roll number…')} aria-label={t('admin.findStudent', 'Find a student')} />
      <ul className="mt-1 max-h-44 divide-y divide-border overflow-y-auto rounded-lg border border-border" role="listbox" aria-multiselectable={multiple}>
        {!results.data?.length ? (
          <li className="px-3 py-2 text-sm text-fg-muted">{t('admin.noMatches', 'No students match your search')}</li>
        ) : (
          results.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={value.includes(s.id)}
                onClick={() => toggle(s.id)}
                className={cn('w-full px-3 py-2 text-start text-sm', value.includes(s.id) ? 'bg-primary-soft font-medium text-primary' : 'hover:bg-surface-2')}
              >
                {s.first_name} {s.last_name} <span className="text-fg-muted">({s.roll_no ?? '—'}{s.section_name ? ` · ${s.section_name}` : ''})</span>
              </button>
            </li>
          ))
        )}
      </ul>
      {multiple && value.length > 0 && <p className="mt-1 text-xs text-fg-muted">{t('office.selectedCount', '{{n}} selected', { n: value.length })}</p>}
    </div>
  );
}

const INVOICE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = { paid: 'success', partially_paid: 'warning', issued: 'info', draft: 'neutral', cancelled: 'neutral' };
export function InvoiceStatus({ status, overdue }: { status: string; overdue?: boolean }) {
  const { t } = useTranslation();
  if (overdue && status !== 'paid' && status !== 'cancelled') return <Badge tone="danger">{t('fees.overdue', 'Overdue')}</Badge>;
  const label: Record<string, string> = { paid: t('fees.paid', 'Paid'), partially_paid: t('fees.partlyPaid', 'Part paid'), issued: t('fees.due', 'Due'), draft: t('fees.draft', 'Draft'), cancelled: t('fees.cancelled', 'Cancelled') };
  return <Badge tone={INVOICE_TONE[status] ?? 'neutral'}>{label[status] ?? status}</Badge>;
}

/** The first and last day of this month, for report filters. */
export function thisMonth() {
  const d = new Date();
  const from = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/** Labelled read-only value for detail panels. */
export const Info = ({ label, children }: { label: ReactNode; children: ReactNode }) => (
  <div>
    <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
    <div className="mt-0.5 text-sm text-fg">{children}</div>
  </div>
);

export interface StructureData {
  campuses: { id: number; name: string }[];
  programs: { id: number; name: string; code: string | null; levels: { id: number; name: string }[] }[];
  academic_years: { id: number; name: string; is_current: boolean; terms: { id: number; name: string; status: string }[] }[];
  departments: { id: number; name: string }[];
}

/** Campuses, programs with levels, years with terms (for pickers); empty when not allowed to read them. */
export function useStructure() {
  return useQuery({
    queryKey: ['/institution/structure'],
    queryFn: () => api.get<StructureData>('/institution/structure').catch(() => ({ campuses: [], programs: [], academic_years: [], departments: [] }) as StructureData),
    staleTime: 60_000,
  });
}

/** Sections for pickers. */
export function useSections() {
  return useQuery({
    queryKey: ['/institution/sections', 'picker'],
    queryFn: () => api.all<{ id: number; name: string; label: string | null; campus_name: string | null }>('/institution/sections').catch(() => []),
    staleTime: 60_000,
  });
}

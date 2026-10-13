import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Card } from './surface';
import { EmptyState, ErrorState, Skeleton } from './feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** hidden below the sm breakpoint to keep tables readable on phones */
  hideOnMobile?: boolean;
}

/** A table with loading, error and empty states; scrolls horizontally on small screens. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  caption?: string;
}) {
  return (
    <Card className="overflow-hidden">
      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="border-b border-border bg-surface-2 text-fg-muted">
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cn('px-4 py-3 text-start text-xs font-semibold uppercase tracking-wide', c.hideOnMobile && 'hidden sm:table-cell', c.className)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading || !rows
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c.key} className={cn('px-4 py-3', c.hideOnMobile && 'hidden sm:table-cell')}>
                          <Skeleton className="h-4 w-full max-w-40" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((r, i) => (
                    <tr key={rowKey(r, i)} className="hover:bg-surface-2/60">
                      {columns.map((c) => (
                        <td key={c.key} className={cn('px-4 py-3 align-middle', c.hideOnMobile && 'hidden sm:table-cell', c.className)}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && rows && rows.length === 0 && <EmptyState title={empty} />}
        </div>
      )}
    </Card>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  if (total <= pageSize) return null;
  const last = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn =
    'inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm text-fg hover:bg-surface-2 disabled:opacity-40';
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted" aria-label={t('common.pagination', 'Pagination')}>
      <span>{t('common.showing', 'Showing {{from}}–{{to}} of {{total}}', { from, to, total })}</span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden /> {t('common.prev', 'Previous')}
        </button>
        <button type="button" className={btn} disabled={page >= last} onClick={() => onPage(page + 1)}>
          {t('common.next', 'Next')} <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </button>
      </div>
    </nav>
  );
}

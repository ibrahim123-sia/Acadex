import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/seo';

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-xl border border-border bg-surface shadow-sm', className)} {...p} />
);

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  useDocumentTitle(typeof title === 'string' ? title : null);
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-fg sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, sub, icon: Icon, tone = 'primary' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: 'primary' | 'success' | 'warning' | 'danger' }) {
  const tones = {
    primary: 'bg-primary-soft text-primary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  };
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</div>
          <div className="mt-1 break-words text-2xl font-bold tabular-nums text-fg xl:text-[1.75rem]">{value}</div>
          {sub && <div className="mt-1 text-xs text-fg-muted">{sub}</div>}
        </div>
        {Icon && (
          <div className={cn('grid size-11 shrink-0 place-items-center rounded-lg', tones[tone])}>
            <Icon className="size-5" aria-hidden />
          </div>
        )}
      </div>
    </Card>
  );
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const badgeTones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-primary-soft text-primary',
};

export const Badge = ({ tone = 'neutral', className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) => (
  <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', badgeTones[tone], className)} {...p} />
);

const STATUS_TONE: Record<string, Tone> = {
  active: 'success',
  Paid: 'success',
  Present: 'success',
  suspended: 'danger',
  Pending: 'danger',
  Absent: 'danger',
  inactive: 'neutral',
  Partial: 'warning',
  Leave: 'warning',
  pro: 'info',
  enterprise: 'info',
  free: 'neutral',
};
/** A badge coloured by a known status value. */
export const StatusBadge = ({ value, label }: { value: string; label?: ReactNode }) => <Badge tone={STATUS_TONE[value] ?? 'neutral'}>{label ?? value}</Badge>;

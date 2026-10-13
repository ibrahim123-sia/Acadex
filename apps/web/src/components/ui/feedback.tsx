import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Inbox, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './button';

export function Spinner({ className, label }: { className?: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={cn('flex items-center justify-center py-16 text-fg-muted', className)}>
      <LoaderCircle className="size-7 animate-spin" aria-hidden />
      <span className="sr-only">{label ?? t('common.loading', 'Loading…')}</span>
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden />;

export function EmptyState({ title, description, action }: { title?: ReactNode; description?: ReactNode; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <Inbox className="mb-3 size-10 text-fg-muted/60" aria-hidden />
      <p className="font-medium text-fg">{title ?? t('common.emptyTitle', 'Nothing here yet')}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <TriangleAlert className="mb-3 size-10 text-danger" aria-hidden />
      <p className="font-medium text-fg">{t('common.errorTitle', 'Something went wrong')}</p>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          {t('common.retry', 'Try again')}
        </Button>
      )}
    </div>
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const alertTone: Record<AlertTone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-primary/30 bg-primary-soft text-fg', Icon: Info },
  success: { cls: 'border-success/30 bg-success-soft text-fg', Icon: CircleCheck },
  warning: { cls: 'border-warning/30 bg-warning-soft text-fg', Icon: TriangleAlert },
  danger: { cls: 'border-danger/30 bg-danger-soft text-fg', Icon: CircleAlert },
};

export function Alert({ tone = 'info', title, children, className }: { tone?: AlertTone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { cls, Icon } = alertTone[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-3 py-2.5 text-sm', cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Inline error for a failed mutation, or nothing. */
export const MutationError = ({ error }: { error: unknown }) => (error ? <Alert tone="danger">{errorMessage(error)}</Alert> : null);

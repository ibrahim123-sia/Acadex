import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export function NotificationBell() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: ({ signal }) => api.get<{ items: Notification[]; unread: number }>('/me/notifications', undefined, signal),
    refetchInterval: 60_000,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/me/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg"
        aria-label={`${t('nav.notifications', 'Notifications')}${unread ? ` (${unread})` : ''}`}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-semibold">{t('nav.notifications', 'Notifications')}</span>
            {unread > 0 && (
              <button type="button" onClick={() => markAll.mutate()} className="text-xs text-primary hover:underline">
                {t('nav.markAllRead', 'Mark all read')}
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {!data?.items.length ? (
              <li className="px-4 py-8 text-center text-sm text-fg-muted">{t('nav.noNotifications', 'No notifications')}</li>
            ) : (
              data.items.map((n) => (
                <li key={n.id} className={cn('border-b border-border px-4 py-3 last:border-0', !n.is_read && 'bg-primary-soft/50')}>
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.message && <div className="text-xs text-fg-muted">{n.message}</div>}
                  <div className="mt-0.5 text-[11px] text-fg-muted">{formatRelative(n.created_at)}</div>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

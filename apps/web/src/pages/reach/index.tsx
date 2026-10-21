// Routes of reach and communication, and the "saved for offline" list.
import { useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CloudOff } from 'lucide-react';
import { HOME_ROUTE, type Permission } from '@acadex/shared';
import { RequireAuth } from '@/components/RequireAuth';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import { removeOffline, savedItems } from '@/lib/device';
import { Button, Card, EmptyState, PageHeader } from '@/components/ui';
import { MessagesPage, SafeguardingPage } from './Messages';
import { MeetingsPage, TicketsPage } from './Desk';
import { CommunicationPage } from './Office';

function AnyOf({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { user, can } = useAuth();
  if (!perms.some((p) => can(p))) return <Navigate to={user ? HOME_ROUTE[user.role] : '/login'} replace />;
  return <>{children}</>;
}

function SavedPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState(() => savedItems.list());
  return (
    <>
      <PageHeader title={t('nav.saved', 'Saved for offline')} subtitle={t('offline.subtitle', 'Pages and files you saved open here without a connection')} />
      {!items.length ? (
        <EmptyState title={t('offline.none', 'Nothing saved yet')} description={t('offline.noneHint', 'Open a page or file in a course and choose “Save for offline”.')} />
      ) : (
        <Card className="divide-y divide-border">
          {items.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <Link to={s.link} className="min-w-0">
                <div className="truncate font-medium text-primary">{s.title}</div>
                <div className="text-xs text-fg-muted">{s.course} · {formatRelative(s.saved_at)}</div>
              </Link>
              <Button size="sm" variant="ghost" onClick={() => void removeOffline(s.key).then(() => setItems(savedItems.list()))}>
                <CloudOff className="size-4" /> {t('offline.remove', 'Remove offline copy')}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

export const MessagesRoute = () => <RequireAuth><MessagesPage /></RequireAuth>;
export const SafeguardingRoute = () => <RequireAuth permission="messages.review"><SafeguardingPage /></RequireAuth>;
export const TicketsRoute = () => <RequireAuth><TicketsPage /></RequireAuth>;
export const MeetingsRoute = () => <RequireAuth><MeetingsPage /></RequireAuth>;
export const SavedRoute = () => <RequireAuth><SavedPage /></RequireAuth>;
export const CommunicationRoute = () => (
  <RequireAuth>
    <AnyOf perms={['broadcast.send', 'settings.manage', 'delivery.read', 'integrations.manage']}>
      <CommunicationPage />
    </AnyOf>
  </RequireAuth>
);

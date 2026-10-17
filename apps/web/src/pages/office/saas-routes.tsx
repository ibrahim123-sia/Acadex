// Routes of Phase 6 inside the app (the institution's platform pages and the modules).
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { HOME_ROUTE, type Permission } from '@acadex/shared';
import { RequireAuth } from '@/components/RequireAuth';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { BillingPage, DataPrivacyPage, IntegrationsPage, ModulesCard, ReportsPage } from './Platform';
import { HrPage, HostelPage, InventoryPage, LibraryPage, MyHrPage, MyServicesPage, TransportPage, VisitorsPage } from '@/pages/modules/Modules';
import { PrivacyCenterPage } from '@/pages/account/Privacy';
import { BookingsPage, WhatsNewPage } from './Extras';
import { PlatformSaasPage } from '@/pages/platform/Saas';

function AnyOf({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { user, can } = useAuth();
  if (!perms.some((p) => can(p))) return <Navigate to={user ? HOME_ROUTE[user.role] : '/login'} replace />;
  return <>{children}</>;
}

function ModulesPage() {
  return (
    <>
      <PageHeader title="Modules" />
      <ModulesCard />
    </>
  );
}

const P = (permission: Permission, el: ReactNode) => <RequireAuth permission={permission}>{el}</RequireAuth>;
export const BillingRoute = () => P('billing.manage', <BillingPage />);
export const ReportsRoute = () => P('reports.view', <ReportsPage />);
export const BookingsRoute = () => <RequireAuth><AnyOf perms={['teaching.access', 'timetable.manage']}><BookingsPage /></AnyOf></RequireAuth>;
export const WhatsNewRoute = () => <RequireAuth><WhatsNewPage /></RequireAuth>;
export const DataPrivacyRoute = () => <RequireAuth><AnyOf perms={['settings.manage', 'privacy.manage']}><DataPrivacyPage /></AnyOf></RequireAuth>;
export const IntegrationsRoute = () => P('integrations.manage', <IntegrationsPage />);
export const ModulesRoute = () => P('settings.manage', <ModulesPage />);
export const LibraryRoute = () => P('library.manage', <LibraryPage />);
export const HrRoute = () => P('hr.manage', <HrPage />);
export const MyHrRoute = () => P('teaching.access', <MyHrPage />);
export const TransportRoute = () => P('transport.manage', <TransportPage />);
export const HostelRoute = () => P('hostel.manage', <HostelPage />);
export const InventoryRoute = () => P('inventory.manage', <InventoryPage />);
export const VisitorsRoute = () => P('visitors.manage', <VisitorsPage />);
export const MyServicesRoute = () => <RequireAuth><MyServicesPage /></RequireAuth>;
export const PrivacyRoute = () => <RequireAuth><PrivacyCenterPage /></RequireAuth>;
export const BusinessRoute = () => P('platform.institutions.read', <PlatformSaasPage />);

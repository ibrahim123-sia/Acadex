// Routes of Phase 3: finance (/finance), paying fees (/fees, /pay), exams (/exams),
// learning outcomes (/outcomes) and admissions (/admissions). Each screen still needs its
// own permission; the API enforces it again.
import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { HOME_ROUTE, type Permission } from '@acadex/shared';
import { RequireAuth } from '@/components/RequireAuth';
import { useAuth } from '@/lib/auth';
import { FinanceHome, InvoicePage } from './Finance';
import { MyFeesPage, PayLinkPage, PayReturnPage } from './Pay';
import { ExamsOfficePage, MarksEntryPage, MyExamsPage, MyPapersPage, SeriesPage } from './Exams';
import { OutcomesPage } from './Outcomes';
import { AdmissionsPage, ApplicationPage } from './Admissions';

/** Inside RequireAuth: let through anyone holding one of these permissions. */
function AnyOf({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { user, can } = useAuth();
  if (!perms.some((p) => can(p))) return <Navigate to={user ? HOME_ROUTE[user.role] : '/login'} replace />;
  return <>{children}</>;
}

export function FinanceRoutes() {
  return (
    <RequireAuth>
      <AnyOf perms={['fees.read', 'finance.reports', 'finance.expenses', 'fees.setup']}>
        <Routes>
          <Route index element={<FinanceHome />} />
          <Route path="invoices/:id" element={<InvoicePage />} />
        </Routes>
      </AnyOf>
    </RequireAuth>
  );
}

export const MyFeesRoute = () => <RequireAuth><MyFeesPage /></RequireAuth>;
export const PayLinkRoute = () => <PayLinkPage />;
export const PayReturnRoute = () => <PayReturnPage />;

export function ExamsRoutes() {
  const { can } = useAuth();
  return (
    <RequireAuth>
      <Routes>
        <Route index element={can('exams.manage') || can('exams.publish') ? <Navigate to="office" replace /> : can('teaching.access') ? <Navigate to="marks" replace /> : <MyExamsPage />} />
        <Route path="me" element={<MyExamsPage />} />
        <Route path="office" element={<AnyOf perms={['exams.manage', 'exams.publish', 'exams.moderate', 'academics.read']}><ExamsOfficePage /></AnyOf>} />
        <Route path="office/:id" element={<AnyOf perms={['exams.manage', 'exams.publish', 'exams.moderate', 'academics.read']}><SeriesPage /></AnyOf>} />
        <Route path="marks" element={<AnyOf perms={['teaching.access', 'exams.manage']}><MyPapersPage /></AnyOf>} />
        <Route path="marks/:sessionId" element={<MarksEntryPage />} />
      </Routes>
    </RequireAuth>
  );
}

export const OutcomesRoute = () => (
  <RequireAuth>
    <AnyOf perms={['outcomes.manage', 'academics.read', 'teaching.access']}>
      <OutcomesPage />
    </AnyOf>
  </RequireAuth>
);

export function AdmissionsRoutes() {
  return (
    <RequireAuth>
      <AnyOf perms={['admissions.manage', 'enquiries.manage']}>
        <Routes>
          <Route index element={<AdmissionsPage />} />
          <Route path="applications/:id" element={<ApplicationPage />} />
        </Routes>
      </AnyOf>
    </RequireAuth>
  );
}

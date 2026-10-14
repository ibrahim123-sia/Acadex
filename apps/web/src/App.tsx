import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import { HomeRedirect, RequireAuth } from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import { LoginPage } from '@/pages/auth/LoginPage';
import { AcceptInvitePage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '@/pages/auth/AccountLinkPages';
import { ForcedMfaSetupPage, ForcedPasswordChangePage, SecurityPage } from '@/pages/account/AccountPages';

// Code-split by role: each portal's pages load only for people who use them.
const PlatformRoutes = lazy(() => import('@/pages/platform'));
const AdminRoutes = lazy(() => import('@/pages/admin'));
const TeacherRoutes = lazy(() => import('@/pages/teacher'));
const StudentRoutes = lazy(() => import('@/pages/student'));
const ParentRoutes = lazy(() => import('@/pages/parent'));
const GroupRoutes = lazy(() => import('@/pages/group'));
const VerifyPage = lazy(() => import('@/pages/public/Verify').then((m) => ({ default: m.VerifyPage })));

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-5xl font-bold text-fg-muted">404</div>
      <p>{t('common.notFound', "This page doesn't exist.")}</p>
      <Link to="/" className="text-primary hover:underline">
        {t('common.goHome', 'Go to my home page')}
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Spinner className="h-full" />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route path="/account/password" element={<RequireAuth bare><ForcedPasswordChangePage /></RequireAuth>} />
        <Route path="/account/2fa" element={<RequireAuth bare><ForcedMfaSetupPage /></RequireAuth>} />
        <Route path="/account/security" element={<RequireAuth><SecurityPage /></RequireAuth>} />

        <Route path="/platform/*" element={<PlatformRoutes />} />
        <Route path="/admin/*" element={<AdminRoutes />} />
        <Route path="/teacher/*" element={<TeacherRoutes />} />
        <Route path="/student/*" element={<StudentRoutes />} />
        <Route path="/parent/*" element={<ParentRoutes />} />
        <Route path="/group/*" element={<GroupRoutes />} />
        <Route path="/verify/:code" element={<VerifyPage />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

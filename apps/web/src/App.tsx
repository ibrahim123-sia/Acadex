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
const Lms = () => import('@/pages/lms');
const CourseRoutes = lazy(() => Lms().then((m) => ({ default: m.CourseRoutes })));
const AttendanceRoutes = lazy(() => Lms().then((m) => ({ default: m.AttendanceRoutes })));
const SurveyRoutes = lazy(() => Lms().then((m) => ({ default: m.SurveyRoutes })));
const TimetableRoute = lazy(() => Lms().then((m) => ({ default: m.TimetableRoute })));
const CalendarRoute = lazy(() => Lms().then((m) => ({ default: m.CalendarRoute })));
const AnnouncementsRoute = lazy(() => Lms().then((m) => ({ default: m.AnnouncementsRoute })));
const NotificationsRoute = lazy(() => Lms().then((m) => ({ default: m.NotificationsRoute })));
const AttemptRoute = lazy(() => Lms().then((m) => ({ default: m.AttemptRoute })));
const FamilyRoute = lazy(() => Lms().then((m) => ({ default: m.FamilyRoute })));
const VerifyPage = lazy(() => import('@/pages/public/Verify').then((m) => ({ default: m.VerifyPage })));
const Office = () => import('@/pages/office');
const FinanceRoutes = lazy(() => Office().then((m) => ({ default: m.FinanceRoutes })));
const MyFeesRoute = lazy(() => Office().then((m) => ({ default: m.MyFeesRoute })));
const PayLinkRoute = lazy(() => Office().then((m) => ({ default: m.PayLinkRoute })));
const PayReturnRoute = lazy(() => Office().then((m) => ({ default: m.PayReturnRoute })));
const ExamsRoutes = lazy(() => Office().then((m) => ({ default: m.ExamsRoutes })));
const OutcomesRoute = lazy(() => Office().then((m) => ({ default: m.OutcomesRoute })));
const AdmissionsRoutes = lazy(() => Office().then((m) => ({ default: m.AdmissionsRoutes })));
const Reach = () => import('@/pages/reach');
const MessagesRoute = lazy(() => Reach().then((m) => ({ default: m.MessagesRoute })));
const SafeguardingRoute = lazy(() => Reach().then((m) => ({ default: m.SafeguardingRoute })));
const TicketsRoute = lazy(() => Reach().then((m) => ({ default: m.TicketsRoute })));
const MeetingsRoute = lazy(() => Reach().then((m) => ({ default: m.MeetingsRoute })));
const SavedRoute = lazy(() => Reach().then((m) => ({ default: m.SavedRoute })));
const CommunicationRoute = lazy(() => Reach().then((m) => ({ default: m.CommunicationRoute })));
const Ai = () => import('@/pages/ai');
const AiSettingsRoute = lazy(() => Ai().then((m) => ({ default: m.AiSettingsRoute })));
const SuccessRoute = lazy(() => Ai().then((m) => ({ default: m.SuccessRoute })));
const AskRoute = lazy(() => Ai().then((m) => ({ default: m.AskRoute })));
const HelpRoute = lazy(() => Ai().then((m) => ({ default: m.HelpRoute })));
const VivaRoute = lazy(() => Ai().then((m) => ({ default: m.VivaRoute })));
const Apply = () => import('@/pages/public/Apply');
const ApplyPage = lazy(() => Apply().then((m) => ({ default: m.ApplyPage })));
const ApplicationStatusPage = lazy(() => Apply().then((m) => ({ default: m.ApplicationStatusPage })));
const EntranceTestPage = lazy(() => Apply().then((m) => ({ default: m.EntranceTestPage })));

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
        <Route path="/learn/*" element={<CourseRoutes />} />
        <Route path="/teach/*" element={<CourseRoutes />} />
        <Route path="/attempts/:attemptId" element={<AttemptRoute />} />
        <Route path="/attendance/*" element={<AttendanceRoutes />} />
        <Route path="/timetable" element={<TimetableRoute />} />
        <Route path="/calendar" element={<CalendarRoute />} />
        <Route path="/announcements" element={<AnnouncementsRoute />} />
        <Route path="/notifications" element={<NotificationsRoute />} />
        <Route path="/surveys/*" element={<SurveyRoutes />} />
        <Route path="/family" element={<FamilyRoute />} />
        <Route path="/verify/:code" element={<VerifyPage />} />
        <Route path="/messages" element={<MessagesRoute />} />
        <Route path="/messages/:id" element={<MessagesRoute />} />
        <Route path="/safeguarding" element={<SafeguardingRoute />} />
        <Route path="/safeguarding/:id" element={<SafeguardingRoute />} />
        <Route path="/tickets" element={<TicketsRoute />} />
        <Route path="/tickets/:id" element={<TicketsRoute />} />
        <Route path="/meetings" element={<MeetingsRoute />} />
        <Route path="/meetings/:id" element={<MeetingsRoute />} />
        <Route path="/saved" element={<SavedRoute />} />
        <Route path="/communication" element={<CommunicationRoute />} />
        <Route path="/ai/settings" element={<AiSettingsRoute />} />
        <Route path="/success" element={<SuccessRoute />} />
        <Route path="/ask" element={<AskRoute />} />
        <Route path="/help" element={<HelpRoute />} />
        <Route path="/help/:slug" element={<HelpRoute />} />
        <Route path="/learn/viva" element={<VivaRoute />} />
        <Route path="/finance/*" element={<FinanceRoutes />} />
        <Route path="/fees" element={<MyFeesRoute />} />
        <Route path="/pay/return" element={<PayReturnRoute />} />
        <Route path="/pay/:token" element={<PayLinkRoute />} />
        <Route path="/exams/*" element={<ExamsRoutes />} />
        <Route path="/outcomes" element={<OutcomesRoute />} />
        <Route path="/admissions/*" element={<AdmissionsRoutes />} />
        <Route path="/apply/status" element={<ApplicationStatusPage />} />
        <Route path="/apply/test" element={<EntranceTestPage />} />
        <Route path="/apply/:institution/:form" element={<ApplyPage />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

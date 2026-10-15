// Routes of the LMS: courses (/learn for students and families, /teach for staff — the same
// pages, the role in the course decides what each shows), quiz attempts, attendance,
// timetable, calendar, announcements, notifications, surveys and achievements.
import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from '@/components/RequireAuth';
import { useAuth } from '@/lib/auth';
import { CourseHomePage, CoursesPage } from './Courses';
import { ItemPage } from './ItemView';
import { WorkEditorPage, WorkPage } from './Work';
import { AttemptPage, ItemAnalysisPage, QuizBuilderPage } from './Quiz';
import { DiscussionPage } from './Discussions';
import { CheckInPage, LeavePage, RegisterPage, StaffAttendancePage, StudentAttendancePage } from './Attendance';
import { MyTimetablePage } from './Timetable';
import { AchievementsPage, AnnouncementsPage, CalendarPage, NewSurveyPage, NotificationsPage, SurveyPage, SurveysPage } from './Engage';
import { FamilyHome } from './Dashboards';

/** Course pages, mounted at /learn and at /teach. */
export function CourseRoutes() {
  return (
    <RequireAuth>
      <Routes>
        <Route index element={<CoursesPage />} />
        <Route path="achievements" element={<AchievementsPage />} />
        <Route path="courses/:courseId" element={<CourseHomePage />} />
        <Route path="courses/:courseId/items/:itemId" element={<ItemPage />} />
        <Route path="courses/:courseId/work/new" element={<WorkEditorPage />} />
        <Route path="courses/:courseId/work/:workId" element={<WorkPage />} />
        <Route path="courses/:courseId/work/:workId/edit" element={<WorkEditorPage />} />
        <Route path="courses/:courseId/work/:workId/grade" element={<WorkPage />} />
        <Route path="courses/:courseId/work/:workId/questions" element={<QuizBuilderPage />} />
        <Route path="courses/:courseId/work/:workId/analysis" element={<ItemAnalysisPage />} />
        <Route path="courses/:courseId/discussions/:discussionId" element={<DiscussionPage />} />
        <Route path="courses/:courseId/live" element={<Navigate to="..#live" relative="path" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </RequireAuth>
  );
}

/** Takers of registers see the register; students their own attendance; families pick a child. */
function AttendanceHome() {
  const { user, can } = useAuth();
  if (can('attendance.mark') || can('attendance.manage')) return <RegisterPage />;
  if (user?.role === 'student') return <StudentAttendancePage />;
  return <Navigate to="/family" replace />;
}

export function AttendanceRoutes() {
  return (
    <RequireAuth>
      <Routes>
        <Route index element={<AttendanceHome />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="checkin" element={<CheckInPage />} />
        <Route path="staff" element={<StaffAttendancePage />} />
        <Route path="students/:studentId" element={<StudentAttendancePage />} />
      </Routes>
    </RequireAuth>
  );
}

export const TimetableRoute = () => <RequireAuth><MyTimetablePage /></RequireAuth>;
export const CalendarRoute = () => <RequireAuth><CalendarPage /></RequireAuth>;
export const AnnouncementsRoute = () => <RequireAuth><AnnouncementsPage /></RequireAuth>;
export const NotificationsRoute = () => <RequireAuth><NotificationsPage /></RequireAuth>;
export const AttemptRoute = () => <RequireAuth><AttemptPage /></RequireAuth>;
export const FamilyRoute = () => <RequireAuth permission="guardian.access"><FamilyHome /></RequireAuth>;
export function SurveyRoutes() {
  return (
    <RequireAuth>
      <Routes>
        <Route index element={<SurveysPage />} />
        <Route path="new" element={<NewSurveyPage />} />
        <Route path=":surveyId" element={<SurveyPage />} />
      </Routes>
    </RequireAuth>
  );
}

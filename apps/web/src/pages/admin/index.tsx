import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from '@/components/RequireAuth';
import { AdminDashboard } from './Dashboard';
import { AdminGuardians, AdminStudents, AdminTeachers } from './People';
import { AdminStudentProfile } from './StudentProfile';
import { AdminStaffProfile } from './StaffProfile';
import { AdminAnnouncements } from './Office';
import { AdminSectionDetail, AdminSections } from './Sections';
import { AdminCourses, AdminOfferingDetail } from './Courses';
import { AdminStructure } from './Structure';
import { AdminCalendar } from './Calendar';
import { AdminSettings } from './Settings';
import { AdminImports } from './Imports';
import { AdminDocuments } from './Documents';
import { AdminYearEnd } from './YearEnd';
import { AdminRecords } from './Records';
import { AdminOnboarding } from './Onboarding';
import { AdminRoles } from './Roles';
import { AdminBlueprints } from './Blueprints';

/** Institution-office pages; each one needs its own permission (custom roles may hold a subset). */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="institution.dashboard.read"><AdminDashboard /></RequireAuth>} />
      <Route path="setup" element={<RequireAuth permission="settings.manage"><AdminOnboarding /></RequireAuth>} />
      <Route path="students" element={<RequireAuth permission="students.read"><AdminStudents /></RequireAuth>} />
      <Route path="students/:id" element={<RequireAuth permission="students.read"><AdminStudentProfile /></RequireAuth>} />
      <Route path="teachers" element={<RequireAuth permission="staff.read"><AdminTeachers /></RequireAuth>} />
      <Route path="teachers/:id" element={<RequireAuth permission="staff.read"><AdminStaffProfile /></RequireAuth>} />
      <Route path="guardians" element={<RequireAuth permission="guardians.read"><AdminGuardians /></RequireAuth>} />
      <Route path="sections" element={<RequireAuth permission="sections.read"><AdminSections /></RequireAuth>} />
      <Route path="sections/:id" element={<RequireAuth permission="sections.read"><AdminSectionDetail /></RequireAuth>} />
      <Route path="courses" element={<RequireAuth permission="structure.read"><AdminCourses /></RequireAuth>} />
      <Route path="offerings/:id" element={<RequireAuth permission="structure.read"><AdminOfferingDetail /></RequireAuth>} />
      <Route path="structure" element={<RequireAuth permission="structure.read"><AdminStructure /></RequireAuth>} />
      <Route path="calendar" element={<RequireAuth permission="structure.read"><AdminCalendar /></RequireAuth>} />
      <Route path="fees" element={<Navigate to="/finance" replace />} />
      <Route path="announcements" element={<RequireAuth permission="announcements.read"><AdminAnnouncements /></RequireAuth>} />
      <Route path="imports" element={<RequireAuth permission="imports.run"><AdminImports /></RequireAuth>} />
      <Route path="documents" element={<RequireAuth permission="documents.issue"><AdminDocuments /></RequireAuth>} />
      <Route path="year-end" element={<RequireAuth permission="year_end.manage"><AdminYearEnd /></RequireAuth>} />
      <Route path="records" element={<RequireAuth permission="audit.read"><AdminRecords /></RequireAuth>} />
      <Route path="recycle-bin" element={<RequireAuth permission="recycle_bin.manage"><AdminRecords /></RequireAuth>} />
      <Route path="settings" element={<RequireAuth permission="settings.manage"><AdminSettings /></RequireAuth>} />
      <Route path="blueprints" element={<RequireAuth permission="blueprints.manage"><AdminBlueprints /></RequireAuth>} />
      <Route path="roles" element={<RequireAuth permission="roles.manage"><AdminRoles /></RequireAuth>} />
    </Routes>
  );
}

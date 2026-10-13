import { Route, Routes } from 'react-router';
import { RequireAuth } from '@/components/RequireAuth';
import { AdminDashboard } from './Dashboard';
import { AdminStudents, AdminTeachers } from './People';
import { AdminAnnouncements, AdminClasses, AdminFees } from './Office';
import { AdminRoles } from './Roles';

/** Institution-office pages; each one needs its own permission (custom roles may hold a subset). */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="institution.dashboard.read"><AdminDashboard /></RequireAuth>} />
      <Route path="students" element={<RequireAuth permission="students.read"><AdminStudents /></RequireAuth>} />
      <Route path="teachers" element={<RequireAuth permission="staff.read"><AdminTeachers /></RequireAuth>} />
      <Route path="sections" element={<RequireAuth permission="sections.read"><AdminClasses /></RequireAuth>} />
      <Route path="fees" element={<RequireAuth permission="fees.read"><AdminFees /></RequireAuth>} />
      <Route path="announcements" element={<RequireAuth permission="announcements.read"><AdminAnnouncements /></RequireAuth>} />
      <Route path="roles" element={<RequireAuth permission="roles.manage"><AdminRoles /></RequireAuth>} />
    </Routes>
  );
}

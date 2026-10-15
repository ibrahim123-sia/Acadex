// The teacher's home. Teaching itself happens in the courses (/teach), registers in
// /attendance and the week in /timetable.
import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from '@/components/RequireAuth';
import { TeacherHome } from '../lms/Dashboards';

export default function TeacherRoutes() {
  return (
    <Routes>
      <Route index element={<RequireAuth permission="teaching.access"><TeacherHome /></RequireAuth>} />
      {/* the old pages moved: registers to /attendance, gradebook and assignments into each course */}
      <Route path="attendance" element={<Navigate to="/attendance" replace />} />
      <Route path="announcements" element={<Navigate to="/announcements" replace />} />
      <Route path="*" element={<Navigate to="/teach" replace />} />
    </Routes>
  );
}

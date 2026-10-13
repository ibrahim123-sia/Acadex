import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getUser, HOME } from './api';
import { Layout } from './ui';
import Login from './Login.jsx';
import ChangePassword from './ChangePassword.jsx';
import { PlatformDashboard, PlatformSchools, PlatformAudit } from './pages/platform.jsx';
import { AdminDashboard, AdminStudents, AdminTeachers, AdminClasses, AdminFees, AdminAnnouncements } from './pages/admin.jsx';
import { TeacherDashboard, TeacherAttendance, TeacherGradebook, TeacherAssignments, TeacherAnnouncements } from './pages/teacher.jsx';
import { StudentDashboard, StudentAssignments } from './pages/student.jsx';
import { ParentDashboard } from './pages/parent.jsx';

function Protected({ roles, children }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role] || '/login'} replace />;
  return <Layout>{children}</Layout>;
}
const P = (roles, el) => <Protected roles={roles}>{el}</Protected>;

export default function App() {
  const user = getUser();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={user ? <ChangePassword /> : <Navigate to="/login" replace />} />

      <Route path="/platform" element={P(['super_admin'], <PlatformDashboard />)} />
      <Route path="/platform/schools" element={P(['super_admin'], <PlatformSchools />)} />
      <Route path="/platform/audit" element={P(['super_admin'], <PlatformAudit />)} />

      <Route path="/admin" element={P(['school_admin'], <AdminDashboard />)} />
      <Route path="/admin/students" element={P(['school_admin'], <AdminStudents />)} />
      <Route path="/admin/teachers" element={P(['school_admin'], <AdminTeachers />)} />
      <Route path="/admin/classes" element={P(['school_admin'], <AdminClasses />)} />
      <Route path="/admin/fees" element={P(['school_admin'], <AdminFees />)} />
      <Route path="/admin/announcements" element={P(['school_admin'], <AdminAnnouncements />)} />

      <Route path="/teacher" element={P(['teacher'], <TeacherDashboard />)} />
      <Route path="/teacher/attendance" element={P(['teacher'], <TeacherAttendance />)} />
      <Route path="/teacher/gradebook" element={P(['teacher'], <TeacherGradebook />)} />
      <Route path="/teacher/assignments" element={P(['teacher'], <TeacherAssignments />)} />
      <Route path="/teacher/announcements" element={P(['teacher'], <TeacherAnnouncements />)} />

      <Route path="/student" element={P(['student'], <StudentDashboard />)} />
      <Route path="/student/assignments" element={P(['student'], <StudentAssignments />)} />

      <Route path="/parent" element={P(['parent'], <ParentDashboard />)} />

      <Route path="*" element={<Navigate to={user ? (HOME[user.role] || '/login') : '/login'} replace />} />
    </Routes>
  );
}

export const ROLES = ['super_admin', 'group_admin', 'institution_admin', 'teacher', 'student', 'parent'] as const;
export type Role = (typeof ROLES)[number];

export const PLANS = ['free', 'pro', 'enterprise'] as const;
export type Plan = (typeof PLANS)[number];

export const INSTITUTION_STATUSES = ['active', 'suspended'] as const;

export const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Leave'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ASSESSMENT_TYPES = ['Quiz', 'Midterm', 'Assignment', 'Final', 'Test', 'Project'] as const;

export const AUDIENCES = ['All', 'Teachers', 'Students'] as const;

export const PAYMENT_STATUSES = ['Paid', 'Partial', 'Pending'] as const;

export const MAX_PAGE_SIZE = 100;

/** Portal home route per primary role. */
export const HOME_ROUTE: Record<Role, string> = {
  super_admin: '/platform',
  group_admin: '/group',
  institution_admin: '/admin',
  teacher: '/teacher',
  student: '/student',
  parent: '/parent',
};

/** Roles that must use two-factor authentication when ADMIN_MFA=required. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['super_admin', 'group_admin', 'institution_admin'];

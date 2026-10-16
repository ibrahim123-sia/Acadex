// Routes of the AI layer that live outside a course.
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { HOME_ROUTE, type Permission } from '@acadex/shared';
import { RequireAuth } from '@/components/RequireAuth';
import { useAuth } from '@/lib/auth';
import { AiSettingsPage, AskPage, HelpCenterPage, SuccessPage } from './OfficeAi';
import { VivaPage } from './CourseAi';

function AnyOf({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { user, can } = useAuth();
  if (!perms.some((p) => can(p))) return <Navigate to={user ? HOME_ROUTE[user.role] : '/login'} replace />;
  return <>{children}</>;
}

export const AiSettingsRoute = () => <RequireAuth permission="ai.manage"><AiSettingsPage /></RequireAuth>;
export const SuccessRoute = () => <RequireAuth><AnyOf perms={['risk.read', 'teaching.access']}><SuccessPage /></AnyOf></RequireAuth>;
export const AskRoute = () => <RequireAuth><AnyOf perms={['ai.ask', 'teaching.access']}><AskPage /></AnyOf></RequireAuth>;
export const HelpRoute = () => <RequireAuth><HelpCenterPage /></RequireAuth>;
export const VivaRoute = () => <RequireAuth permission="learner.access"><VivaPage /></RequireAuth>;

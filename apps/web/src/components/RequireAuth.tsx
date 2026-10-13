import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { HOME_ROUTE, type Permission } from '@acadex/shared';
import { useAuth } from '@/lib/auth';
import { Spinner } from './ui';
import { AppShell } from './AppShell';

/**
 * Route guard. Unauthenticated → sign in (then back here). Accounts that still have to
 * change a temporary password or set up 2FA are sent there first. Missing permission →
 * the user's home.
 */
export function RequireAuth({ permission, children, bare = false }: { permission?: Permission; children: ReactNode; bare?: boolean }) {
  const { status, user, can } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner className="h-full" />;
  if (status === 'anonymous' || !user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!bare) {
    if (user.must_change_password) return <Navigate to="/account/password" replace />;
    if (user.mfa_enrollment_required) return <Navigate to="/account/2fa" replace />;
  }
  if (permission && !can(permission)) return <Navigate to={HOME_ROUTE[user.role]} replace />;
  return bare ? <>{children}</> : <AppShell>{children}</AppShell>;
}

/** The signed-in user's home, or the sign-in page. */
export function HomeRedirect() {
  const { status, user } = useAuth();
  if (status === 'loading') return <Spinner className="h-full" />;
  return <Navigate to={user ? HOME_ROUTE[user.role] : '/login'} replace />;
}

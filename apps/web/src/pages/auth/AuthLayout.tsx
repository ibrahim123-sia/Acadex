import type { ReactNode } from 'react';
import { BarChart3, ShieldCheck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/components/AppShell';

/** Two-panel layout for sign-in screens (brand panel hidden on small screens). */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="grid size-10 place-items-center rounded-xl bg-white/15 text-xl font-bold">A</div>
          <span className="text-2xl font-bold">Acadex</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">{t('auth.tagline', 'One platform for every institution: teaching, learning and running the institute.')}</h1>
          <ul className="mt-8 space-y-3 text-indigo-100">
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-5" aria-hidden /> {t('auth.feature1', 'Secure, role-based access')}
            </li>
            <li className="flex items-center gap-3">
              <BarChart3 className="size-5" aria-hidden /> {t('auth.feature2', 'Real-time dashboards & reports')}
            </li>
            <li className="flex items-center gap-3">
              <Users className="size-5" aria-hidden /> {t('auth.feature3', 'Portals for admins, teachers, students and families')}
            </li>
          </ul>
        </div>
        <div className="text-sm text-indigo-300">© {new Date().getFullYear()} Acadex</div>
      </div>
      <div className="flex flex-col bg-background">
        <div className="flex justify-end gap-2 p-4">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-12">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
              <div className="grid size-10 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-fg">A</div>
              <span className="text-2xl font-bold">Acadex</span>
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reads a single-use token from the URL fragment (#token=...), which never reaches servers. */
export function tokenFromHash(): string | null {
  const m = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  return m?.[1] ?? null;
}

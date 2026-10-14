import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight,
  Baby,
  BookOpen,
  CalendarDays,
  FileSpreadsheet,
  HeartHandshake,
  History,
  IdCard,
  Library,
  Network,
  Settings,
  Trash2,
  Building2,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  Languages,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Monitor,
  Moon,
  School,
  ScrollText,
  ShieldCheck,
  SquarePen,
  Sun,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Permission, Role } from '@acadex/shared';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/terms';
import { LANGUAGES, setLanguage, type Language } from '@/lib/i18n';
import { useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/cn';
import { NotificationBell } from './NotificationBell';

const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Platform',
  group_admin: 'Group',
  institution_admin: 'Administrator',
  teacher: 'Teacher',
  student: 'Student',
  parent: 'Parent',
};

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  end?: boolean;
}

/** Navigation sections; an item shows when the user holds its permission. */
function useNav(): { title: string; items: NavItem[] }[] {
  const { t } = useTranslation();
  const { term } = useTerms();
  return [
    {
      title: t('nav.platform', 'Platform'),
      items: [
        { to: '/platform', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, permission: 'platform.institutions.read', end: true },
        { to: '/platform/institutions', label: t('nav.institutions', 'Institutions'), icon: Building2, permission: 'platform.institutions.read' },
        { to: '/platform/audit', label: t('nav.audit', 'Audit log'), icon: ScrollText, permission: 'platform.audit.read' },
      ],
    },
    {
      title: t('nav.group', 'Group'),
      items: [{ to: '/group', label: t('nav.groupOverview', 'Institutions'), icon: Network, permission: 'group.read', end: true }],
    },
    {
      title: t('nav.institutionOffice', 'Office'),
      items: [
        { to: '/admin', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, permission: 'institution.dashboard.read', end: true },
        { to: '/admin/students', label: term('student', true), icon: Users, permission: 'students.read' },
        { to: '/admin/teachers', label: t('nav.staff', 'Staff'), icon: GraduationCap, permission: 'staff.read' },
        { to: '/admin/guardians', label: term('guardian', true), icon: HeartHandshake, permission: 'guardians.read' },
        { to: '/admin/fees', label: t('nav.fees', 'Fees'), icon: Wallet, permission: 'fees.read' },
        { to: '/admin/announcements', label: t('nav.announcements', 'Announcements'), icon: Megaphone, permission: 'announcements.read' },
      ],
    },
    {
      title: t('nav.academics', 'Academics'),
      items: [
        { to: '/admin/sections', label: term('section', true), icon: BookOpen, permission: 'sections.read' },
        { to: '/admin/courses', label: term('course', true), icon: Library, permission: 'structure.read' },
        { to: '/admin/structure', label: t('nav.structure', 'Structure'), icon: Network, permission: 'structure.read' },
        { to: '/admin/calendar', label: t('nav.calendar', 'Calendar'), icon: CalendarDays, permission: 'structure.read' },
        { to: '/admin/year-end', label: t('nav.yearEnd', 'Year end'), icon: ArrowUpRight, permission: 'year_end.manage' },
      ],
    },
    {
      title: t('nav.administration', 'Administration'),
      items: [
        { to: '/admin/documents', label: t('nav.documents', 'ID cards & certificates'), icon: IdCard, permission: 'documents.issue' },
        { to: '/admin/imports', label: t('nav.imports', 'Imports'), icon: FileSpreadsheet, permission: 'imports.run' },
        { to: '/admin/records', label: t('nav.records', 'Records'), icon: History, permission: 'audit.read' },
        { to: '/admin/recycle-bin', label: t('bin.title', 'Recycle bin'), icon: Trash2, permission: 'recycle_bin.manage' },
        { to: '/admin/roles', label: t('nav.roles', 'Roles & permissions'), icon: UserCog, permission: 'roles.manage' },
        { to: '/admin/settings', label: t('nav.settings', 'Settings'), icon: Settings, permission: 'settings.manage' },
      ],
    },
    {
      title: t('nav.teaching', 'Teaching'),
      items: [
        { to: '/teacher', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, permission: 'teaching.access', end: true },
        { to: '/teacher/attendance', label: t('nav.attendance', 'Attendance'), icon: CalendarCheck, permission: 'attendance.mark' },
        { to: '/teacher/gradebook', label: t('nav.gradebook', 'Gradebook'), icon: SquarePen, permission: 'grades.enter' },
        { to: '/teacher/assignments', label: t('nav.assignments', 'Assignments'), icon: ClipboardList, permission: 'assignments.manage' },
        { to: '/teacher/announcements', label: t('nav.announcements', 'Announcements'), icon: Megaphone, permission: 'teaching.access' },
      ],
    },
    {
      title: t('nav.learning', 'Learning'),
      items: [
        { to: '/student', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, permission: 'learner.access', end: true },
        { to: '/student/assignments', label: t('nav.assignments', 'Assignments'), icon: ClipboardList, permission: 'learner.access' },
      ],
    },
    {
      title: t('nav.family', 'Family'),
      items: [{ to: '/parent', label: t('nav.children', 'My children'), icon: Baby, permission: 'guardian.access', end: true }],
    },
  ];
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { user, institution, can, logout } = useAuth();
  const sections = useNav()
    .map((s) => ({ ...s, items: s.items.filter((i) => can(i.permission)) }))
    .filter((s) => s.items.length);
  const roleLabel = user ? t(`roles.label.${user.role}`, ROLE_LABEL[user.role]) : '';
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-5">
        <div className="grid size-9 place-items-center rounded-lg font-bold text-white" style={{ background: institution?.primary_color || '#4f46e5' }}>
          A
        </div>
        <div>
          <div className="text-lg font-bold leading-tight text-white">Acadex</div>
          <div className="text-[11px] text-sidebar-fg/80">{t('nav.portal', '{{role}} portal', { role: roleLabel })}</div>
        </div>
      </div>
      {institution && (
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3 text-sm">
          <School className="size-4 shrink-0 opacity-70" aria-hidden />
          <span className="truncate text-white/90">{institution.name}</span>
        </div>
      )}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label={t('nav.menu', 'Menu')}>
        {sections.map((s) => (
          <div key={s.title}>
            {sections.length > 1 && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-fg/60">{s.title}</div>}
            <ul className="space-y-0.5">
              {s.items.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white'
                      )
                    }
                  >
                    <n.icon className="size-[18px] shrink-0" aria-hidden /> {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="px-2 py-2 text-sm">
          <div className="truncate font-medium text-white">{user?.full_name}</div>
          <div className="truncate text-xs text-sidebar-fg/70">{user?.email}</div>
        </div>
        <NavLink to="/account/security" onClick={onNavigate} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-white">
          <ShieldCheck className="size-4" aria-hidden /> {t('nav.security', 'Security')}
        </NavLink>
        <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-white">
          <LogOut className="size-4 rtl:rotate-180" aria-hidden /> {t('common.signOut', 'Sign out')}
        </button>
      </div>
    </div>
  );
}

export function LanguageSelect({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <label className={cn('flex items-center gap-1.5 text-sm text-fg-muted', className)}>
      <Languages className="size-4" aria-hidden />
      <span className="sr-only">{t('language.label', 'Language')}</span>
      <select
        value={i18n.language}
        onChange={(e) => setLanguage(e.target.value as Language)}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-sm text-fg"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  return (
    <button
      type="button"
      onClick={() => setTheme(next[theme])}
      className="rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg"
      aria-label={`${t('theme.label', 'Theme')}: ${t(`theme.${theme}`, theme)}`}
      title={`${t('theme.label', 'Theme')}: ${t(`theme.${theme}`, theme)}`}
    >
      <Icon className="size-5" />
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);

  return (
    <div className="flex min-h-full">
      <a href="#main" className="sr-only z-50 rounded bg-primary px-3 py-2 text-primary-fg focus:not-sr-only focus:fixed focus:start-2 focus:top-2">
        {t('nav.skipToContent', 'Skip to content')}
      </a>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
        <SidebarContent />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.menu', 'Menu')}>
          <button type="button" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-label={t('common.close', 'Close')} />
          <div className="absolute inset-y-0 start-0 w-72 max-w-[85vw] shadow-xl">
            <SidebarContent onNavigate={() => setDrawer(false)} />
            <button type="button" onClick={() => setDrawer(false)} className="absolute end-2 top-4 rounded p-1 text-white/80 hover:text-white" aria-label={t('common.close', 'Close')}>
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface px-3 sm:px-6">
          <button type="button" onClick={() => setDrawer(true)} className="rounded-lg p-2 text-fg-muted hover:bg-surface-2 lg:hidden" aria-label={t('nav.menu', 'Menu')}>
            <Menu className="size-5" />
          </button>
          <div className="flex-1" />
          <LanguageSelect className="hidden sm:flex" />
          <ThemeToggle />
          <NotificationBell />
        </header>
        <main id="main" className="flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}


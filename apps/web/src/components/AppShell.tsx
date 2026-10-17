import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight,
  Award,
  Clock,
  Layers,
  Plane,
  QrCode,
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
  Sun,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideIcon,
  ClipboardCheck,
  Target,
  UserPlus,
  HeartPulse,
  Sparkles,
  MessageCircleQuestion,
  HelpCircle,
  MessagesSquare,
  CalendarClock,
  LifeBuoy,
  CloudDownload,
  RadioTower,
  ShieldAlert,
  Gauge,
  WifiOff,
  BarChart3,
  LibraryBig,
  Briefcase,
  Bus,
  BedDouble,
  Package,
  DoorOpen,
  Blocks,
  Plug,
  Lock,
  CreditCard,
} from 'lucide-react';
import type { Permission, Role } from '@acadex/shared';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/terms';
import { LANGUAGES, onLanguagePicked, setLanguage, type Language } from '@/lib/i18n';
import { setLowBandwidth, useLowBandwidth } from '@/lib/device';
import { api } from '@/lib/api';
import { useUnreadMessages } from '@/pages/reach/Messages';
import { FeedbackWidget, PlatformBanner, ProductTour, SupportSessionBanner } from '@/components/PlatformExtras';
import { useQuery } from '@tanstack/react-query';
import type { ModuleKey } from '@acadex/shared';
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
  /** shown to everyone in an institution when omitted */
  permission?: Permission;
  /** or to anyone holding one of these */
  any?: Permission[];
  end?: boolean;
  /** a live count next to the item */
  badge?: 'messages';
  /** shown only when one of these modules is switched on */
  modules?: ModuleKey[];
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
        { to: '/platform/business', label: t('nav.business', 'Business'), icon: BarChart3, permission: 'platform.institutions.read' },
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
        { to: '/finance', label: t('nav.finance', 'Finance'), icon: Wallet, any: ['fees.read', 'finance.reports', 'finance.expenses'] },
        { to: '/admissions', label: t('nav.admissions', 'Admissions'), icon: UserPlus, any: ['admissions.manage', 'enquiries.manage'] },
        { to: '/admin/announcements', label: t('nav.announcements', 'Announcements'), icon: Megaphone, permission: 'announcements.read' },
        { to: '/reports', label: t('nav.reports', 'Reports'), icon: BarChart3, permission: 'reports.view' },
        { to: '/library', label: t('nav.library', 'Library'), icon: LibraryBig, permission: 'library.manage', modules: ['library'] },
        { to: '/hr', label: t('nav.hr', 'HR & payroll'), icon: Briefcase, permission: 'hr.manage', modules: ['hr'] },
        { to: '/transport', label: t('nav.transport', 'Transport'), icon: Bus, permission: 'transport.manage', modules: ['transport'] },
        { to: '/hostel', label: t('nav.hostel', 'Hostel'), icon: BedDouble, permission: 'hostel.manage', modules: ['hostel'] },
        { to: '/inventory', label: t('nav.inventory', 'Inventory & assets'), icon: Package, permission: 'inventory.manage', modules: ['inventory'] },
        { to: '/visitors', label: t('nav.visitors', 'Visitors'), icon: DoorOpen, permission: 'visitors.manage', modules: ['visitors'] },
        { to: '/communication', label: t('nav.communication', 'Communication'), icon: RadioTower, any: ['broadcast.send', 'delivery.read', 'integrations.manage'] },
        { to: '/safeguarding', label: t('nav.safeguarding', 'Safeguarding'), icon: ShieldAlert, permission: 'messages.review' },
      ],
    },
    {
      title: t('nav.academics', 'Academics'),
      items: [
        { to: '/admin/sections', label: term('section', true), icon: BookOpen, permission: 'sections.read' },
        { to: '/admin/courses', label: term('course', true), icon: Library, permission: 'structure.read' },
        { to: '/admin/structure', label: t('nav.structure', 'Structure'), icon: Network, permission: 'structure.read' },
        { to: '/admin/calendar', label: t('nav.calendar', 'Calendar'), icon: CalendarDays, permission: 'structure.read' },
        { to: '/teach', label: t('nav.allCourses', 'Course spaces'), icon: BookOpen, permission: 'courses.manage_any' },
        { to: '/admin/blueprints', label: t('nav.blueprints', 'Blueprints'), icon: Layers, permission: 'blueprints.manage' },
        { to: '/attendance', label: t('nav.registers', 'Registers'), icon: CalendarCheck, permission: 'attendance.manage', end: true },
        { to: '/attendance/staff', label: t('nav.staffAttendance', 'Staff attendance'), icon: GraduationCap, permission: 'attendance.manage' },
        { to: '/exams/office', label: t('nav.examsOffice', 'Exams office'), icon: ClipboardCheck, any: ['exams.manage', 'exams.publish', 'exams.moderate'] },
        { to: '/outcomes', label: t('nav.outcomes', 'Learning outcomes'), icon: Target, any: ['outcomes.manage', 'academics.read'] },
        { to: '/success', label: t('nav.success', 'Student success'), icon: HeartPulse, permission: 'risk.read' },
        { to: '/ask', label: t('nav.ask', 'Ask Acadex'), icon: Sparkles, permission: 'ai.ask' },
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
        { to: '/ai/settings', label: t('nav.ai', 'AI'), icon: Sparkles, permission: 'ai.manage' },
        { to: '/admin/modules', label: t('nav.modules', 'Modules'), icon: Blocks, permission: 'settings.manage' },
        { to: '/admin/integrations', label: t('nav.integrations', 'Integrations'), icon: Plug, permission: 'integrations.manage' },
        { to: '/admin/data', label: t('nav.privacyOffice', 'Data & privacy'), icon: Lock, any: ['settings.manage', 'privacy.manage'] },
        { to: '/billing', label: t('nav.billing', 'Billing'), icon: CreditCard, permission: 'billing.manage' },
      ],
    },
    {
      title: t('nav.teaching', 'Teaching'),
      items: [
        { to: '/teacher', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, permission: 'teaching.access', end: true },
        { to: '/teach', label: term('course', true), icon: Library, permission: 'teaching.access' },
        { to: '/attendance', label: t('nav.attendance', 'Attendance'), icon: CalendarCheck, permission: 'attendance.mark', end: true },
        { to: '/exams/marks', label: t('nav.examMarks', 'Exam marks'), icon: ClipboardCheck, permission: 'teaching.access' },
        { to: '/outcomes', label: t('nav.outcomes', 'Learning outcomes'), icon: Target, permission: 'teaching.access' },
        { to: '/success', label: t('nav.success', 'Student success'), icon: HeartPulse, permission: 'teaching.access' },
        { to: '/hr/me', label: t('nav.myHr', 'Pay & leave'), icon: Briefcase, permission: 'teaching.access', modules: ['hr'] },
      ],
    },
    {
      title: t('nav.learning', 'Learning'),
      items: [
        { to: '/student', label: t('nav.dashboard', 'Dashboard'), icon: LayoutDashboard, permission: 'learner.access', end: true },
        { to: '/learn', label: term('course', true), icon: Library, permission: 'learner.access', end: true },
        { to: '/attendance', label: t('nav.attendance', 'Attendance'), icon: CalendarCheck, permission: 'learner.access', end: true },
        { to: '/attendance/checkin', label: t('nav.checkIn', 'Check in'), icon: QrCode, permission: 'learner.access' },
        { to: '/learn/achievements', label: t('nav.achievements', 'Achievements'), icon: Award, permission: 'learner.access' },
        { to: '/exams/me', label: t('nav.exams', 'Exams'), icon: ClipboardCheck, permission: 'learner.access' },
        { to: '/fees', label: t('nav.fees', 'Fees'), icon: Wallet, permission: 'learner.access' },
        { to: '/learn/viva', label: t('nav.viva', 'Explain your work'), icon: MessageCircleQuestion, permission: 'learner.access' },
      ],
    },
    {
      title: t('nav.family', 'Family'),
      items: [
        { to: '/parent', label: t('nav.children', 'My children'), icon: Baby, permission: 'guardian.access', end: true },
        { to: '/learn', label: term('course', true), icon: Library, permission: 'guardian.access', end: true },
        { to: '/exams/me', label: t('nav.exams', 'Exams'), icon: ClipboardCheck, permission: 'guardian.access' },
        { to: '/fees', label: t('nav.fees', 'Fees'), icon: Wallet, permission: 'guardian.access' },
      ],
    },
    {
      title: t('nav.everyday', 'Every day'),
      items: [
        { to: '/timetable', label: t('nav.timetable', 'Timetable'), icon: Clock, any: ['teaching.access', 'learner.access', 'guardian.access', 'timetable.manage'] },
        { to: '/calendar', label: t('nav.calendar', 'Calendar'), icon: CalendarDays, any: ['teaching.access', 'learner.access', 'guardian.access'] },
        { to: '/messages', label: t('nav.messages', 'Messages'), icon: MessagesSquare, badge: 'messages' },
        { to: '/announcements', label: t('nav.announcements', 'Announcements'), icon: Megaphone, any: ['announcements.view'] },
        { to: '/meetings', label: t('nav.meetings', 'Parent–teacher meetings'), icon: CalendarClock, any: ['ptm.manage', 'teaching.access', 'guardian.access', 'learner.access'] },
        { to: '/tickets', label: t('nav.tickets', 'Help desk'), icon: LifeBuoy },
        { to: '/attendance/leave', label: t('nav.leave', 'Leave'), icon: Plane, any: ['leave.request', 'leave.approve'] },
        { to: '/surveys', label: t('nav.surveys', 'Surveys'), icon: ClipboardList },
        { to: '/saved', label: t('nav.saved', 'Saved for offline'), icon: CloudDownload },
        { to: '/services', label: t('nav.services', 'Library & transport'), icon: LibraryBig, any: ['learner.access', 'guardian.access'], modules: ['library', 'transport'] },
        { to: '/privacy', label: t('nav.privacy', 'Privacy'), icon: Lock },
        { to: '/help', label: t('nav.help', 'Help'), icon: HelpCircle },
      ],
    },
  ];
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { user, institution, can, logout } = useAuth();
  const mods = useQuery({ queryKey: ['/modules'], queryFn: () => api.get<{ enabled: ModuleKey[] }>('/modules'), enabled: !!user?.institution_id, staleTime: 5 * 60_000 });
  const enabled = mods.data?.enabled ?? [];
  const sections = useNav()
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => (i.any ? i.any.some((p) => can(p)) : i.permission ? can(i.permission) : !!user?.institution_id) && (!i.modules || i.modules.some((m) => enabled.includes(m)))),
    }))
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
                    <n.icon className="size-[18px] shrink-0" aria-hidden /> <span className="flex-1">{n.label}</span>
                    {n.badge === 'messages' && <UnreadBadge />}
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
        <LanguageSelect className="px-3 py-1 sm:hidden" />
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

function UnreadBadge() {
  const q = useUnreadMessages();
  const n = q.data?.unread ?? 0;
  if (!n) return null;
  return <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-fg">{n > 99 ? '99+' : n}</span>;
}

/** Low-bandwidth mode: no autoplay, media on request, smaller uploads. */
export function LowBandwidthToggle() {
  const { t } = useTranslation();
  const low = useLowBandwidth();
  const label = low ? t('lb.on', 'Low-bandwidth mode is on') : t('lb.off', 'Low-bandwidth mode is off');
  return (
    <button type="button" onClick={() => setLowBandwidth(!low)} aria-pressed={low} aria-label={label} title={label} className={cn('rounded-lg p-2 hover:bg-surface-2', low ? 'text-primary' : 'text-fg-muted')}>
      <Gauge className="size-5" aria-hidden />
    </button>
  );
}

function OfflineBanner() {
  const { t } = useTranslation();
  const { offline } = useAuth();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online && !offline) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning/20 px-3 py-1.5 text-sm">
      <WifiOff className="size-4" aria-hidden /> {t('offline.banner', "You're offline — showing what was saved on this device. Attendance you take is sent when you're back.")}
    </div>
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
  // the account remembers the language the person picks
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    return onLanguagePicked((code) => void api.put('/notifications/account-preferences', { locale: code }).catch(() => {}));
  }, [user]);

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
          <LowBandwidthToggle />
          <ThemeToggle />
          <NotificationBell />
        </header>
        <SupportSessionBanner />
        <OfflineBanner />
        <PlatformBanner />
        <main id="main" className="flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
        <FeedbackWidget />
        <ProductTour />
      </div>
    </div>
  );
}


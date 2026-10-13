import React, { useCallback, useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api, getUser, getSchool, logout } from './api';
import {
  LayoutDashboard, Building2, Users, GraduationCap, Wallet, Megaphone,
  BookOpen, ClipboardList, ScrollText, LogOut, School, Bell, X,
  CalendarCheck, PenSquare, FileText, Baby, KeyRound, Copy, CheckCircle2, ChevronLeft, ChevronRight,
} from 'lucide-react';

const NAV = {
  super_admin: [
    { to: '/platform', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/platform/schools', label: 'Schools', icon: Building2 },
    { to: '/platform/audit', label: 'Audit Log', icon: ScrollText },
  ],
  school_admin: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/students', label: 'Students', icon: Users },
    { to: '/admin/teachers', label: 'Teachers', icon: GraduationCap },
    { to: '/admin/classes', label: 'Classes', icon: BookOpen },
    { to: '/admin/fees', label: 'Fees', icon: Wallet },
    { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
  ],
  teacher: [
    { to: '/teacher', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/teacher/attendance', label: 'Attendance', icon: CalendarCheck },
    { to: '/teacher/gradebook', label: 'Gradebook', icon: PenSquare },
    { to: '/teacher/assignments', label: 'Assignments', icon: ClipboardList },
    { to: '/teacher/announcements', label: 'Announcements', icon: Megaphone },
  ],
  student: [
    { to: '/student', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/student/assignments', label: 'Assignments', icon: ClipboardList },
  ],
  parent: [
    { to: '/parent', label: 'My Children', icon: Baby, end: true },
  ],
};
const ROLE_LABEL = { super_admin: 'Platform', school_admin: 'Administrator', teacher: 'Teacher', student: 'Student', parent: 'Parent' };

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const load = () => api.get('/me/notifications').then((r) => setData(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const markAll = async () => { await api.post('/me/notifications/read-all'); load(); };
  return (
    <div className="relative">
      <button onClick={() => { setOpen(!open); }} className="relative p-2 rounded-lg hover:bg-slate-100">
        <Bell size={20} className="text-slate-600" />
        {data.unread > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white text-[10px] rounded-full grid place-items-center">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-lg z-20">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="font-semibold text-slate-800">Notifications</span>
            {data.unread > 0 && <button onClick={markAll} className="text-xs text-indigo-600 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {data.items.length === 0 ? <div className="px-4 py-8 text-center text-slate-400 text-sm">No notifications</div> :
              data.items.map((n) => (
                <div key={n.id} className={`px-4 py-3 border-b border-slate-50 ${!n.is_read ? 'bg-indigo-50/50' : ''}`}>
                  <div className="text-sm font-medium text-slate-800">{n.title}</div>
                  <div className="text-xs text-slate-500">{n.message}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }) {
  const user = getUser();
  const school = getSchool();
  const nav = NAV[user?.role] || [];
  const accent = school?.primary_color || '#4F46E5';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-800">
      <aside className="w-64 shrink-0 bg-slate-900 text-slate-300 flex flex-col">
        <div className="px-5 py-5 flex items-center gap-2 border-b border-slate-800">
          <div className="w-9 h-9 rounded-lg grid place-items-center text-white font-bold" style={{ background: accent }}>A</div>
          <div><div className="text-white font-bold text-lg leading-tight">Acadex</div><div className="text-[11px] text-slate-400">{ROLE_LABEL[user?.role]} Portal</div></div>
        </div>
        {school && <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-2 text-sm"><School size={15} className="text-slate-500" /><span className="truncate text-slate-200">{school.name}</span></div>}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${isActive ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60 hover:text-white'}`}>
              <n.icon size={18} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <div className="px-2 py-2 text-sm"><div className="text-white font-medium truncate">{user?.full_name}</div><div className="text-xs text-slate-500 truncate">{user?.email}</div></div>
          <NavLink to="/change-password" className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-slate-800 text-slate-300"><KeyRound size={16} /> Change password</NavLink>
          <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-slate-800 text-slate-300"><LogOut size={16} /> Sign out</button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-x-hidden">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-end px-8 gap-2">
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-x-hidden"><div className="max-w-7xl mx-auto px-8 py-8">{children}</div></main>
      </div>
    </div>
  );
}

export const PageHeader = ({ title, subtitle, action }) => (
  <div className="flex items-start justify-between mb-6">
    <div><h1 className="text-2xl font-bold text-slate-900">{title}</h1>{subtitle && <p className="text-slate-500 mt-1 text-sm">{subtitle}</p>}</div>
    {action}
  </div>
);
export const Card = ({ children, className = '' }) => <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>{children}</div>;
export const StatCard = ({ label, value, icon: Icon, tint = '#4F46E5', sub }) => (
  <Card className="p-5"><div className="flex items-center justify-between">
    <div><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div><div className="text-3xl font-bold text-slate-900 mt-1">{value}</div>{sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}</div>
    {Icon && <div className="w-11 h-11 rounded-lg grid place-items-center" style={{ background: tint + '1a', color: tint }}><Icon size={22} /></div>}
  </div></Card>
);
const BADGE = {
  active: 'bg-emerald-100 text-emerald-700', Paid: 'bg-emerald-100 text-emerald-700', Present: 'bg-emerald-100 text-emerald-700',
  suspended: 'bg-rose-100 text-rose-700', Pending: 'bg-rose-100 text-rose-700', Absent: 'bg-rose-100 text-rose-700',
  Partial: 'bg-amber-100 text-amber-700', Leave: 'bg-amber-100 text-amber-700',
  pro: 'bg-indigo-100 text-indigo-700', free: 'bg-slate-100 text-slate-600', enterprise: 'bg-violet-100 text-violet-700',
};
export const Badge = ({ children }) => <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${BADGE[children] || 'bg-slate-100 text-slate-600'}`}>{children}</span>;
export const Table = ({ columns, rows, render }) => (
  <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm">
    <thead><tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">{columns.map((c) => <th key={c} className="px-5 py-3 font-semibold text-xs uppercase tracking-wide">{c}</th>)}</tr></thead>
    <tbody className="divide-y divide-slate-100">
      {rows.length === 0 ? <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-slate-400">No records found</td></tr>
        : rows.map((r, i) => <tr key={i} className="hover:bg-slate-50">{render(r)}</tr>)}
    </tbody>
  </table></div></Card>
);
export const Td = ({ children, className = '' }) => <td className={`px-5 py-3 ${className}`}>{children}</td>;
export const Spinner = () => <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-3 border-slate-200 border-t-indigo-600 rounded-full animate-spin" /></div>;

export const Button = ({ children, className = '', ...p }) => (
  <button {...p} className={`inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-medium transition ${className}`}>{children}</button>
);

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-30 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
export const Field = ({ label, ...p }) => (
  <label className="block mb-3"><span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
    <input {...p} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm" /></label>
);
export const SelectField = ({ label, options, ...p }) => (
  <label className="block mb-3"><span className="block text-sm font-medium text-slate-700 mb-1">{label}</span>
    <select {...p} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-white">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select></label>
);
// Shown once after an account is created. The password is not stored anywhere readable,
// so it cannot be shown again — the user replaces it at first sign-in.
export function CredentialsNotice({ title, email, tempPassword, onDone }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(`Email: ${email}
One-time password: ${tempPassword}`); setCopied(true); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="text-center py-2">
      <CheckCircle2 size={44} className="text-emerald-500 mx-auto mb-3" />
      <div className="font-semibold text-slate-800 text-lg">{title}</div>
      <div className="text-sm text-slate-500 mt-1">Share these sign-in details. They will be asked to choose their own password at first sign-in.</div>
      <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-left">
        <div><span className="text-slate-500">Email:</span> <b className="break-all">{email}</b></div>
        <div><span className="text-slate-500">One-time password:</span> <b className="font-mono select-all">{tempPassword}</b></div>
      </div>
      <div className="text-xs text-amber-700 mt-2">This password is shown only once.</div>
      <div className="mt-4 flex justify-center gap-2">
        <button type="button" onClick={copy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-50"><Copy size={16} /> {copied ? 'Copied' : 'Copy'}</button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

// Loads one page of a paginated list endpoint (total comes from the X-Total-Count header).
export function usePaged(path, params = {}, pageSize = 50) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ rows: null, total: 0, error: '' });
  const key = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [key]);
  const load = useCallback(() => api.get(path, { params: { ...JSON.parse(key), page, pageSize } })
    .then((r) => setState({ rows: r.data, total: Number(r.headers['x-total-count'] ?? r.data.length), error: '' }))
    .catch((e) => setState((st) => ({ ...st, rows: st.rows ?? [], error: e.response?.data?.error || 'Could not load this list' }))),
  [path, key, page, pageSize]);
  useEffect(() => { load(); }, [load]);
  return { ...state, page, pageSize, setPage, reload: load };
}

export function Pager({ page, pageSize, total, setPage }) {
  if (total <= pageSize) return null;
  const last = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm disabled:opacity-40 hover:bg-slate-50';
  return (
    <nav className="flex items-center justify-between mt-3 text-sm text-slate-500" aria-label="Pagination">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /> Prev</button>
        <button type="button" className={btn} disabled={page >= last} onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} /></button>
      </div>
    </nav>
  );
}

export const ErrorNote = ({ children }) => (children ? <div role="alert" className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{children}</div> : null);

export { FileText };

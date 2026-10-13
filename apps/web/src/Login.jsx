import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, saveAuth, HOME } from './api';
import { GraduationCap, ShieldCheck, BarChart3, Users } from 'lucide-react';

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      saveAuth(data);
      nav(data.user.must_change_password ? '/change-password' : HOME[data.user.role] || '/login', { replace: true });
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 text-white bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-900">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center font-bold text-xl">A</div>
          <span className="text-2xl font-bold">Acadex</span>
        </div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">The all-in-one platform to run your school.</h1>
          <p className="mt-4 text-indigo-200 text-lg">Admissions, attendance, grading, fees and analytics — for every school, on one multi-tenant SaaS.</p>
          <div className="mt-8 space-y-3 text-indigo-100">
            <div className="flex items-center gap-3"><ShieldCheck size={20} /> Secure, role-based access</div>
            <div className="flex items-center gap-3"><BarChart3 size={20} /> Real-time dashboards & insights</div>
            <div className="flex items-center gap-3"><Users size={20} /> Admin, teacher & student portals</div>
          </div>
        </div>
        <div className="text-indigo-300 text-sm">© 2026 Acadex. All rights reserved.</div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-8 bg-slate-50">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white grid place-items-center font-bold text-xl">A</div>
            <span className="text-2xl font-bold text-slate-900">Acadex</span>
          </div>
          <div className="flex items-center gap-2 text-indigo-600 mb-2"><GraduationCap size={22} /><span className="font-semibold">Welcome back</span></div>
          <h2 className="text-2xl font-bold text-slate-900">Sign in to your account</h2>
          <p className="text-slate-500 text-sm mt-1 mb-6">Enter your credentials to continue</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                placeholder="you@school.edu"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
            </div>
            {err && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
            <button disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 text-xs text-slate-500 bg-white border border-slate-200 rounded-lg p-3">
            <div className="font-semibold text-slate-600 mb-1">Demo accounts (password: Acadex@123)</div>
            <div>superadmin@acadex.com · admin@greenwood.edu</div>
          </div>
        </div>
      </div>
    </div>
  );
}

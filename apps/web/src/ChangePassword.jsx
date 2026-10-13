import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { api, getUser, getSchool, saveAuth, logout, HOME } from './api';

export default function ChangePassword() {
  const nav = useNavigate();
  const user = getUser();
  const forced = !!user?.must_change_password;
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (form.next !== form.confirm) return setErr('The new passwords do not match');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/change-password', { current_password: form.current, new_password: form.next });
      saveAuth({ token: data.token, user: data.user, school: getSchool() });
      nav(HOME[data.user.role] || '/login', { replace: true });
    } catch (e2) {
      const d = e2.response?.data;
      setErr(d?.details?.[0]?.message || d?.error || 'Could not change the password');
    } finally {
      setLoading(false);
    }
  };

  const input = 'w-full px-3 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none';
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 text-indigo-600 mb-2"><KeyRound size={22} /><span className="font-semibold">{forced ? 'Welcome to Acadex' : 'Account security'}</span></div>
        <h1 className="text-xl font-bold text-slate-900">{forced ? 'Choose your own password' : 'Change password'}</h1>
        <p className="text-slate-500 text-sm mt-1 mb-5">
          {forced ? 'You signed in with a one-time password. Set a new one to continue.' : 'You will stay signed in on this device; other devices will be signed out.'}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1">{forced ? 'One-time password' : 'Current password'}</span>
            <input type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required className={input} /></label>
          <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1">New password</span>
            <input type="password" autoComplete="new-password" minLength={10} value={form.next} onChange={set('next')} required className={input} />
            <span className="block text-xs text-slate-500 mt-1">At least 10 characters, with letters and numbers.</span></label>
          <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</span>
            <input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required className={input} /></label>
          {err && <div role="alert" className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
          <button disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition">
            {loading ? 'Saving…' : 'Save password'}
          </button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          {!forced && <button type="button" onClick={() => nav(-1)} className="text-slate-500 hover:underline">Cancel</button>}
          <button type="button" onClick={logout} className="text-slate-500 hover:underline ml-auto">Sign out</button>
        </div>
      </div>
    </div>
  );
}

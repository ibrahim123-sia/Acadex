import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { PageHeader, StatCard, Card, Table, Td, Badge, Spinner, Button, Modal, Field, SelectField, CredentialsNotice } from '../ui';
import { Building2, Users, GraduationCap, Wallet, Plus } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const money = (n) => 'PKR ' + Number(n || 0).toLocaleString();

export function PlatformDashboard() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/platform/stats').then((r) => setD(r.data)); }, []);
  if (!d) return <Spinner />;
  const chart = d.recentSchools.map((s) => ({ name: s.name.split(' ')[0], students: s.students }));
  return (
    <>
      <PageHeader title="Platform Overview" subtitle="Cross-tenant metrics across all schools on Acadex" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard label="Schools" value={d.schools} icon={Building2} tint="#4F46E5" sub={`${d.activeSchools} active`} />
        <StatCard label="Students" value={d.students} icon={Users} tint="#0891B2" />
        <StatCard label="Teachers" value={d.teachers} icon={GraduationCap} tint="#16A34A" />
        <StatCard label="Revenue Collected" value={money(d.revenue)} icon={Wallet} tint="#D97706" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Students per School</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} />
              <Tooltip /><Bar dataKey="students" fill="#4F46E5" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Recently Onboarded</h3>
          <div className="space-y-3">
            {d.recentSchools.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
                <div><div className="font-medium text-slate-800">{s.name}</div><div className="text-xs text-slate-400">{s.students} students</div></div>
                <Badge>{s.plan}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

export function PlatformSchools() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', plan: 'free', adminName: '', adminEmail: '' });
  const [created, setCreated] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.get('/platform/schools').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { const { data } = await api.post('/platform/schools', form); setCreated(data); load(); }
    catch (e2) { setErr(e2.response?.data?.error || 'Failed'); }
  };
  const close = () => { setOpen(false); setCreated(null); setErr(''); setForm({ name: '', slug: '', plan: 'free', adminName: '', adminEmail: '' }); };
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Schools" subtitle="All tenant schools on the platform"
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Register School</Button>} />
      <Table columns={['School', 'Plan', 'Students', 'Teachers', 'Classes', 'Status']} rows={rows} render={(s) => (
        <>
          <Td><div className="font-medium text-slate-800">{s.name}</div><div className="text-xs text-slate-400">{s.contact_email}</div></Td>
          <Td><Badge>{s.plan}</Badge></Td><Td>{s.students}</Td><Td>{s.teachers}</Td><Td>{s.classes}</Td><Td><Badge>{s.status}</Badge></Td>
        </>
      )} />
      {open && (
        <Modal title="Register a New School" onClose={close}>
          {created ? (
            <CredentialsNotice title={`${created.school.name} onboarded!`} email={created.admin.email} tempPassword={created.admin.tempPassword} onDone={close} />
          ) : (
            <form onSubmit={submit}>
              <Field label="School name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') })} required placeholder="e.g. Beaconhouse School" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Slug (unique)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
                <SelectField label="Plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} options={[{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }, { value: 'enterprise', label: 'Enterprise' }]} />
              </div>
              <Field label="Admin name" value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} placeholder="Principal / Admin name" />
              <Field label="Admin email" type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required placeholder="admin@school.edu" />
              {err && <div className="text-sm text-rose-600 mb-2">{err}</div>}
              <div className="flex justify-end mt-2"><Button type="submit">Register School</Button></div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function PlatformAudit() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/platform/audit').then((r) => setRows(r.data)); }, []);
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Audit Log" subtitle="Platform-wide activity trail" />
      <Table columns={['When', 'School', 'Actor', 'Action', 'Entity']} rows={rows} render={(a) => (
        <>
          <Td className="text-slate-500 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</Td>
          <Td>{a.school_name || '—'}</Td><Td>{a.actor}</Td>
          <Td><span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{a.action}</span></Td>
          <Td>{a.entity}</Td>
        </>
      )} />
    </>
  );
}

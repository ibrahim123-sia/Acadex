import React, { useEffect, useState } from 'react';
import { api, downloadPdf } from '../api';
import { formatMoney as money } from '../format';
import { PageHeader, StatCard, Card, Table, Td, Badge, Spinner, Button, Modal, Field, SelectField, CredentialsNotice } from '../ui';
import { Users, GraduationCap, BookOpen, Wallet, Search, Megaphone, Plus, FileText } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

const PIE = { Paid: '#16A34A', Partial: '#D97706', Pending: '#DC2626' };

export function AdminDashboard() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/school/dashboard').then((r) => setD(r.data)); }, []);
  if (!d) return <Spinner />;
  const feePie = d.feeStatus.map((f) => ({ name: f.payment_status, value: f.c }));
  const classBar = d.classDistribution.map((c) => ({ name: c.name.replace('Class ', 'C'), students: c.students }));
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of your school" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard label="Students" value={d.students} icon={Users} tint="#4F46E5" />
        <StatCard label="Teachers" value={d.teachers} icon={GraduationCap} tint="#0891B2" />
        <StatCard label="Classes" value={d.classes} icon={BookOpen} tint="#7C3AED" />
        <StatCard label="Fees Collected" value={money(d.feeCollected)} icon={Wallet} tint="#16A34A" sub={money(d.feeOutstanding) + ' outstanding'} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
        <Card className="p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Fee Status</h3>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart><Pie data={feePie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
              {feePie.map((e) => <Cell key={e.name} fill={PIE[e.name] || '#94a3b8'} />)}</Pie><Tooltip /><Legend /></PieChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-semibold text-slate-800 mb-4">Students by Class</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={classBar}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} allowDecimals={false} /><Tooltip />
              <Bar dataKey="students" fill="#4F46E5" radius={[6, 6, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <Card className="p-5">
        <h3 className="font-semibold text-slate-800 mb-3">Recent Admissions</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {d.recentStudents.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border border-slate-100 rounded-lg p-3">
              <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-semibold">{s.first_name[0]}</div>
              <div><div className="font-medium text-slate-800 text-sm">{s.first_name} {s.last_name}</div><div className="text-xs text-slate-400">{s.roll_no}</div></div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

export function AdminStudents() {
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [classes, setClasses] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', gender: 'Male', age: '', class_id: '', guardian_name: '' });
  const [err, setErr] = useState('');
  const [created, setCreated] = useState(null);
  const close = () => { setOpen(false); setCreated(null); setErr(''); };
  const load = (s = '') => api.get('/school/students', { params: { search: s } }).then((r) => setRows(r.data));
  useEffect(() => { load(); api.get('/school/classes').then((r) => setClasses(r.data)); }, []);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { const { data } = await api.post('/school/students', { ...form, age: form.age ? Number(form.age) : null }); setCreated(data); setForm({ first_name: '', last_name: '', email: '', gender: 'Male', age: '', class_id: '', guardian_name: '' }); load(search); }
    catch (e2) { setErr(e2.response?.data?.error || 'Failed'); }
  };
  return (
    <>
      <PageHeader title="Students" subtitle="Manage student records"
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Admit Student</Button>} />
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); load(e.target.value); }} placeholder="Search by name or roll no…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none text-sm" />
      </div>
      {!rows ? <Spinner /> : (
        <Table columns={['Roll No', 'Name', 'Class', 'Gender', 'Fee', 'Status', '']} rows={rows} render={(s) => (
          <>
            <Td className="font-mono text-xs">{s.roll_no}</Td>
            <Td className="font-medium text-slate-800">{s.first_name} {s.last_name}</Td>
            <Td>{s.class_name || '—'}</Td><Td>{s.gender}</Td>
            <Td><Badge>{s.fee_status}</Badge></Td><Td><Badge>{s.status}</Badge></Td>
            <Td><button onClick={() => downloadPdf(`/pdf/report-card/${s.id}`, `report-card-${s.roll_no}.pdf`)} className="text-indigo-600 hover:underline text-sm flex items-center gap-1"><FileText size={14} /> Report</button></Td>
          </>
        )} />
      )}
      {open && (
        <Modal title="Admit New Student" onClose={close}>
          {created ? <CredentialsNotice title={`${created.first_name} ${created.last_name} admitted`} {...created.login} onDone={close} /> : (
          <form onSubmit={submit}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
              <Field label="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
            </div>
            <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <div className="grid grid-cols-3 gap-3">
              <SelectField label="Gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} />
              <Field label="Age" type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} />
              <SelectField label="Class" value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}
                options={[{ value: '', label: 'Select…' }, ...classes.map((c) => ({ value: c.id, label: c.name }))]} />
            </div>
            <Field label="Guardian name" value={form.guardian_name} onChange={(e) => setForm({ ...form, guardian_name: e.target.value })} />
            {err && <div className="text-sm text-rose-600 mb-2">{err}</div>}
            <div className="flex justify-end mt-2"><Button type="submit">Admit Student</Button></div>
          </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function AdminTeachers() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', gender: 'Male', phone: '', qualification: '' });
  const [err, setErr] = useState('');
  const [created, setCreated] = useState(null);
  const close = () => { setOpen(false); setCreated(null); setErr(''); };
  const load = () => api.get('/school/teachers').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { const { data } = await api.post('/school/teachers', form); setCreated(data); setForm({ first_name: '', last_name: '', email: '', gender: 'Male', phone: '', qualification: '' }); load(); }
    catch (e2) { setErr(e2.response?.data?.error || 'Failed'); }
  };
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Teachers" subtitle="Faculty directory" action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Add Teacher</Button>} />
      <Table columns={['Name', 'Email', 'Gender', 'Phone', 'Qualification', 'Subjects']} rows={rows} render={(t) => (
        <><Td className="font-medium text-slate-800">{t.first_name} {t.last_name}</Td><Td className="text-slate-500">{t.email}</Td>
          <Td>{t.gender}</Td><Td>{t.phone}</Td><Td>{t.qualification}</Td><Td>{t.subjects}</Td></>
      )} />
      {open && (
        <Modal title="Add Teacher" onClose={close}>
          {created ? <CredentialsNotice title={`${created.first_name} ${created.last_name} added`} {...created.login} onDone={close} /> : (
          <form onSubmit={submit}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
              <Field label="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
            </div>
            <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} />
              <Field label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <Field label="Qualification" value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })} placeholder="e.g. M.Sc Mathematics" />
            {err && <div className="text-sm text-rose-600 mb-2">{err}</div>}
            <div className="flex justify-end mt-2"><Button type="submit">Add Teacher</Button></div>
          </form>
          )}
        </Modal>
      )}
    </>
  );
}

export function AdminClasses() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', section: 'A' });
  const load = () => api.get('/school/classes').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  const submit = async (e) => { e.preventDefault(); await api.post('/school/classes', form); setOpen(false); setForm({ code: '', name: '', section: 'A' }); load(); };
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Classes" subtitle="Class sections and enrolment" action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Create Class</Button>} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="flex items-center justify-between">
              <div><div className="text-lg font-bold text-slate-900">{c.name}</div><div className="text-xs text-slate-400">Section {c.section} · {c.code}</div></div>
              <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 grid place-items-center font-bold">{c.code}</div>
            </div>
            <div className="flex gap-4 mt-4 text-sm">
              <div><span className="font-bold text-slate-800">{c.students}</span> <span className="text-slate-400">students</span></div>
              <div><span className="font-bold text-slate-800">{c.subjects}</span> <span className="text-slate-400">subjects</span></div>
            </div>
          </Card>
        ))}
      </div>
      {open && (
        <Modal title="Create Class" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Class code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="e.g. C11" />
            <Field label="Class name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Class XI" />
            <Field label="Section" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} />
            <div className="flex justify-end mt-2"><Button type="submit">Create Class</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AdminFees() {
  const [rows, setRows] = useState(null);
  const [students, setStudents] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ student_id: '', total_fee: '', paid_amount: '' });
  const load = () => api.get('/school/fees').then((r) => setRows(r.data));
  useEffect(() => { load(); api.get('/school/students').then((r) => setStudents(r.data)); }, []);
  const submit = async (e) => { e.preventDefault(); await api.post('/school/fees', { ...form, total_fee: Number(form.total_fee), paid_amount: Number(form.paid_amount || 0) }); setOpen(false); setForm({ student_id: '', total_fee: '', paid_amount: '' }); load(); };
  if (!rows) return <Spinner />;
  const collected = rows.reduce((a, r) => a + Number(r.paid_amount), 0);
  const outstanding = rows.reduce((a, r) => a + Number(r.remaining_balance), 0);
  return (
    <>
      <PageHeader title="Fees" subtitle="Tuition fee collection & receipts" action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Collect Fee</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
        <StatCard label="Collected" value={money(collected)} icon={Wallet} tint="#16A34A" />
        <StatCard label="Outstanding" value={money(outstanding)} icon={Wallet} tint="#DC2626" />
        <StatCard label="Receipts" value={rows.length} icon={Wallet} tint="#4F46E5" />
      </div>
      <Table columns={['Receipt', 'Student', 'Total', 'Paid', 'Balance', 'Status', '']} rows={rows} render={(f) => (
        <>
          <Td className="font-mono text-xs">{f.receipt_id}</Td>
          <Td className="font-medium text-slate-800">{f.student}<div className="text-xs text-slate-400">{f.roll_no}</div></Td>
          <Td>{money(f.total_fee)}</Td><Td>{money(f.paid_amount)}</Td><Td>{money(f.remaining_balance)}</Td>
          <Td><Badge>{f.payment_status}</Badge></Td>
          <Td><button onClick={() => downloadPdf(`/pdf/fee-voucher/${f.id}`, `voucher-${f.receipt_id}.pdf`)} className="text-indigo-600 hover:underline text-sm flex items-center gap-1"><FileText size={14} /> Voucher</button></Td>
        </>
      )} />
      {open && (
        <Modal title="Collect Fee" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <SelectField label="Student" value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}
              options={[{ value: '', label: 'Select student…' }, ...students.map((s) => ({ value: s.id, label: `${s.first_name} ${s.last_name} (${s.roll_no})` }))]} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Total fee" type="number" value={form.total_fee} onChange={(e) => setForm({ ...form, total_fee: e.target.value })} required />
              <Field label="Paid amount" type="number" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
            </div>
            <div className="flex justify-end mt-2"><Button type="submit">Save Receipt</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AdminAnnouncements() {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', target_audience: 'All', description: '' });
  const load = () => api.get('/school/announcements').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);
  const submit = async (e) => { e.preventDefault(); await api.post('/school/announcements', form); setOpen(false); setForm({ title: '', target_audience: 'All', description: '' }); load(); };
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Announcements" subtitle="School-wide notices" action={<Button onClick={() => setOpen(true)}><Plus size={16} /> New Announcement</Button>} />
      <div className="space-y-3">
        {rows.map((a) => (
          <Card key={a.id} className="p-5 flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 grid place-items-center shrink-0"><Megaphone size={18} /></div>
              <div><div className="font-semibold text-slate-800">{a.title}</div><div className="text-sm text-slate-500 mt-0.5">{a.description}</div></div>
            </div>
            <Badge>{a.target_audience}</Badge>
          </Card>
        ))}
      </div>
      {open && (
        <Modal title="New Announcement" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <SelectField label="Audience" value={form.target_audience} onChange={(e) => setForm({ ...form, target_audience: e.target.value })}
              options={[{ value: 'All', label: 'All' }, { value: 'Teachers', label: 'Teachers' }, { value: 'Students', label: 'Students' }]} />
            <Field label="Message" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
            <div className="flex justify-end mt-2"><Button type="submit">Publish</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

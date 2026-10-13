import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { formatMoney as money, formatDate } from '../format';
import { PageHeader, StatCard, Card, Table, Td, Badge, Spinner, Button, Modal, Field, usePaged, Pager, ErrorNote } from '../ui';
import { TrendingUp, CalendarCheck, Wallet, Upload } from 'lucide-react';


export function StudentDashboard() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/me/student/overview').then((r) => setD(r.data)); }, []);
  if (!d) return <Spinner />;
  const p = d.profile || {};
  const present = d.attendance.find((a) => a.status === 'Present')?.c || 0;
  const total = d.attendance.reduce((s, a) => s + a.c, 0) || 1;
  const attPct = Math.round((present / total) * 100);
  const avg = d.grades.length ? Math.round(d.grades.reduce((s, g) => s + Number(g.percentage || 0), 0) / d.grades.length) : 0;
  return (
    <>
      <PageHeader title={`Hi, ${p.first_name || 'Student'} 👋`} subtitle={`${p.class_name || ''} · Roll ${p.roll_no || ''}`} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
        <StatCard label="Average Grade" value={avg + '%'} icon={TrendingUp} tint="#4F46E5" />
        <StatCard label="Attendance" value={attPct + '%'} icon={CalendarCheck} tint="#16A34A" sub={`${present}/${total} days present`} />
        <StatCard label="Fee Status" value={d.fee?.payment_status || '—'} icon={Wallet} tint="#D97706" sub={d.fee ? money(d.fee.remaining_balance) + ' due' : ''} />
      </div>
      <Card className="p-5">
        <h3 className="font-semibold text-slate-800 mb-3">My Grades</h3>
        <Table columns={['Subject', 'Assessment', 'Type', 'Marks', '%']} rows={d.grades} render={(g) => (
          <><Td className="font-medium text-slate-800">{g.subject || '—'}</Td><Td>{g.assignment_name}</Td><Td><Badge>{g.assignment_type}</Badge></Td>
            <Td>{g.obtained_marks}/{g.total_marks}</Td><Td className="font-semibold">{g.percentage}%</Td></>
        )} />
      </Card>
    </>
  );
}

export function StudentAssignments() {
  const list = usePaged('/me/student/assignments');
  const rows = list.rows;
  const [active, setActive] = useState(null);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api.post('/me/student/submissions', { assignment_id: active.id, title: 'My submission', file_link: link });
      setActive(null); setLink(''); list.reload();
    } catch (e2) { setErr(e2.response?.data?.details?.[0]?.message || e2.response?.data?.error || 'Could not submit'); }
  };
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Assignments" subtitle="Your assignments and submissions" />
      <Table columns={['Title', 'Subject', 'Due', 'Status', '']} rows={rows} render={(a) => (
        <>
          <Td className="font-medium text-slate-800">{a.title}<div className="text-xs text-slate-400">{a.description}</div></Td>
          <Td>{a.subject || '—'}</Td><Td>{formatDate(a.due_date)}</Td>
          <Td>{a.submitted ? <Badge>Paid</Badge> : <Badge>Pending</Badge>}</Td>
          <Td>{!a.submitted && <button onClick={() => setActive(a)} className="text-indigo-600 hover:underline text-sm font-medium flex items-center gap-1"><Upload size={14} /> Submit</button>}</Td>
        </>
      )} />
      <Pager {...list} />
      {active && (
        <Modal title={`Submit: ${active.title}`} onClose={() => { setActive(null); setErr(''); }}>
          <form onSubmit={submit}>
            <Field label="File link / URL" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/…" required />
            <ErrorNote>{err}</ErrorNote>
            <div className="flex justify-end mt-2"><Button type="submit"><Upload size={16} /> Submit assignment</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

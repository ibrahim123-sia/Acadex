import React, { useEffect, useState } from 'react';
import { api, downloadPdf } from '../api';
import { formatMoney as money } from '../format';
import { PageHeader, StatCard, Card, Table, Td, Badge, Spinner, Button } from '../ui';
import { TrendingUp, CalendarCheck, Wallet, FileText, ArrowLeft, Baby } from 'lucide-react';


export function ParentDashboard() {
  const [children, setChildren] = useState(null);
  const [child, setChild] = useState(null);
  const [overview, setOverview] = useState(null);

  useEffect(() => { api.get('/parent/children').then((r) => setChildren(r.data)); }, []);
  const openChild = (c) => { setChild(c); setOverview(null); api.get(`/parent/child/${c.id}/overview`).then((r) => setOverview(r.data)); };

  if (!children) return <Spinner />;

  if (child) {
    return (
      <>
        <button onClick={() => setChild(null)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"><ArrowLeft size={16} /> Back to children</button>
        <PageHeader title={child.name} subtitle={`${child.class_name || ''} · Roll ${child.roll_no || ''}`}
          action={<Button onClick={() => downloadPdf(`/pdf/report-card/${child.id}`, `report-card-${child.roll_no || child.id}.pdf`)}><FileText size={16} /> Report Card (PDF)</Button>} />
        {!overview ? <Spinner /> : <ChildOverview o={overview} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title="My Children" subtitle="Monitor your children's academic progress" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {children.map((c) => (
          <Card key={c.id} className="p-5 cursor-pointer hover:shadow-md transition" onClick={() => openChild(c)}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center"><Baby size={22} /></div>
              <div><div className="font-semibold text-slate-800">{c.name}</div><div className="text-xs text-slate-400">{c.class_name} · {c.roll_no}</div></div>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-slate-500">Fee status</span><Badge>{c.fee_status}</Badge>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function ChildOverview({ o }) {
  const present = o.attendance.find((a) => a.status === 'Present')?.c || 0;
  const total = o.attendance.reduce((s, a) => s + a.c, 0) || 1;
  const attPct = Math.round((present / total) * 100);
  const avg = o.grades.length ? Math.round(o.grades.reduce((s, g) => s + Number(g.percentage || 0), 0) / o.grades.length) : 0;
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
        <StatCard label="Average Grade" value={avg + '%'} icon={TrendingUp} tint="#4F46E5" />
        <StatCard label="Attendance" value={attPct + '%'} icon={CalendarCheck} tint="#16A34A" sub={`${present}/${total} present`} />
        <StatCard label="Fee Status" value={o.fee?.payment_status || '—'} icon={Wallet} tint="#D97706" sub={o.fee ? money(o.fee.remaining_balance) + ' due' : ''} />
      </div>
      <Card className="p-5">
        <h3 className="font-semibold text-slate-800 mb-3">Grades</h3>
        <Table columns={['Subject', 'Assessment', 'Marks', '%']} rows={o.grades} render={(g) => (
          <><Td className="font-medium text-slate-800">{g.subject || '—'}</Td><Td>{g.assignment_name}</Td>
            <Td>{g.obtained_marks}/{g.total_marks}</Td><Td className="font-semibold">{g.percentage}%</Td></>
        )} />
      </Card>
    </>
  );
}

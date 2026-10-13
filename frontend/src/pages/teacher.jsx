import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { formatDate, todayISO } from '../format';
import { PageHeader, StatCard, Card, Table, Td, Spinner, Badge, Button, Modal, Field, usePaged, Pager } from '../ui';
import { BookOpen, ClipboardList, Users, Megaphone, CalendarCheck, Save, Plus } from 'lucide-react';

function useClasses() {
  const [classes, setClasses] = useState([]);
  useEffect(() => { api.get('/me/teacher/classes').then((r) => setClasses(r.data)); }, []);
  return classes;
}

export function TeacherDashboard() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/me/teacher/overview').then((r) => setD(r.data)); }, []);
  if (!d) return <Spinner />;
  const p = d.profile || {};
  return (
    <>
      <PageHeader title={`Welcome, ${p.first_name || 'Teacher'} 👋`} subtitle="Your teaching overview" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
        <StatCard label="My Classes" value={d.classes.length} icon={BookOpen} tint="#4F46E5" />
        <StatCard label="My Subjects" value={d.subjects.length} icon={ClipboardList} tint="#0891B2" />
        <StatCard label="My Students" value={d.studentCount} icon={Users} tint="#16A34A" />
      </div>
      <Card className="p-5">
        <h3 className="font-semibold text-slate-800 mb-3">My Subjects & Classes</h3>
        <Table columns={['Subject', 'Class']} rows={d.subjects} render={(s) => (<><Td className="font-medium text-slate-800">{s.subject}</Td><Td>{s.class_name || '—'}</Td></>)} />
      </Card>
    </>
  );
}

export function TeacherAttendance() {
  const classes = useClasses();
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [students, setStudents] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = (cid, dt) => {
    if (!cid) return;
    setSaved(false);
    api.get(`/me/teacher/class/${cid}/roster`, { params: { date: dt } }).then((r) =>
      setStudents(r.data.students.map((s) => ({ ...s, status: s.status || 'Present' }))));
  };
  useEffect(() => { if (classes.length && !classId) { setClassId(classes[0].id); load(classes[0].id, date); } }, [classes]);

  const setStatus = (id, status) => setStudents((prev) => prev.map((s) => s.id === id ? { ...s, status } : s));
  const save = async () => {
    await api.post('/me/teacher/attendance', { class_id: classId, date, records: students.map((s) => ({ student_id: s.id, status: s.status })) });
    setSaved(true);
  };
  const STATUSES = ['Present', 'Absent', 'Leave'];
  const colors = { Present: 'bg-emerald-600', Absent: 'bg-rose-600', Leave: 'bg-amber-500' };

  return (
    <>
      <PageHeader title="Mark Attendance" subtitle="Open a class and mark the whole roster for a day" />
      <Card className="p-4 mb-5 flex flex-wrap items-end gap-4">
        <label className="text-sm"><span className="block text-slate-600 mb-1">Class</span>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); load(e.target.value, date); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.students} students)</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="block text-slate-600 mb-1">Date</span>
          <input type="date" value={date} onChange={(e) => { setDate(e.target.value); load(classId, e.target.value); }}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
        </label>
        <div className="ml-auto">
          <Button onClick={save} disabled={!students}><Save size={16} /> Save Attendance</Button>
        </div>
      </Card>
      {saved && <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ Attendance saved for {date}</div>}
      {!students ? <Spinner /> : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-500">
              <th className="px-5 py-3 text-xs uppercase font-semibold">Roll No</th>
              <th className="px-5 py-3 text-xs uppercase font-semibold">Student</th>
              <th className="px-5 py-3 text-xs uppercase font-semibold text-right">Status</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{s.roll_no}</Td>
                  <Td className="font-medium text-slate-800">{s.name}</Td>
                  <Td>
                    <div className="flex gap-1.5 justify-end">
                      {STATUSES.map((st) => (
                        <button key={st} onClick={() => setStatus(s.id, st)}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition ${s.status === st ? colors[st] + ' text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{st}</button>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

export function TeacherGradebook() {
  const classes = useClasses();
  const [classId, setClassId] = useState('');
  const [students, setStudents] = useState(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('Quiz');
  const [total, setTotal] = useState(100);
  const [saved, setSaved] = useState(false);

  const load = (cid) => { if (cid) api.get(`/me/teacher/class/${cid}/roster`).then((r) => setStudents(r.data.students.map((s) => ({ ...s, marks: '' })))); };
  useEffect(() => { if (classes.length && !classId) { setClassId(classes[0].id); load(classes[0].id); } }, [classes]);
  const save = async () => {
    await api.post('/me/teacher/grades', {
      class_id: classId, assignment_type: type, assignment_name: name, total_marks: Number(total),
      records: students.filter((s) => s.marks !== '').map((s) => ({ student_id: s.id, obtained_marks: Number(s.marks) })),
    });
    setSaved(true);
  };
  return (
    <>
      <PageHeader title="Gradebook" subtitle="Enter marks for a class assessment" />
      <Card className="p-4 mb-5 grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
        <label className="text-sm"><span className="block text-slate-600 mb-1">Class</span>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); load(e.target.value); }} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="text-sm"><span className="block text-slate-600 mb-1">Assessment</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Math Quiz 1" className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" /></label>
        <label className="text-sm"><span className="block text-slate-600 mb-1">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
            {['Quiz', 'Midterm', 'Assignment', 'Final'].map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="text-sm"><span className="block text-slate-600 mb-1">Total Marks</span>
          <input type="number" value={total} onChange={(e) => setTotal(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" /></label>
      </Card>
      {saved && <div className="mb-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ Grades saved</div>}
      {!students ? <Spinner /> : (<>
        <Card className="overflow-hidden mb-4">
          <table className="w-full text-sm"><thead><tr className="bg-slate-50 border-b text-left text-slate-500">
            <th className="px-5 py-3 text-xs uppercase font-semibold">Roll No</th><th className="px-5 py-3 text-xs uppercase font-semibold">Student</th><th className="px-5 py-3 text-xs uppercase font-semibold">Marks</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s) => (<tr key={s.id}><Td className="font-mono text-xs">{s.roll_no}</Td><Td className="font-medium text-slate-800">{s.name}</Td>
                <Td><input type="number" value={s.marks} onChange={(e) => setStudents((p) => p.map((x) => x.id === s.id ? { ...x, marks: e.target.value } : x))}
                  placeholder={`/ ${total}`} className="w-24 px-2 py-1 rounded border border-slate-300 text-sm" /></Td></tr>))}
            </tbody></table>
        </Card>
        <Button onClick={save} disabled={!name}><Save size={16} /> Save Grades</Button>
      </>)}
    </>
  );
}

export function TeacherAssignments() {
  const classes = useClasses();
  const list = usePaged('/me/teacher/assignments');
  const rows = list.rows;
  const load = list.reload;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ class_id: '', title: '', description: '', due_date: '' });
  const submit = async (e) => {
    e.preventDefault();
    await api.post('/me/teacher/assignments', { ...form, class_id: form.class_id || classes[0]?.id });
    setOpen(false); setForm({ class_id: '', title: '', description: '', due_date: '' }); load();
  };
  return (
    <>
      <PageHeader title="Assignments" subtitle="Assign to a whole class at once"
        action={<Button onClick={() => setOpen(true)}><Plus size={16} /> New Assignment</Button>} />
      {!rows ? <Spinner /> : (
        <Table columns={['Title', 'Class', 'Subject', 'Due', 'Submissions']} rows={rows} render={(a) => (
          <><Td className="font-medium text-slate-800">{a.title}</Td><Td>{a.class_name}</Td><Td>{a.subject || '—'}</Td>
            <Td>{formatDate(a.due_date)}</Td><Td><Badge>{a.submissions + ' submitted'}</Badge></Td></>
        )} />
      )}
      {rows && <Pager {...list} />}
      {open && (
        <Modal title="Assign to a class" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <label className="block mb-3"><span className="block text-sm font-medium text-slate-700 mb-1">Class</span>
              <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white">
                <option value="">Select class…</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.students} students)</option>)}
              </select></label>
            <Field label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Chapter 4 Worksheet" />
            <Field label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Instructions…" />
            <Field label="Due date" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            <div className="flex justify-end gap-2 mt-2"><Button type="submit">Assign to class</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function TeacherAnnouncements() {
  const list = usePaged('/me/announcements', {}, 20);
  const rows = list.rows;
  if (!rows) return <Spinner />;
  return (
    <>
      <PageHeader title="Announcements" subtitle="Notices for staff" />
      <div className="space-y-3">{rows.map((a) => (
        <Card key={a.id} className="p-5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 grid place-items-center shrink-0"><Megaphone size={18} /></div>
          <div className="flex-1"><div className="font-semibold text-slate-800">{a.title}</div><div className="text-sm text-slate-500">{a.description}</div></div>
          <Badge>{a.target_audience}</Badge>
        </Card>))}</div>
      <Pager {...list} />
    </>
  );
}

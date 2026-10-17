// Attendance: taking a register (one tap per student, "all present", works offline and syncs
// later, QR self check-in), leave requests and approvals, staff attendance, and a student's
// attendance with the threshold.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { CheckCheck, CloudOff, QrCode, Save, ScanLine } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, todayISO } from '@/lib/format';
import { offlineQueue } from '@/lib/lms';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, StatCard, useToast } from '@/components/ui';

const STATUSES = ['present', 'absent', 'late', 'excused', 'leave'] as const;
type Mark = (typeof STATUSES)[number];
const STYLE: Record<Mark, string> = {
  present: 'bg-success text-white',
  absent: 'bg-danger text-white',
  late: 'bg-warning text-white',
  excused: 'bg-primary text-primary-fg',
  leave: 'bg-fg-muted text-white',
};
const SHORT: Record<Mark, string> = { present: 'P', absent: 'A', late: 'L', excused: 'E', leave: 'LV' };

interface MySection {
  id: number;
  name: string;
  label: string | null;
  homeroom: boolean;
  students: number;
  courses: { offering_id: number; course: string }[];
}
interface RegisterStudent {
  id: number;
  roll_no: string | null;
  name: string;
  status: Mark | null;
  minutes_late: number | null;
  on_leave: string | null;
}
interface Register {
  date: string;
  session: { id: number } | null;
  holiday: string | null;
  working_day: boolean;
  students: RegisterStudent[];
}

export function RegisterPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [search, setSearch] = useSearchParams();
  const sections = useQuery({
    queryKey: ['my-sections-att'],
    queryFn: () => (can('attendance.manage') ? api.all<{ id: number; name: string; label: string | null }>('/institution/sections').then((rows) => rows.map((s) => ({ ...s, homeroom: true, students: 0, courses: [] }) as MySection)) : api.get<MySection[]>('/me/teacher/sections')),
  });
  const sectionId = search.get('section') ?? '';
  const offeringId = search.get('course') ?? '';
  const date = search.get('date') ?? todayISO();
  const set = (k: string, v: string) => setSearch((s) => {
    const n = new URLSearchParams(s);
    if (v) n.set(k, v);
    else n.delete(k);
    return n;
  });
  useEffect(() => {
    if (!sectionId && sections.data?.[0]) set('section', String(sections.data[0].id));
  });
  const reg = useQuery({
    queryKey: ['register', sectionId, offeringId, date],
    queryFn: () => api.get<Register>('/attendance/register', { section_id: sectionId, offering_id: offeringId || undefined, date }),
    enabled: !!sectionId,
  });
  const [marks, setMarks] = useState<Record<number, Mark>>({});
  const [late, setLate] = useState<Record<number, number>>({});
  const [queued, setQueued] = useState(offlineQueue.list().length);
  const [qr, setQr] = useState(false);
  useEffect(() => {
    if (!reg.data) return;
    setMarks(Object.fromEntries(reg.data.students.map((s) => [s.id, s.status ?? (s.on_leave ? 'leave' : null)]).filter(([, v]) => v)) as Record<number, Mark>);
    setLate(Object.fromEntries(reg.data.students.filter((s) => s.minutes_late).map((s) => [s.id, s.minutes_late!])));
  }, [reg.data]);
  // send registers saved without a connection as soon as it is back
  const flush = useCallback(async () => {
    const sent = await offlineQueue.flush();
    setQueued(offlineQueue.list().length);
    if (sent) {
      toast('success', t('att.synced', '{{n}} register(s) saved from the offline queue', { n: sent }));
      void qc.invalidateQueries({ queryKey: ['register'] });
    }
  }, [qc, t, toast]);
  useEffect(() => {
    window.addEventListener('online', flush);
    if (navigator.onLine) void flush();
    return () => window.removeEventListener('online', flush);
  }, [flush]);
  const body = () => ({
    section_id: Number(sectionId),
    offering_id: offeringId ? Number(offeringId) : null,
    period_id: null,
    date,
    records: Object.entries(marks).map(([id, status]) => ({ student_id: Number(id), status, minutes_late: status === 'late' ? (late[Number(id)] ?? 5) : null, note: '' })),
  });
  const save = useMutation({
    mutationFn: () => api.put('/attendance/register', body()),
    onSuccess: () => {
      toast('success', t('att.saved', 'Register saved'));
      void qc.invalidateQueries({ queryKey: ['register', sectionId, offeringId, date] });
    },
    onError: (e) => {
      if (e instanceof TypeError) {
        offlineQueue.add(body());
        setQueued(offlineQueue.list().length);
        toast('success', t('att.queued', 'You are offline — saved on this device and sent when you are back online'));
      } else toast('error', errorMessage(e));
    },
  });
  const section = sections.data?.find((s) => String(s.id) === sectionId);
  const students = reg.data?.students ?? [];
  const markedCount = Object.keys(marks).length;
  const cycle = (id: number) => setMarks((m) => {
    const cur = m[id];
    const next: Mark = cur ? STATUSES[(STATUSES.indexOf(cur) + 1) % 3]! : 'present'; // tap cycles present → absent → late
    return { ...m, [id]: next };
  });
  const closed = reg.data && (reg.data.holiday || !reg.data.working_day);
  return (
    <>
      <PageHeader title={t('att.title', 'Attendance')} actions={<Link to="leave"><Button variant="outline">{t('att.leave', 'Leave requests')}</Button></Link>} />
      {queued > 0 && (
        <Alert tone="warning" className="mb-4">
          <span className="flex flex-wrap items-center gap-2">
            <CloudOff className="size-4" aria-hidden /> {t('att.waiting', '{{n}} register(s) waiting to be sent', { n: queued })}
            <Button size="sm" variant="outline" onClick={() => void flush()}>{t('att.sendNow', 'Send now')}</Button>
          </span>
        </Alert>
      )}
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <Field label={t('common.class', 'Class')}>
          {(a) => (
            <Select {...a} value={sectionId} onChange={(e) => { set('section', e.target.value); set('course', ''); }}>
              {sections.data?.map((s) => <option key={s.id} value={s.id}>{[s.name, s.label].filter(Boolean).join(' ')}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('att.register', 'Register')}>
          {(a) => (
            <Select {...a} value={offeringId} onChange={(e) => set('course', e.target.value)}>
              <option value="">{t('att.wholeDay', 'Whole day')}</option>
              {section?.courses.map((c) => <option key={c.offering_id} value={c.offering_id}>{c.course}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('common.date', 'Date')}>{(a) => <Input {...a} type="date" max={todayISO()} value={date} onChange={(e) => set('date', e.target.value)} />}</Field>
      </Card>
      {!sectionId ? (
        sections.isPending ? <Spinner /> : <Card><EmptyState title={t('att.noClasses', 'No classes to take registers for')} /></Card>
      ) : reg.isPending ? (
        <Spinner />
      ) : reg.isError ? (
        <ErrorState error={reg.error} onRetry={() => reg.refetch()} />
      ) : closed ? (
        <Alert tone="info">{reg.data.holiday ? t('att.holiday', '{{name}} — no register on a holiday', { name: reg.data.holiday }) : t('att.closed', 'Not a working day')}</Alert>
      ) : !students.length ? (
        <Card><EmptyState title={t('att.noStudents', 'No students in this class')} /></Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, s.on_leave ? 'leave' : (marks[s.id] && marks[s.id] !== 'present' ? marks[s.id] : 'present')])) as Record<number, Mark>)}>
              <CheckCheck className="size-4" /> {t('att.allPresent', 'All present')}
            </Button>
            {reg.data.session && date === todayISO() && (
              <Button variant="outline" onClick={() => setQr(true)}>
                <QrCode className="size-4" /> {t('att.qr', 'QR check-in')}
              </Button>
            )}
            <span className="text-sm text-fg-muted">
              {t('att.marked', '{{n}} of {{total}} marked', { n: markedCount, total: students.length })} · {t('att.tapHint', 'tap a name: present → absent → late')}
            </span>
          </div>
          <Card className="divide-y divide-border">
            {students.map((s) => {
              const m = marks[s.id];
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button type="button" onClick={() => cycle(s.id)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold', m ? STYLE[m] : 'bg-surface-2 text-fg-muted')} aria-hidden>
                      {m ? SHORT[m] : '?'}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {s.roll_no}
                        {s.on_leave && ` · ${t('att.onLeave', 'on approved leave')}`}
                      </span>
                    </span>
                  </button>
                  <div className="flex gap-1" role="radiogroup" aria-label={s.name}>
                    {STATUSES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        role="radio"
                        aria-checked={m === st}
                        aria-label={t(`att.status.${st}`, st)}
                        title={t(`att.status.${st}`, st)}
                        onClick={() => setMarks((x) => ({ ...x, [s.id]: st }))}
                        className={cn('h-8 min-w-8 rounded-md px-1.5 text-xs font-semibold', m === st ? STYLE[st] : 'bg-surface-2 text-fg-muted hover:bg-border')}
                      >
                        {SHORT[st]}
                      </button>
                    ))}
                  </div>
                  {m === 'late' && (
                    <Input type="number" min={1} max={600} className="h-8 w-20" aria-label={t('att.minutesLate', 'Minutes late')} value={late[s.id] ?? 5} onChange={(e) => setLate((x) => ({ ...x, [s.id]: Number(e.target.value) }))} />
                  )}
                </div>
              );
            })}
          </Card>
          <div className="sticky bottom-0 mt-3 flex justify-end bg-background/90 py-3 backdrop-blur">
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!markedCount}>
              <Save className="size-4" /> {t('att.save', 'Save register')}
            </Button>
          </div>
        </>
      )}
      {qr && reg.data?.session && <QrDialog sessionId={reg.data.session.id} onClose={() => { setQr(false); void reg.refetch(); }} />}
    </>
  );
}

/** A code that changes every 20 seconds: a photo of it passed around stops working. */
function QrDialog({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [img, setImg] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.post<{ code: string; expires_in: number }>(`/attendance/sessions/${sessionId}/qr`, {});
        if (stop) return;
        setCode(r.code);
        setImg(await QRCode.toDataURL(JSON.stringify({ s: sessionId, c: r.code }), { width: 320, margin: 1 }));
        timer = setTimeout(tick, Math.max(1, r.expires_in) * 1000);
      } catch {
        timer = setTimeout(tick, 5000);
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [sessionId]);
  return (
    <Dialog open onClose={onClose} title={t('att.qrTitle', 'Scan to check in')} description={t('att.qrHelp', 'Students scan this in Acadex (Check in). It changes every 20 seconds.')}>
      <div className="flex flex-col items-center gap-3 p-5">
        {img ? <img src={img} alt={t('att.qrAlt', 'Check-in code')} className="size-72" /> : <Spinner />}
        <div className="text-center text-sm text-fg-muted">
          {t('att.sessionNo', 'Class number (under the code)')}: <span className="font-mono text-lg text-fg">{sessionId}</span>
        </div>
        <code className="rounded bg-surface-2 px-3 py-1 font-mono text-lg tracking-wider">{code}</code>
      </div>
    </Dialog>
  );
}

/** Students: scan (camera, where the browser can) or type the code shown on the screen. */
export function CheckInPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [session, setSession] = useState('');
  const [code, setCode] = useState('');
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const send = useMutation({
    mutationFn: async (v: { session_id: number; code: string }) => {
      // the location is only checked when the institution limits check-in to its grounds
      const where = await new Promise<{ lat?: number; lng?: number }>((resolve) => {
        if (!navigator.geolocation) return resolve({});
        navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve({}), { timeout: 8000, maximumAge: 60_000 });
      });
      return api.post('/attendance/checkin', { ...v, ...where });
    },
    onSuccess: () => toast('success', t('att.checkedIn', 'You are marked present')),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const scan = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      const Detector = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      const det = new Detector({ formats: ['qr_code'] });
      for (let i = 0; i < 100; i++) {
        const found = await det.detect(video);
        if (found[0]) {
          const v = JSON.parse(found[0].rawValue) as { s: number; c: string };
          stream.getTracks().forEach((tr) => tr.stop());
          return send.mutate({ session_id: v.s, code: v.c });
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      stream.getTracks().forEach((tr) => tr.stop());
      toast('error', t('att.noCode', 'No code found — type it instead'));
    } catch {
      toast('error', t('att.noCamera', 'The camera is not available — type the code instead'));
    }
  };
  return (
    <>
      <PageHeader title={t('att.checkIn', 'Check in')} />
      <Card className="max-w-md space-y-4 p-4">
        {supported && (
          <Button onClick={scan} className="w-full justify-center">
            <ScanLine className="size-4" /> {t('att.scan', 'Scan the code')}
          </Button>
        )}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate({ session_id: Number(session), code: code.trim() });
          }}
        >
          <Field label={t('att.sessionNo', 'Class number (under the code)')}>{(a) => <Input {...a} inputMode="numeric" required value={session} onChange={(e) => setSession(e.target.value)} />}</Field>
          <Field label={t('att.code', 'Code')}>{(a) => <Input {...a} required dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <Button type="submit" loading={send.isPending}>{t('att.checkIn', 'Check in')}</Button>
        </form>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- leave

interface Leave {
  id: number;
  person: string;
  from_date: string;
  to_date: string;
  kind: string;
  reason: string;
  status: string;
  requested_by_name: string | null;
  decided_by_name: string | null;
  decision_note: string;
  student_id: number | null;
}

export function LeavePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const [params] = useSearchParams();
  const approver = can('leave.approve') || user?.role === 'teacher';
  const [scope, setScope] = useState(params.get('scope') === 'approve' && approver ? 'approve' : 'mine');
  const list = useQuery({ queryKey: ['leave', scope], queryFn: () => api.get<Leave[]>('/leave', { scope: scope === 'approve' ? 'approve' : undefined }) });
  const children = useQuery({ queryKey: ['children'], queryFn: () => api.get<{ id: number; name: string }[]>('/parent/children'), enabled: user?.role === 'parent' });
  const [f, setF] = useState({ student_id: '', from_date: todayISO(), to_date: todayISO(), kind: 'sick', reason: '' });
  const ask = useMutation({
    mutationFn: () => api.post('/leave', { ...f, student_id: f.student_id ? Number(f.student_id) : null }),
    onSuccess: () => {
      toast('success', t('att.leaveSent', 'Request sent'));
      void qc.invalidateQueries({ queryKey: ['leave'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const decide = useMutation({
    mutationFn: (v: { id: number; status: 'approved' | 'rejected' }) => api.post(`/leave/${v.id}/decision`, { status: v.status, note: '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const cancel = useMutation({ mutationFn: (id: number) => api.post(`/leave/${id}/cancel`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }) });
  return (
    <>
      <PageHeader title={t('att.leave', 'Leave requests')} />
      {can('leave.request') && scope === 'mine' && (
        <Card className="mb-4 p-4">
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              ask.mutate();
            }}
          >
            {user?.role === 'parent' && (
              <Field label={t('att.child', 'Child')}>
                {(a) => (
                  <Select {...a} required value={f.student_id} onChange={(e) => setF({ ...f, student_id: e.target.value })}>
                    <option value="">—</option>
                    {children.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                )}
              </Field>
            )}
            <Field label={t('att.from', 'From')}>{(a) => <Input {...a} type="date" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value })} />}</Field>
            <Field label={t('att.to', 'To')}>{(a) => <Input {...a} type="date" min={f.from_date} value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} />}</Field>
            <Field label={t('att.kind', 'Kind')}>
              {(a) => (
                <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                  {['sick', 'personal', 'family', 'official', 'other'].map((k) => <option key={k} value={k}>{t(`att.kinds.${k}`, k)}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('att.reason', 'Reason')} className="sm:col-span-2 lg:col-span-1">{(a) => <Input {...a} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
            <div className="flex items-end">
              <Button type="submit" loading={ask.isPending}>{t('att.ask', 'Ask for leave')}</Button>
            </div>
          </form>
        </Card>
      )}
      {approver && (
        <div className="mb-3 flex gap-2" role="tablist">
          {['mine', 'approve'].map((s) => (
            <Button key={s} role="tab" aria-selected={scope === s} variant={scope === s ? 'primary' : 'outline'} size="sm" onClick={() => setScope(s)}>
              {s === 'mine' ? t('att.mine', 'Mine') : t('att.toDecide', 'To decide')}
            </Button>
          ))}
        </div>
      )}
      <DataTable
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        empty={t('att.noLeave', 'No leave requests')}
        columns={[
          { key: 'p', header: t('att.who', 'Who'), cell: (r) => <span className="font-medium">{r.person}</span> },
          { key: 'd', header: t('att.dates', 'Dates'), cell: (r) => (r.from_date === r.to_date ? formatDate(r.from_date) : `${formatDate(r.from_date)} – ${formatDate(r.to_date)}`) },
          { key: 'k', header: t('att.kind', 'Kind'), cell: (r) => `${t(`att.kinds.${r.kind}`, r.kind)}${r.reason ? ` · ${r.reason}` : ''}`, hideOnMobile: true },
          { key: 's', header: t('lms.status', 'Status'), cell: (r) => <Badge tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : r.status === 'pending' ? 'warning' : 'neutral'}>{t(`att.leaveStatus.${r.status}`, r.status)}</Badge> },
          {
            key: 'a',
            header: '',
            cell: (r) =>
              r.status === 'pending' &&
              (scope === 'approve' ? (
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => decide.mutate({ id: r.id, status: 'approved' })}>{t('att.approve', 'Approve')}</Button>
                  <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, status: 'rejected' })}>{t('att.reject', 'Reject')}</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>{t('common.cancel', 'Cancel')}</Button>
              )),
          },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- a student's attendance

export function StudentAttendancePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const id = Number(useParams().studentId) || (user?.role === 'student' ? user.ref_id : null);
  const q = useQuery({
    queryKey: ['att-summary', id],
    queryFn: () => api.get<{ threshold: number; percent: number | null; eligible: boolean; counts: Record<string, number>; courses: { offering_id: number; course: string; percent: number | null; eligible: boolean }[]; recent: { date: string; kind: string; course: string | null; status: Mark; minutes_late: number | null }[] }>(`/attendance/students/${id}/summary`),
    enabled: !!id,
  });
  if (!id) return <Card><EmptyState title={t('att.chooseStudent', 'Choose a student')} /></Card>;
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageHeader title={t('att.myAttendance', 'Attendance')} />
      {!d.eligible && <Alert tone="danger" className="mb-4">{t('att.below', 'Below the required {{n}}% — this can affect exam eligibility.', { n: d.threshold })}</Alert>}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label={t('att.overall', 'Overall')} value={d.percent == null ? '—' : `${d.percent}%`} sub={t('att.required', 'Required: {{n}}%', { n: d.threshold })} tone={d.eligible ? 'success' : 'danger'} />
        <StatCard label={t('att.status.absent', 'Absent')} value={d.counts.absent ?? 0} tone="danger" />
        <StatCard label={t('att.status.late', 'Late')} value={d.counts.late ?? 0} tone="warning" />
      </div>
      {d.courses.length > 0 && (
        <Card className="mb-4 divide-y divide-border">
          {d.courses.map((c) => (
            <div key={c.offering_id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{c.course}</span>
              <Badge tone={c.eligible ? 'success' : 'danger'}>{c.percent == null ? '—' : `${c.percent}%`}</Badge>
            </div>
          ))}
        </Card>
      )}
      <DataTable
        rows={d.recent}
        rowKey={(r, i) => i}
        empty={t('att.noRecords', 'No registers yet')}
        columns={[
          { key: 'd', header: t('common.date', 'Date'), cell: (r) => formatDate(r.date) },
          { key: 'c', header: t('att.register', 'Register'), cell: (r) => r.course ?? t('att.wholeDay', 'Whole day') },
          { key: 's', header: t('lms.status', 'Status'), cell: (r) => <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', STYLE[r.status])}>{t(`att.status.${r.status}`, r.status)}{r.minutes_late ? ` (${r.minutes_late}′)` : ''}</span> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------- staff attendance

export function StaffAttendancePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const q = useQuery({ queryKey: ['staff-att', date], queryFn: () => api.get<{ staff: { id: number; name: string; designation: string | null; status: string | null }[] }>('/attendance/staff', { date }) });
  const [marks, setMarks] = useState<Record<number, string>>({});
  useEffect(() => {
    if (q.data) setMarks(Object.fromEntries(q.data.staff.filter((s) => s.status).map((s) => [s.id, s.status!])));
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put('/attendance/staff', { date, records: Object.entries(marks).map(([id, status]) => ({ teacher_id: Number(id), status })) }),
    onSuccess: () => toast('success', t('att.saved', 'Register saved')),
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <>
      <PageHeader title={t('att.staff', 'Staff attendance')} actions={<Input type="date" aria-label={t('common.date', 'Date')} value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />} />
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          <Card className="divide-y divide-border">
            {q.data.staff.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="text-sm">
                  <span className="font-medium">{s.name}</span> <span className="text-xs text-fg-muted">{s.designation}</span>
                </span>
                <div className="flex gap-1" role="radiogroup" aria-label={s.name}>
                  {['Present', 'Absent', 'Leave'].map((st) => (
                    <button key={st} type="button" role="radio" aria-checked={marks[s.id] === st} onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))} className={cn('h-8 rounded-md px-2 text-xs font-semibold', marks[s.id] === st ? STYLE[st.toLowerCase() as Mark] : 'bg-surface-2 text-fg-muted')}>
                      {t(`status.${st}`, st)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </Card>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              <Save className="size-4" /> {t('att.save', 'Save register')}
            </Button>
          </div>
        </>
      )}
    </>
  );
}


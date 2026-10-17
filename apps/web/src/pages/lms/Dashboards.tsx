// "What to do today" for each role, from /api/me/dashboard.
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookOpen, CalendarCheck, ClipboardCheck, ClipboardList, Clock, FileText, Flame, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { dueLabel } from '@/lib/lms';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';

interface ClassSlot {
  period: string;
  starts_at: string;
  ends_at: string;
  course: string | null;
  room: string | null;
  teacher?: string | null;
  section_name?: string | null;
  section_id?: number;
  offering_id?: number | null;
  covering?: boolean;
  register_taken?: boolean;
}

function Today({ classes, holiday, staff }: { classes: ClassSlot[]; holiday: string | null; staff?: boolean }) {
  const { t } = useTranslation();
  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><Clock className="size-4" aria-hidden /> {t('dash.today', 'Today')}</h2>
      {holiday ? (
        <Alert>{t('dash.holiday', '{{name}} — no classes today', { name: holiday })}</Alert>
      ) : !classes.length ? (
        <p className="text-sm text-fg-muted">{t('dash.noClasses', 'No classes today')}</p>
      ) : (
        <ol className="space-y-2">
          {classes.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span>
                <span className="font-mono text-xs tabular-nums text-fg-muted">{c.starts_at}</span> <span className="font-medium">{c.course ?? t('tt.free', 'Free')}</span>
                {staff && c.section_name && <span className="text-fg-muted"> · {c.section_name}</span>}
                {c.room && <span className="text-fg-muted"> · {c.room}</span>}
                {!staff && c.teacher && <span className="text-fg-muted"> · {c.teacher}</span>}
                {c.covering && <Badge tone="warning" className="ms-2">{t('tt.cover', 'Cover')}</Badge>}
              </span>
              {staff && c.section_id && (
                <Link to={`/attendance?section=${c.section_id}${c.offering_id ? `&course=${c.offering_id}` : ''}`}>
                  <Button size="sm" variant={c.register_taken ? 'secondary' : 'primary'}>{c.register_taken ? t('dash.registerDone', 'Register done') : t('dash.takeRegister', 'Take register')}</Button>
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export function StudentHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      api.get<{
        holiday: string | null;
        classes: ClassSlot[];
        due: { id: number; title: string; kind: string; offering_id: number; course: string; due_at: string }[];
        recent_grades: { subject: string | null; assignment_name: string; obtained_marks: string | null; total_marks: string; percentage: string | null }[];
        attendance: { percent: number | null; threshold: number; below: boolean };
        courses: { id: number; name: string; percent: number }[];
        announcements: { id: number; title: string }[];
        streak?: number;
      }>('/me/dashboard'),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageHeader title={t('dash.hello', 'Hello, {{name}}', { name: user?.full_name.split(' ')[0] ?? '' })} />
      {!!d.streak && d.streak > 1 && <p className="mb-3 inline-flex items-center gap-1 rounded-full bg-warning-soft px-3 py-1 text-sm font-medium"><Flame className="size-4 text-warning" aria-hidden /> {t('dash.streak', '{{n}}-day streak', { n: d.streak })}</p>}
      {d.attendance.below && <Alert tone="danger" className="mb-4">{t('att.below', 'Below the required {{n}}% — this can affect exam eligibility.', { n: d.attendance.threshold })}</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><ClipboardList className="size-4" aria-hidden /> {t('dash.toDo', 'To do')}</h2>
            {!d.due.length ? (
              <p className="text-sm text-fg-muted">{t('dash.allDone', 'Nothing due — well done')}</p>
            ) : (
              <ul className="space-y-2">
                {d.due.map((w) => {
                  const due = dueLabel(w.due_at);
                  return (
                    <li key={w.id}>
                      <Link to={`/learn/courses/${w.offering_id}/work/${w.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary">
                        <span><span className="font-medium">{w.title}</span> <span className="text-fg-muted">· {w.course}</span></span>
                        <Badge tone={due.tone === 'neutral' ? 'info' : due.tone}>{due.text}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Today classes={d.classes} holiday={d.holiday} />
        </div>
        <div className="space-y-4">
          <StatCard label={t('nav.attendance', 'Attendance')} value={d.attendance.percent == null ? '—' : `${d.attendance.percent}%`} sub={t('att.required', 'Required: {{n}}%', { n: d.attendance.threshold })} icon={CalendarCheck} tone={d.attendance.below ? 'danger' : 'success'} />
          <Card className="p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><BookOpen className="size-4" aria-hidden /> {t('lms.myCourses', 'My courses')}</h2>
            <ul className="space-y-2">
              {d.courses.map((c) => (
                <li key={c.id}>
                  <Link to={`/learn/courses/${c.id}`} className="block text-sm hover:text-primary">
                    <div className="flex justify-between"><span>{c.name}</span><span className="tabular-nums text-xs text-fg-muted">{c.percent}%</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${c.percent}%` }} /></div>
                  </Link>
                </li>
              ))}
              {!d.courses.length && <li className="text-sm text-fg-muted">{t('lms.noCourses', 'No courses yet')}</li>}
            </ul>
          </Card>
          {d.recent_grades.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t('dash.recentGrades', 'Recent grades')}</h2>
              <ul className="space-y-1 text-sm">
                {d.recent_grades.map((g, i) => (
                  <li key={i} className="flex justify-between gap-2"><span className="truncate">{g.assignment_name}</span><Badge tone={Number(g.percentage) >= 50 ? 'success' : 'danger'}>{g.percentage ?? '—'}%</Badge></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export function TeacherHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      api.get<{
        holiday: string | null;
        classes: ClassSlot[];
        to_grade: { id: number; title: string; offering_id: number; course: string; waiting: number }[];
        registers: { section_id: number; section_name: string; taken: boolean }[];
        leave_to_decide: number;
        courses: { id: number; name: string; section_name: string | null }[];
        at_risk?: { student_id: number; name: string; section: string | null; score: number; level: string }[];
      }>('/me/dashboard'),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const waiting = d.to_grade.reduce((n, x) => n + x.waiting, 0);
  return (
    <>
      <PageHeader title={t('dash.hello', 'Hello, {{name}}', { name: user?.full_name.split(' ')[0] ?? '' })} />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label={t('dash.toGrade', 'To grade')} value={waiting} icon={ClipboardCheck} tone={waiting ? 'warning' : 'success'} />
        <StatCard label={t('dash.registersLeft', 'Registers to take')} value={d.registers.filter((r) => !r.taken).length + d.classes.filter((c) => !c.register_taken && c.offering_id).length} icon={CalendarCheck} />
        <StatCard label={t('dash.leaveToDecide', 'Leave requests')} value={d.leave_to_decide} icon={Users} tone={d.leave_to_decide ? 'warning' : 'primary'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Today classes={d.classes} holiday={d.holiday} staff />
        <div className="space-y-4">
          {!!d.at_risk?.length && (
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t('dash.atRisk', 'Students who may need help')}</h2>
              <ul className="space-y-1">
                {d.at_risk.map((r) => (
                  <li key={r.student_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link to="/success" className="hover:text-primary">{r.name}{r.section ? ` · ${r.section}` : ''}</Link>
                    <Badge tone={r.level === 'high' ? 'danger' : 'warning'}>{t(`risk.${r.level}`, r.level)} · {r.score}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.registers.length > 0 && !d.holiday && (
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t('dash.dayRegisters', 'Class teacher registers')}</h2>
              <ul className="space-y-2">
                {d.registers.map((r) => (
                  <li key={r.section_id} className="flex items-center justify-between text-sm">
                    <span>{r.section_name}</span>
                    <Link to={`/attendance?section=${r.section_id}`}><Button size="sm" variant={r.taken ? 'secondary' : 'primary'}>{r.taken ? t('dash.registerDone', 'Register done') : t('dash.takeRegister', 'Take register')}</Button></Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{t('dash.waiting', 'Waiting for your marking')}</h2>
            {d.to_grade.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.to_grade.map((w) => (
                  <li key={w.id}><Link to={`/teach/courses/${w.offering_id}/work/${w.id}`} className="flex justify-between gap-2 hover:text-primary"><span>{w.title} <span className="text-fg-muted">· {w.course}</span></span><Badge tone="warning">{w.waiting}</Badge></Link></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">{t('dash.nothingToGrade', 'All marked')}</p>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{t('lms.myCourses', 'My courses')}</h2>
            <ul className="space-y-1 text-sm">
              {d.courses.map((c) => <li key={c.id}><Link to={`/teach/courses/${c.id}`} className="hover:text-primary">{c.name}{c.section_name && <span className="text-fg-muted"> · {c.section_name}</span>}</Link></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

export function FamilyHome() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () =>
      api.get<{
        holiday: string | null;
        children: { id: number; name: string; section_name: string | null; today: string | null; attendance: { percent: number | null; threshold: number; below: boolean }; due: { id: number; title: string; course: string; due_at: string }[]; recent_grades: { assignment_name: string; percentage: string | null }[] | null; fee: { remaining_balance: string; payment_status: string } | null }[];
      }>('/me/dashboard'),
  });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.children.length) return <Card><EmptyState title={t('parent.none', 'No children are linked to your account yet')} description={t('parent.noneHelp', 'Ask the institution office to link your children.')} /></Card>;
  return (
    <>
      <PageHeader title={t('nav.children', 'My children')} actions={<Link to="/attendance/leave"><Button variant="outline">{t('att.ask', 'Ask for leave')}</Button></Link>} />
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data.children.map((c) => (
          <Card key={c.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">{c.name}</h2>
                <div className="text-xs text-fg-muted">{c.section_name}</div>
              </div>
              {c.today && <Badge tone={c.today === 'absent' ? 'danger' : c.today === 'present' ? 'success' : 'warning'}>{t('dash.todayIs', 'Today: {{s}}', { s: t(`att.status.${c.today}`, c.today) })}</Badge>}
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone={c.attendance.below ? 'danger' : 'success'}>{t('nav.attendance', 'Attendance')}: {c.attendance.percent ?? '—'}%</Badge>
              {c.fee && <Badge tone={c.fee.payment_status === 'Paid' ? 'success' : 'warning'}>{t('nav.fees', 'Fees')}: {formatMoney(c.fee.remaining_balance)}</Badge>}
            </div>
            {c.due.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-fg-muted">{t('dash.dueSoon', 'Due soon')}</div>
                <ul className="space-y-1 text-sm">{c.due.map((w) => <li key={w.id}>{w.title} <span className="text-fg-muted">· {w.course} · {formatDateTime(w.due_at)}</span></li>)}</ul>
              </div>
            )}
            {c.recent_grades && c.recent_grades.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-fg-muted">{t('dash.recentGrades', 'Recent grades')}</div>
                <ul className="space-y-1 text-sm">{c.recent_grades.map((g, i) => <li key={i} className="flex justify-between"><span className="truncate">{g.assignment_name}</span><span className="tabular-nums">{g.percentage ?? '—'}%</span></li>)}</ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link to={`/attendance/students/${c.id}`}><Button size="sm" variant="outline">{t('nav.attendance', 'Attendance')}</Button></Link>
              <Link to="/parent/children"><Button size="sm" variant="outline"><FileText className="size-4" /> {t('dash.fullOverview', 'Grades & report card')}</Button></Link>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

/** For the office dashboard: today's registers and who needs attention. */
export function AdminToday() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['dashboard-admin'], queryFn: () => api.get<{ holiday: string | null; registers: { total: number; taken: number }; low_attendance: { id: number; name: string; pct: number }[]; threshold: number; leave_pending: number; submissions_waiting_over_week: number }>('/me/dashboard') });
  if (!q.data) return null;
  const d = q.data;
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-3">
      <StatCard label={t('dash.registersToday', 'Registers taken today')} value={d.holiday ? '—' : `${d.registers.taken}/${d.registers.total}`} sub={d.holiday ?? undefined} icon={CalendarCheck} />
      <Link to="/attendance/leave?scope=approve" className="block"><StatCard label={t('dash.leavePending', 'Leave requests waiting')} value={d.leave_pending} icon={Users} tone={d.leave_pending ? 'warning' : 'primary'} /></Link>
      <Card className="p-4">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">{t('dash.lowAttendance', 'Below {{n}}% attendance', { n: d.threshold })}</div>
        {d.low_attendance.length ? (
          <ul className="space-y-0.5 text-sm">{d.low_attendance.slice(0, 5).map((s) => <li key={s.id}><Link to={`/attendance/students/${s.id}`} className="hover:text-primary">{s.name}</Link> <span className="text-danger tabular-nums">{s.pct}%</span></li>)}</ul>
        ) : (
          <p className="text-sm text-fg-muted">{t('dash.nobodyLow', 'Nobody — good')}</p>
        )}
      </Card>
    </div>
  );
}

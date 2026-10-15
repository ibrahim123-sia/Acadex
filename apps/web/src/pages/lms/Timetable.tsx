// The timetable: my week (with holidays and substitutes), and for the office the builder —
// bell schedule, rooms, the grid per section with clash checks, the generator and
// substitutions.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Plus, Trash2, Wand2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, todayISO } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, Select, Spinner, Tabs, useToast } from '@/components/ui';

interface Slot {
  id: number;
  section_id: number;
  offering_id: number | null;
  teacher_id: number | null;
  weekday: number;
  period_id: number;
  period_name: string;
  starts_at: string;
  ends_at: string;
  course: string | null;
  section_name: string | null;
  teacher: string | null;
  room: string | null;
  substitute?: { teacher_id: number; name: string; reason: string } | null;
}
interface Week {
  week_of: string;
  days: { date: string; weekday: number; working: boolean; holiday: string | null; slots: Slot[] }[];
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function WeekView({ week, showSection }: { week: Week; showSection?: boolean }) {
  const { t } = useTranslation();
  const days = week.days.filter((d) => d.working || d.slots.length);
  const today = todayISO();
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {days.map((d) => (
        <Card key={d.date} className={cn('p-3', d.date === today && 'ring-2 ring-primary')}>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-semibold">{new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${d.date}T00:00:00Z`))}</h3>
            <span className="text-xs text-fg-muted">{formatDate(d.date)}</span>
          </div>
          {d.holiday ? (
            <Badge tone="warning">{d.holiday}</Badge>
          ) : !d.slots.length ? (
            <p className="text-sm text-fg-muted">{t('tt.free', 'No classes')}</p>
          ) : (
            <ul className="space-y-1.5">
              {d.slots.map((s) => (
                <li key={s.id} className={cn('rounded-lg border-s-4 bg-surface-2 px-2 py-1.5 text-sm', s.substitute ? 'border-warning' : 'border-primary')}>
                  <div className="font-medium">{s.course ?? t('tt.free', 'Free')}</div>
                  <div className="text-xs text-fg-muted">
                    {s.starts_at}–{s.ends_at}
                    {showSection && s.section_name && ` · ${s.section_name}`}
                    {s.room && ` · ${s.room}`}
                  </div>
                  <div className="text-xs text-fg-muted">{s.substitute ? `${t('tt.cover', 'Cover')}: ${s.substitute.name}` : s.teacher}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

function WeekPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="outline" aria-label={t('tt.prevWeek', 'Previous week')} onClick={() => onChange(addDays(value, -7))}>
        <ChevronLeft className="size-4 rtl:rotate-180" />
      </Button>
      <Button variant="outline" onClick={() => onChange(todayISO())}>{t('tt.thisWeek', 'This week')}</Button>
      <Button size="icon" variant="outline" aria-label={t('tt.nextWeek', 'Next week')} onClick={() => onChange(addDays(value, 7))}>
        <ChevronRight className="size-4 rtl:rotate-180" />
      </Button>
    </div>
  );
}

export function MyTimetablePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [weekOf, setWeekOf] = useState(todayISO());
  const q = useQuery({ queryKey: ['my-timetable', weekOf], queryFn: () => api.get<Week | { children: (Week & { student_id: number; name: string })[] }>('/timetable/me', { week_of: weekOf }) });
  if (can('timetable.manage')) return <TimetableAdmin />;
  return (
    <>
      <PageHeader title={t('tt.title', 'Timetable')} actions={<WeekPicker value={weekOf} onChange={setWeekOf} />} />
      {q.isPending ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : 'children' in q.data ? (
        q.data.children.length ? (
          q.data.children.map((c) => (
            <section key={c.student_id} className="mb-6">
              <h2 className="mb-2 font-semibold">{c.name}</h2>
              <WeekView week={c} />
            </section>
          ))
        ) : (
          <Card><EmptyState title={t('tt.none', 'No timetable yet')} /></Card>
        )
      ) : (
        <WeekView week={q.data} showSection />
      )}
    </>
  );
}

// ---------------------------------------------------------------- office

interface Period {
  id: number;
  name: string;
  starts_at: string;
  ends_at: string;
  position: number;
  is_break: boolean;
}

function TimetableAdmin() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('tt.title', 'Timetable')} />
      <Tabs
        tabs={[
          { id: 'grid', label: t('tt.grid', 'Timetable'), content: () => <GridTab /> },
          { id: 'cover', label: t('tt.substitutions', 'Substitutions'), content: () => <CoverTab /> },
          { id: 'bells', label: t('tt.bells', 'Bell schedule'), content: () => <BellsTab /> },
          { id: 'rooms', label: t('tt.rooms', 'Rooms'), content: () => <RoomsTab /> },
        ]}
      />
    </>
  );
}

const usePeriods = () => useQuery({ queryKey: ['periods'], queryFn: () => api.get<Period[]>('/timetable/periods') });
const useSections = () => useQuery({ queryKey: ['tt-sections'], queryFn: () => api.all<{ id: number; name: string; label: string | null }>('/institution/sections') });

function GridTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const sections = useSections();
  const periods = usePeriods();
  const [sectionId, setSectionId] = useState('');
  useEffect(() => {
    if (!sectionId && sections.data?.[0]) setSectionId(String(sections.data[0].id));
  }, [sections.data, sectionId]);
  const week = useQuery({ queryKey: ['tt-week', sectionId], queryFn: () => api.get<Week>('/timetable', { section_id: sectionId }), enabled: !!sectionId });
  const offerings = useQuery({ queryKey: ['tt-offerings', sectionId], queryFn: () => api.all<{ id: number; course_name?: string; name?: string; code?: string }>('/institution/offerings', { section_id: sectionId }), enabled: !!sectionId });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.get<{ id: number; code: string; name: string }[]>('/timetable/rooms') });
  const [adding, setAdding] = useState<{ weekday: number; period_id: number } | null>(null);
  const [course, setCourse] = useState('');
  const [room, setRoom] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['tt-week', sectionId] });
  const add = useMutation({
    mutationFn: () => api.post('/timetable/slots', { section_id: Number(sectionId), offering_id: course ? Number(course) : null, room_id: room ? Number(room) : null, ...adding }),
    onSuccess: () => {
      setAdding(null);
      void refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/timetable/slots/${id}`), onSuccess: refresh });
  const gen = useMutation({
    mutationFn: (apply: boolean) => api.post<{ slots: unknown[]; unplaced: { course: string; missing: number }[]; applied: boolean }>('/timetable/generate', { section_ids: [Number(sectionId)], apply }),
    onSuccess: (r) => {
      if (r.applied) {
        void refresh();
        toast('success', t('tt.generated', 'Timetable made: {{n}} classes', { n: r.slots.length }));
      } else if (window.confirm(t('tt.preview', '{{n}} classes can be placed{{missing}}. Replace this section’s timetable?', { n: r.slots.length, missing: r.unplaced.length ? `; not placed: ${r.unplaced.map((u) => `${u.course} ×${u.missing}`).join(', ')}` : '' }))) gen.mutate(true);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const teaching = periods.data?.filter((p) => !p.is_break) ?? [];
  const days = [1, 2, 3, 4, 5, 6];
  const slotAt = (d: number, p: number) => week.data?.days.find((x) => x.weekday === d)?.slots.find((s) => s.period_id === p);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('common.class', 'Class')}>
          {(a) => (
            <Select {...a} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {sections.data?.map((s) => <option key={s.id} value={s.id}>{[s.name, s.label].filter(Boolean).join(' ')}</option>)}
            </Select>
          )}
        </Field>
        <Button variant="outline" onClick={() => gen.mutate(false)} loading={gen.isPending}>
          <Wand2 className="size-4" /> {t('tt.generate', 'Make it for me')}
        </Button>
      </div>
      {periods.isPending || sections.isPending || (!!sectionId && week.isPending) ? (
        <Spinner />
      ) : !teaching.length ? (
        <Alert>{t('tt.needBells', 'Set up the bell schedule first.')}</Alert>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-xs text-fg-muted">
                <th scope="col" className="px-2 py-2 text-start">{t('tt.period', 'Period')}</th>
                {days.map((d) => (
                  <th key={d} scope="col" className="px-2 py-2">{new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + d)))}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {teaching.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="px-2 py-2 text-start text-xs font-medium">
                    {p.name}
                    <div className="font-normal text-fg-muted">{p.starts_at}–{p.ends_at}</div>
                  </th>
                  {days.map((d) => {
                    const s = slotAt(d, p.id);
                    return (
                      <td key={d} className="px-1 py-1 align-top">
                        {s ? (
                          <div className="group relative rounded bg-primary-soft px-2 py-1 text-xs">
                            <div className="font-medium">{s.course ?? '—'}</div>
                            <div className="text-fg-muted">{s.teacher ?? t('tt.noTeacher', 'no teacher')}{s.room && ` · ${s.room}`}</div>
                            <button type="button" aria-label={t('common.remove', 'Remove')} className="absolute end-1 top-1 text-fg-muted hover:text-danger" onClick={() => remove.mutate(s.id)}>
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        ) : (
                          <button type="button" className="h-10 w-full rounded border border-dashed border-border text-fg-muted hover:bg-surface-2" aria-label={t('tt.addSlot', 'Add a class')} onClick={() => setAdding({ weekday: d, period_id: p.id })}>
                            <Plus className="mx-auto size-4" />
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {adding && (
        <Dialog open onClose={() => setAdding(null)} title={t('tt.addSlot', 'Add a class')}>
          <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <Field label={t('lms.course', 'Course')}>
              {(a) => (
                <Select {...a} value={course} onChange={(e) => setCourse(e.target.value)}>
                  <option value="">{t('tt.freePeriod', 'Free period / activity')}</option>
                  {offerings.data?.map((o) => <option key={o.id} value={o.id}>{o.course_name ?? o.name ?? o.code}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('tt.room', 'Room')} optional>
              {(a) => (
                <Select {...a} value={room} onChange={(e) => setRoom(e.target.value)}>
                  <option value="">—</option>
                  {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
                </Select>
              )}
            </Field>
            <p className="text-xs text-fg-muted">{t('tt.clashHint', 'The course’s teacher is set automatically; clashes are refused.')}</p>
            <Button type="submit" loading={add.isPending}>{t('common.add', 'Add')}</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function CoverTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(todayISO());
  const [teacher, setTeacher] = useState('');
  const staff = useQuery({ queryKey: ['tt-staff'], queryFn: () => api.all<{ id: number; first_name: string; last_name: string }>('/institution/teachers') });
  const week = useQuery({ queryKey: ['tt-teacher', teacher, date], queryFn: () => api.get<Week>('/timetable', { teacher_id: teacher, week_of: date }), enabled: !!teacher });
  const today = week.data?.days.find((d) => d.date === date);
  const subs = useQuery({ queryKey: ['subs', date], queryFn: () => api.get<(Slot & { substitute: string; reason: string; slot_id: number })[]>('/timetable/substitutions', { date }) });
  const [slot, setSlot] = useState<number | null>(null);
  const free = useQuery({ queryKey: ['free', slot, date], queryFn: () => api.get<{ id: number; name: string; periods_that_day: number }[]>('/timetable/substitutes', { slot_id: slot, date }), enabled: !!slot });
  const assign = useMutation({
    mutationFn: (sub: number) => api.post('/timetable/substitutions', { slot_id: slot, date, substitute_teacher_id: sub, reason: '' }),
    onSuccess: () => {
      setSlot(null);
      void qc.invalidateQueries({ queryKey: ['subs', date] });
      toast('success', t('tt.covered', 'Cover arranged; the teacher was told'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.date', 'Date')}>{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label={t('tt.absentTeacher', 'Teacher who is away')}>
            {(a) => (
              <Select {...a} value={teacher} onChange={(e) => setTeacher(e.target.value)}>
                <option value="">—</option>
                {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {today?.slots.length ? (
          <ul className="space-y-2">
            {today.slots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                <span>{s.starts_at} {s.course} · {s.section_name}</span>
                <Button size="sm" variant="outline" onClick={() => setSlot(s.id)}>{t('tt.findCover', 'Find cover')}</Button>
              </li>
            ))}
          </ul>
        ) : (
          teacher && <p className="text-sm text-fg-muted">{t('tt.noClassesThatDay', 'No classes that day')}</p>
        )}
        {slot && (
          <div className="rounded-lg bg-surface-2 p-3">
            <div className="mb-2 text-sm font-medium">{t('tt.freeTeachers', 'Free in that period')}</div>
            {free.data?.length ? (
              <ul className="space-y-1">
                {free.data.map((f) => (
                  <li key={f.id} className="flex items-center justify-between text-sm">
                    <span>{f.name} <span className="text-xs text-fg-muted">({t('tt.periodsThatDay', '{{n}} periods that day', { n: f.periods_that_day })})</span></span>
                    <Button size="sm" onClick={() => assign.mutate(f.id)}>{t('tt.assign', 'Assign')}</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">{t('tt.nobodyFree', 'Nobody is free then')}</p>
            )}
          </div>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">{t('tt.coverOn', 'Cover on {{date}}', { date: formatDate(date) })}</h2>
        {subs.data?.length ? (
          <ul className="space-y-1 text-sm">
            {subs.data.map((s) => <li key={s.slot_id}>{s.starts_at} {s.course} · {s.section_name}: <span className="font-medium">{s.substitute}</span></li>)}
          </ul>
        ) : (
          <EmptyState title={t('tt.noCover', 'No cover arranged')} />
        )}
      </Card>
    </div>
  );
}

function BellsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = usePeriods();
  const [rows, setRows] = useState<{ name: string; starts_at: string; ends_at: string; is_break: boolean }[]>([]);
  useEffect(() => {
    if (q.data) setRows(q.data.length ? q.data.map((p) => ({ name: p.name, starts_at: p.starts_at, ends_at: p.ends_at, is_break: p.is_break })) : [{ name: 'Period 1', starts_at: '08:00', ends_at: '08:45', is_break: false }]);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put('/timetable/periods', { periods: rows }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['periods'] });
      toast('success', t('common.saved', 'Saved'));
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const set = (i: number, k: string, v: string | boolean) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card className="space-y-2 p-4">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input className="w-36" aria-label={t('tt.periodName', 'Name')} value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
          <Input className="w-28" type="time" aria-label={t('tt.starts', 'Starts')} value={r.starts_at} onChange={(e) => set(i, 'starts_at', e.target.value)} />
          <Input className="w-28" type="time" aria-label={t('tt.ends', 'Ends')} value={r.ends_at} onChange={(e) => set(i, 'ends_at', e.target.value)} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={r.is_break} onChange={(e) => set(i, 'is_break', e.target.checked)} /> {t('tt.break', 'Break')}</label>
          <Button size="icon" variant="ghost" aria-label={t('common.remove', 'Remove')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" onClick={() => setRows((x) => [...x, { name: `Period ${x.length + 1}`, starts_at: x.at(-1)?.ends_at ?? '08:00', ends_at: x.at(-1)?.ends_at ?? '08:45', is_break: false }])}><Plus className="size-4" /> {t('tt.addPeriod', 'Add period')}</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>{t('common.save', 'Save')}</Button>
      </div>
    </Card>
  );
}

function RoomsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rooms'], queryFn: () => api.get<{ id: number; code: string; name: string; capacity: number | null; kind: string }[]>('/timetable/rooms') });
  const [f, setF] = useState({ code: '', name: '', capacity: '', kind: 'classroom' });
  const add = useMutation({
    mutationFn: () => api.post('/timetable/rooms', { ...f, capacity: f.capacity ? Number(f.capacity) : null }),
    onSuccess: () => {
      setF({ code: '', name: '', capacity: '', kind: 'classroom' });
      void qc.invalidateQueries({ queryKey: ['rooms'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/timetable/rooms/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['rooms'] }) });
  return (
    <Card className="space-y-3 p-4">
      <ul className="divide-y divide-border">
        {q.data?.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2 text-sm">
            <span><span className="font-medium">{r.code}</span> {r.name} <span className="text-xs text-fg-muted">{t(`tt.kinds.${r.kind}`, r.kind)}{r.capacity ? ` · ${r.capacity}` : ''}</span></span>
            <Button size="icon" variant="ghost" aria-label={t('common.remove', 'Remove')} onClick={() => remove.mutate(r.id)}><Trash2 className="size-4" /></Button>
          </li>
        ))}
        {!q.data?.length && <li className="py-2 text-sm text-fg-muted">{t('tt.noRooms', 'No rooms yet')}</li>}
      </ul>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field label={t('tt.code', 'Code')}>{(a) => <Input {...a} className="w-24" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
        <Field label={t('common.name', 'Name')}>{(a) => <Input {...a} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label={t('tt.capacity', 'Seats')} optional>{(a) => <Input {...a} className="w-20" type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />}</Field>
        <Field label={t('tt.kind', 'Kind')}>
          {(a) => (
            <Select {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {['classroom', 'lab', 'hall', 'library', 'ground', 'online', 'other'].map((k) => <option key={k} value={k}>{t(`tt.kinds.${k}`, k)}</option>)}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="outline" loading={add.isPending}><Plus className="size-4" /> {t('common.add', 'Add')}</Button>
      </form>
    </Card>
  );
}

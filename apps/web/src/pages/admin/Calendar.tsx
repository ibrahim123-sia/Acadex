// The academic calendar: a month at a time, with holidays, breaks, exam periods, events and
// non-working days. Attendance and due dates respect it.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, todayISO } from '@/lib/format';
import { cn } from '@/lib/cn';
import { FormDialog, nullIfEmpty, useFormDialog, type Values } from '@/components/FormDialog';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { useStructure } from './structure-data';

interface Holiday {
  id: number;
  name: string;
  kind: 'holiday' | 'break' | 'exam_period' | 'event';
  starts_on: string;
  ends_on: string;
  campus_id: number | null;
  campus_name: string | null;
}
interface CalendarData {
  holidays: Holiday[];
  terms: { id: number; name: string; starts_on: string; ends_on: string | null; academic_year: string }[];
  working_days: number[];
}

const KIND_STYLE: Record<Holiday['kind'], string> = {
  holiday: 'bg-danger-soft text-danger',
  break: 'bg-warning-soft text-warning',
  exam_period: 'bg-primary-soft text-primary',
  event: 'bg-success-soft text-success',
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function AdminCalendar() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const structure = useStructure();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const first = iso(cursor.y, cursor.m, 1);
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const last = iso(cursor.y, cursor.m, daysInMonth);
  const cal = useQuery({ queryKey: ['calendar', first, last], queryFn: () => api.get<CalendarData>('/institution/calendar', { from: first, to: last }) });
  const dlg = useFormDialog();
  const del = useMutation({
    mutationFn: (h: Holiday) => api.delete(`/institution/holidays/${h.id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['calendar'] }),
    onError: () => toast('error', t('common.failed', 'That did not work')),
  });
  const manage = can('structure.manage');

  const monthLabel = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T00:00:00Z`));
  const weekdayNames = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i)))),
    [i18n.language]
  );
  const offset = new Date(`${first}T00:00:00Z`).getUTCDay();
  const move = (d: number) => setCursor((c) => ({ y: c.m + d < 0 ? c.y - 1 : c.m + d > 11 ? c.y + 1 : c.y, m: (c.m + d + 12) % 12 }));

  const fields = [
    { name: 'name', label: t('common.name', 'Name') },
    { name: 'kind', label: t('calendar.kind', 'Kind'), options: (['holiday', 'break', 'exam_period', 'event'] as const).map((k) => ({ value: k, label: t(`holidayKind.${k}`, k.replace('_', ' ')) })) },
    { name: 'starts_on', label: t('common.starts', 'Starts'), type: 'date' },
    { name: 'ends_on', label: t('common.ends', 'Ends'), type: 'date', optional: true, hint: t('calendar.oneDay', 'Leave empty for a single day') },
    {
      name: 'campus_id',
      label: t('structure.campus', 'Campus'),
      optional: true,
      options: [{ value: '', label: t('structure.allCampuses', 'All campuses') }, ...(structure.data?.campuses ?? []).map((c) => ({ value: String(c.id), label: c.name }))],
    },
  ];
  const save = (h: Holiday | null) => async (v: Values) => {
    const body = { ...v, ends_on: nullIfEmpty(v.ends_on), campus_id: nullIfEmpty(v.campus_id) };
    if (h) await api.patch(`/institution/holidays/${h.id}`, body);
    else await api.post('/institution/holidays', body);
    void qc.invalidateQueries({ queryKey: ['calendar'] });
  };
  const dayInfo = (d: string) => (cal.data?.holidays ?? []).filter((h) => d >= h.starts_on && d <= h.ends_on);

  return (
    <>
      <PageHeader
        title={t('nav.calendar', 'Calendar')}
        subtitle={t('calendar.subtitle', 'Holidays close attendance and due dates; exam periods and events are shown to everyone.')}
        actions={
          manage && (
            <Button onClick={() => dlg.open({ title: t('calendar.add', 'Add to the calendar'), initial: { name: '', kind: 'holiday', starts_on: first, ends_on: '', campus_id: '' }, submit: save(null) })}>
              <Plus className="size-4" /> {t('calendar.add', 'Add to the calendar')}
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label={t('calendar.previous', 'Previous month')} onClick={() => move(-1)}>
          <ChevronLeft className="size-4 rtl:rotate-180" />
        </Button>
        <h2 className="min-w-44 text-center text-lg font-semibold" aria-live="polite">
          {monthLabel}
        </h2>
        <Button variant="outline" size="icon" aria-label={t('calendar.next', 'Next month')} onClick={() => move(1)}>
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })}>
          {t('calendar.today', 'Today')}
        </Button>
      </div>
      {cal.isPending ? (
        <Skeleton className="h-96" />
      ) : cal.error ? (
        <ErrorState error={cal.error} onRetry={() => cal.refetch()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-xs font-medium text-fg-muted">
              {weekdayNames.map((w) => (
                <div key={w} className="py-2">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {Array.from({ length: offset }, (_, i) => (
                <div key={`pad-${i}`} className="min-h-16 border-b border-e border-border bg-surface-2/40 sm:min-h-24" />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const d = iso(cursor.y, cursor.m, i + 1);
                const closed = !cal.data.working_days.includes((offset + i) % 7);
                const events = dayInfo(d);
                return (
                  <div key={d} className={cn('min-h-16 border-b border-e border-border p-1 text-xs sm:min-h-24 sm:p-1.5', closed && 'bg-surface-2/60')}>
                    <div className={cn('mb-1 inline-grid size-6 place-items-center rounded-full', d === today ? 'bg-primary font-semibold text-primary-fg' : closed ? 'text-fg-muted' : '')}>{i + 1}</div>
                    <div className="space-y-0.5">
                      {events.slice(0, 2).map((h) => (
                        <div key={h.id} className={cn('truncate rounded px-1 py-0.5 font-medium', KIND_STYLE[h.kind])} title={h.name}>
                          {h.name}
                        </div>
                      ))}
                      {events.length > 2 && <div className="text-fg-muted">+{events.length - 2}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="mb-3 font-semibold">{t('calendar.thisMonth', 'This month')}</h3>
              {cal.data.holidays.length === 0 ? (
                <EmptyState title={t('calendar.nothing', 'Nothing on the calendar')} />
              ) : (
                <ul className="space-y-2">
                  {cal.data.holidays.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-2 text-sm">
                      <div>
                        <div className="font-medium">{h.name}</div>
                        <div className="text-xs text-fg-muted">
                          {formatDate(h.starts_on)}
                          {h.ends_on !== h.starts_on && ` – ${formatDate(h.ends_on)}`} · <Badge className={KIND_STYLE[h.kind]}>{t(`holidayKind.${h.kind}`, h.kind.replace('_', ' '))}</Badge>
                          {h.campus_name && ` · ${h.campus_name}`}
                        </div>
                      </div>
                      {manage && (
                        <span className="flex shrink-0">
                          <Button variant="ghost" size="sm" aria-label={t('common.edit', 'Edit')} onClick={() => dlg.open({ title: t('common.edit', 'Edit'), initial: { name: h.name, kind: h.kind, starts_on: h.starts_on, ends_on: h.ends_on, campus_id: h.campus_id ? String(h.campus_id) : '' }, submit: save(h) })}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => del.mutate(h)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {cal.data.terms.length > 0 && (
              <Card className="p-4">
                <h3 className="mb-2 font-semibold">{t('calendar.terms', 'Terms in session')}</h3>
                <ul className="space-y-1 text-sm">
                  {cal.data.terms.map((tm) => (
                    <li key={tm.id}>
                      <span className="font-medium">{tm.name}</span>{' '}
                      <span className="text-fg-muted">
                        {tm.academic_year} · {formatDate(tm.starts_on)} – {tm.ends_on ? formatDate(tm.ends_on) : '…'}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
      {dlg.state && <FormDialog open title={dlg.state.title} initial={dlg.state.initial} fields={fields} submitLabel={t('common.save', 'Save')} onSubmit={dlg.state.submit} onClose={dlg.close} />}
    </>
  );
}

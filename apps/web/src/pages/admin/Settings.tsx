// Institution settings: profile and type, terminology, working days, grading schemes, custom
// fields and certificate templates.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { GRADING_KINDS, INSTITUTION_TYPES, TERM_KEYS, gradeFor, type GradeBand, type Terminology } from '@acadex/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTerms } from '@/lib/terms';
import { FormDialog, useFormDialog } from '@/components/FormDialog';
import type { CustomFieldDef } from '@/components/CustomFields';
import { Alert, Badge, Button, Card, ErrorState, Field, Input, MutationError, PageHeader, Select, Skeleton, Tabs, Textarea, useToast } from '@/components/ui';

interface Settings {
  id: number;
  name: string;
  type: (typeof INSTITUTION_TYPES)[number];
  contact_email: string;
  phone: string;
  address: string;
  primary_color: string;
  currency: string;
  timezone: string;
  locale: string;
  country: string;
  settings: { terminology?: Partial<Record<keyof Terminology, { one: string; other?: string }>>; working_days?: number[]; storage_quota_mb?: number; week_start?: number; attendance_geofence?: { lat: number; lng: number; radius_m: number } | null };
  terminology: Terminology;
  packs: Record<string, Terminology>;
}

const DAYS = [1, 2, 3, 4, 5, 6, 0];

function Profile({ s }: { s: Settings }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ name: s.name, type: s.type, contact_email: s.contact_email, phone: s.phone, address: s.address, primary_color: s.primary_color, currency: s.currency, timezone: s.timezone, locale: s.locale, country: s.country });
  const [days, setDays] = useState<number[]>(s.settings.working_days ?? []);
  const [weekStartDay, setWeekStartDay] = useState(s.settings.week_start ?? 1);
  const g = s.settings.attendance_geofence;
  const [fence, setFence] = useState({ lat: g ? String(g.lat) : '', lng: g ? String(g.lng) : '', radius_m: g ? String(g.radius_m) : '300' });
  const geofence = fence.lat && fence.lng ? { lat: Number(fence.lat), lng: Number(fence.lng), radius_m: Number(fence.radius_m) || 300 } : null;
  const m = useMutation({
    mutationFn: () => api.patch('/institution/settings', { ...v, settings: { ...s.settings, working_days: days.length ? days : undefined, week_start: weekStartDay, attendance_geofence: geofence } }),
    onSuccess: () => {
      toast('success', t('common.saved', 'Saved'));
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['terminology'] });
    },
  });
  const dayName = (d: number) => new Intl.DateTimeFormat(i18n.language, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + d)));
  const text = (k: keyof typeof v, label: string, opts: { type?: string; dir?: 'ltr'; hint?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      {(a) => <Input {...a} type={opts.type} dir={opts.dir} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
    </Field>
  );
  const effectiveDays = days.length ? days : null;
  return (
    <Card className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {text('name', t('common.name', 'Name'))}
        <Field label={t('settings.type', 'Kind of institution')} hint={t('settings.typeHint', 'Sets the words used everywhere and the defaults for new setups')}>
          {(a) => (
            <Select {...a} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as Settings['type'] })}>
              {INSTITUTION_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`institutionType.${x}`, x.replace('_', ' '))}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {text('contact_email', t('common.email', 'Email'), { type: 'email', dir: 'ltr' })}
        {text('phone', t('common.phone', 'Phone'), { dir: 'ltr' })}
        {text('address', t('common.address', 'Address'))}
        <Field label={t('settings.color', 'Brand colour')}>
          {(a) => (
            <div className="flex gap-2">
              <input type="color" aria-label={t('settings.color', 'Brand colour')} value={v.primary_color} onChange={(e) => setV({ ...v, primary_color: e.target.value.toUpperCase() })} className="h-10 w-12 rounded border border-border bg-surface" />
              <Input {...a} dir="ltr" value={v.primary_color} onChange={(e) => setV({ ...v, primary_color: e.target.value })} />
            </div>
          )}
        </Field>
        {text('currency', t('settings.currency', 'Currency'), { dir: 'ltr', hint: 'PKR, USD, AED…' })}
        {text('timezone', t('settings.timezone', 'Time zone'), { dir: 'ltr', hint: 'Asia/Karachi' })}
        {text('locale', t('settings.locale', 'Number and date format'), { dir: 'ltr', hint: 'en-PK, ur-PK, ar-AE' })}
        {text('country', t('settings.country', 'Country'), { dir: 'ltr', hint: 'PK' })}
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('settings.workingDays', 'Working days')}</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = effectiveDays ? effectiveDays.includes(d) : d !== 0;
            return (
              <label key={d} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${on ? 'border-primary bg-primary-soft' : 'border-border'}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const base = effectiveDays ?? DAYS.filter((x) => x !== 0);
                    setDays(e.target.checked ? [...base, d].sort() : base.filter((x) => x !== d));
                  }}
                />
                {dayName(d)}
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-fg-muted">{t('settings.workingDaysHelp', 'No attendance or due dates on other days.')}</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.weekStart', 'Week starts on')}>
          {(a) => (
            <Select {...a} value={weekStartDay} onChange={(e) => setWeekStartDay(Number(e.target.value))}>
              {[1, 6, 0].map((d) => <option key={d} value={d}>{dayName(d)}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">{t('settings.geofence', 'QR check-in only on campus (optional)')}</legend>
        <p className="mb-2 text-xs text-fg-muted">{t('settings.geofenceHelp', 'Students must share their location and be within this distance of the point. Leave empty to allow check-in anywhere.')}</p>
        <div className="grid gap-2 sm:grid-cols-4 sm:items-end">
          <Field label={t('settings.lat', 'Latitude')}>{(a) => <Input {...a} dir="ltr" inputMode="decimal" value={fence.lat} onChange={(e) => setFence({ ...fence, lat: e.target.value })} placeholder="31.5204" />}</Field>
          <Field label={t('settings.lng', 'Longitude')}>{(a) => <Input {...a} dir="ltr" inputMode="decimal" value={fence.lng} onChange={(e) => setFence({ ...fence, lng: e.target.value })} placeholder="74.3587" />}</Field>
          <Field label={t('settings.radius', 'Distance (metres)')}>{(a) => <Input {...a} type="number" min={20} max={5000} value={fence.radius_m} onChange={(e) => setFence({ ...fence, radius_m: e.target.value })} />}</Field>
          <Button type="button" variant="outline" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setFence({ ...fence, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }))}>{t('settings.useHere', 'Use my location')}</Button>
        </div>
      </fieldset>
      <MutationError error={m.error} />
      <div className="flex justify-end">
        <Button loading={m.isPending} onClick={() => m.mutate()}>
          {t('common.save', 'Save')}
        </Button>
      </div>
    </Card>
  );
}

function Words({ s }: { s: Settings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const pack = s.packs[s.type]!;
  const [o, setO] = useState<Record<string, { one: string; other: string }>>(
    Object.fromEntries(TERM_KEYS.map((k) => [k, { one: s.settings.terminology?.[k]?.one ?? '', other: s.settings.terminology?.[k]?.other ?? '' }]))
  );
  const m = useMutation({
    mutationFn: () =>
      api.patch('/institution/settings', {
        settings: { ...s.settings, terminology: Object.fromEntries(Object.entries(o).filter(([, w]) => w.one.trim()).map(([k, w]) => [k, { one: w.one.trim(), other: w.other.trim() || undefined }])) },
      }),
    onSuccess: () => {
      toast('success', t('common.saved', 'Saved'));
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['terminology'] });
    },
  });
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-fg-muted">{t('settings.wordsHelp', 'The words come from your kind of institution. Type your own to replace any of them; leave blank to keep the default.')}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TERM_KEYS.map((k) => (
          <div key={k} className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{t(`termKey.${k}`, k)}</div>
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label={`${k} singular`} placeholder={pack[k].one} value={o[k]!.one} onChange={(e) => setO({ ...o, [k]: { ...o[k]!, one: e.target.value } })} />
              <Input aria-label={`${k} plural`} placeholder={pack[k].other} value={o[k]!.other} onChange={(e) => setO({ ...o, [k]: { ...o[k]!, other: e.target.value } })} />
            </div>
          </div>
        ))}
      </div>
      <MutationError error={m.error} />
      <div className="flex justify-end">
        <Button loading={m.isPending} onClick={() => m.mutate()}>
          {t('common.save', 'Save')}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- grading

interface Scheme {
  id: number;
  name: string;
  kind: (typeof GRADING_KINDS)[number];
  bands: GradeBand[];
  gpa_scale: string | null;
  pass_percent: string;
  is_default: boolean;
  programs: number;
}

function SchemeEditor({ initial, presets, onClose }: { initial: Scheme | null; presets: Record<string, Omit<Scheme, 'id' | 'is_default' | 'programs' | 'gpa_scale' | 'pass_percent'> & { gpa_scale?: number; pass_percent: number }>; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [s, setS] = useState({
    name: initial?.name ?? '',
    kind: initial?.kind ?? 'letter',
    gpa_scale: initial?.gpa_scale ?? '',
    pass_percent: initial?.pass_percent ?? '50',
    is_default: initial?.is_default ?? false,
    bands: initial?.bands ?? [{ min: 50, label: 'Pass', passed: true }, { min: 0, label: 'Fail', passed: false }],
  });
  const [preview, setPreview] = useState('75');
  const m = useMutation({
    mutationFn: () => {
      const body = { ...s, gpa_scale: s.gpa_scale === '' ? null : Number(s.gpa_scale), pass_percent: Number(s.pass_percent) };
      return initial ? api.put(`/institution/grading-schemes/${initial.id}`, body) : api.post('/institution/grading-schemes', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['grading-schemes'] });
      void qc.invalidateQueries({ queryKey: ['structure'] });
      onClose();
    },
  });
  const setBand = (i: number, b: Partial<GradeBand>) => setS({ ...s, bands: s.bands.map((x, j) => (j === i ? { ...x, ...b } : x)) });
  const g = gradeFor({ bands: s.bands }, Number(preview) || 0);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('common.name', 'Name')}>{(a) => <Input {...a} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />}</Field>
        <Field label={t('grading.kind', 'Kind')}>
          {(a) => (
            <Select {...a} value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value as Scheme['kind'] })}>
              {GRADING_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`gradingKind.${k}`, k.replace('_', ' '))}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {s.kind === 'gpa' && <Field label={t('grading.scale', 'GPA scale')}>{(a) => <Input {...a} type="number" step="0.5" className="w-24" value={s.gpa_scale} onChange={(e) => setS({ ...s, gpa_scale: e.target.value })} />}</Field>}
        <Field label={t('grading.pass', 'Pass mark %')}>{(a) => <Input {...a} type="number" className="w-24" value={s.pass_percent} onChange={(e) => setS({ ...s, pass_percent: e.target.value })} />}</Field>
        {!initial && (
          <Field label={t('grading.startFrom', 'Start from')} optional>
            {(a) => (
              <Select
                {...a}
                value=""
                onChange={(e) => {
                  const p = presets[e.target.value];
                  if (p) setS({ ...s, name: s.name || p.name, kind: p.kind, bands: p.bands, gpa_scale: p.gpa_scale ? String(p.gpa_scale) : '', pass_percent: String(p.pass_percent) });
                }}
              >
                <option value="">—</option>
                {Object.entries(presets).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-start text-xs text-fg-muted">
            <th className="pb-1 text-start font-medium">{t('grading.from', 'From %')}</th>
            <th className="pb-1 text-start font-medium">{t('grading.label', 'Grade')}</th>
            {s.kind === 'gpa' && <th className="pb-1 text-start font-medium">{t('grading.points', 'Points')}</th>}
            <th className="pb-1 text-start font-medium">{t('grading.passed', 'Pass')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {s.bands.map((b, i) => (
            <tr key={i}>
              <td className="py-1 pe-2">
                <Input type="number" className="w-24" aria-label={t('grading.from', 'From %')} value={b.min} onChange={(e) => setBand(i, { min: Number(e.target.value) })} />
              </td>
              <td className="py-1 pe-2">
                <Input className="w-28" aria-label={t('grading.label', 'Grade')} value={b.label} onChange={(e) => setBand(i, { label: e.target.value })} />
              </td>
              {s.kind === 'gpa' && (
                <td className="py-1 pe-2">
                  <Input type="number" step="0.01" className="w-24" aria-label={t('grading.points', 'Points')} value={b.points ?? ''} onChange={(e) => setBand(i, { points: e.target.value === '' ? null : Number(e.target.value) })} />
                </td>
              )}
              <td className="py-1 pe-2">
                <input type="checkbox" aria-label={t('grading.passed', 'Pass')} checked={b.passed} onChange={(e) => setBand(i, { passed: e.target.checked })} />
              </td>
              <td>
                <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} disabled={s.bands.length < 2} onClick={() => setS({ ...s, bands: s.bands.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => setS({ ...s, bands: [...s.bands, { min: 0, label: '', passed: true }] })}>
          <Plus className="size-4" /> {t('grading.addBand', 'Add a band')}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          {t('grading.try', 'Try a mark:')}
          <Input type="number" className="w-20" value={preview} onChange={(e) => setPreview(e.target.value)} />% →
          <Badge tone={g.passed ? 'success' : 'danger'}>
            {g.label}
            {g.points != null && ` (${g.points})`}
          </Badge>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.is_default} onChange={(e) => setS({ ...s, is_default: e.target.checked })} /> {t('grading.default', 'Use for every program that has no scheme of its own')}
      </label>
      <MutationError error={m.error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel', 'Cancel')}
        </Button>
        <Button loading={m.isPending} onClick={() => m.mutate()}>
          {t('common.save', 'Save')}
        </Button>
      </div>
    </Card>
  );
}

function Grading() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['grading-schemes'], queryFn: () => api.get<{ schemes: Scheme[]; presets: Record<string, never> }>('/institution/grading-schemes') });
  const [editing, setEditing] = useState<Scheme | 'new' | null>(null);
  const del = useMutation({ mutationFn: (s: Scheme) => api.delete(`/institution/grading-schemes/${s.id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['grading-schemes'] }), onError: (e) => toast('error', errorMessage(e)) });
  if (q.isPending) return <Skeleton className="h-48" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (editing) return <SchemeEditor initial={editing === 'new' ? null : editing} presets={q.data.presets} onClose={() => setEditing(null)} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" /> {t('grading.add', 'Add a grading scheme')}
        </Button>
      </div>
      {q.data.schemes.map((s) => (
        <Card key={s.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              {s.name} <Badge>{t(`gradingKind.${s.kind}`, s.kind.replace('_', ' '))}</Badge>
              {s.is_default && <Badge tone="info">{t('grading.isDefault', 'Default')}</Badge>}
              {s.programs > 0 && <span className="text-xs text-fg-muted">{t('grading.usedBy', 'used by {{n}} programs', { n: s.programs })}</span>}
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
                {t('common.edit', 'Edit')}
              </Button>
              {!s.is_default && (
                <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => del.mutate(s)}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...s.bands]
              .sort((a, b) => b.min - a.min)
              .map((b) => (
                <span key={b.label} className={`rounded px-2 py-0.5 text-xs ${b.passed ? 'bg-surface-2' : 'bg-danger-soft text-danger'}`}>
                  {b.label} ≥ {b.min}%{b.points != null && ` · ${b.points}`}
                </span>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- custom fields

function CustomFieldsAdmin() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['custom-fields'], queryFn: () => api.get<CustomFieldDef[]>('/institution/custom-fields') });
  const dlg = useFormDialog();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['custom-fields'] });
  const del = useMutation({ mutationFn: (f: CustomFieldDef) => api.delete(`/institution/custom-fields/${f.id}`), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const fields = [
    { name: 'entity', label: t('fields.for', 'For'), options: [{ value: 'student', label: t('fields.student', 'Students') }, { value: 'staff', label: t('fields.staff', 'Staff') }, { value: 'guardian', label: t('fields.guardian', 'Guardians') }] },
    { name: 'label', label: t('fields.label', 'Label') },
    { name: 'key', label: t('fields.key', 'Key (for imports)'), dir: 'ltr' as const, hint: 'house, transport_route' },
    { name: 'field_type', label: t('fields.type', 'Type'), options: ['text', 'number', 'date', 'select', 'checkbox'].map((x) => ({ value: x, label: t(`fieldType.${x}`, x === 'select' ? 'choice' : x === 'checkbox' ? 'yes / no' : x) })) },
    { name: 'options', label: t('fields.options', 'Choices (comma-separated)'), optional: true },
    { name: 'required', label: t('fields.required', 'Required'), options: [{ value: 'false', label: t('common.no', 'No') }, { value: 'true', label: t('common.yes', 'Yes') }] },
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            dlg.open({
              title: t('fields.add', 'Add a field'),
              initial: { entity: 'student', label: '', key: '', field_type: 'text', options: '', required: 'false' },
              submit: async (v) => {
                await api.post('/institution/custom-fields', { ...v, options: v.options ? v.options.split(',').map((x) => x.trim()).filter(Boolean) : [], required: v.required === 'true' });
                refresh();
              },
            })
          }
        >
          <Plus className="size-4" /> {t('fields.add', 'Add a field')}
        </Button>
      </div>
      {q.data?.length === 0 && <Alert tone="info">{t('fields.none', 'Add fields your institution records that Acadex does not have, like house, transport route or hostel.')}</Alert>}
      <Card className="divide-y divide-border">
        {q.data?.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
            <div>
              <span className="font-medium">{f.label}</span> <span className="font-mono text-xs text-fg-muted">{f.key}</span>
              <span className="ms-2">
                <Badge>{t(`fields.${f.entity}`, f.entity)}</Badge> <Badge>{f.field_type}</Badge> {f.required && <Badge tone="warning">{t('fields.required', 'Required')}</Badge>}
              </span>
              {f.options.length > 0 && <div className="text-xs text-fg-muted">{f.options.join(' · ')}</div>}
            </div>
            <Button variant="ghost" size="sm" aria-label={t('common.delete', 'Delete')} onClick={() => del.mutate(f)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </Card>
      {dlg.state && <FormDialog open title={dlg.state.title} initial={dlg.state.initial} fields={fields} submitLabel={t('common.save', 'Save')} onSubmit={dlg.state.submit} onClose={dlg.close} />}
    </div>
  );
}

// ---------------------------------------------------------------- certificate templates

interface Template {
  kind: string;
  title: string;
  body: string;
  serial_prefix: string;
  customised: boolean;
}
function Templates() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['doc-templates'], queryFn: () => api.get<{ placeholders: string[]; templates: Template[] }>('/institution/document-templates') });
  const [edit, setEdit] = useState<Template | null>(null);
  const save = useMutation({
    mutationFn: (x: Template) => api.put(`/institution/document-templates/${x.kind}`, { title: x.title, body: x.body, serial_prefix: x.serial_prefix }),
    onSuccess: () => {
      setEdit(null);
      toast('success', t('common.saved', 'Saved'));
      void qc.invalidateQueries({ queryKey: ['doc-templates'] });
    },
  });
  const reset = useMutation({ mutationFn: (kind: string) => api.delete(`/institution/document-templates/${kind}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['doc-templates'] }) });
  if (q.isPending) return <Skeleton className="h-48" />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        {t('templates.help', 'Placeholders are filled in when a document is issued:')} <span className="font-mono text-xs">{q.data.placeholders.map((p) => `{{${p}}}`).join(' ')}</span>
      </p>
      {q.data.templates.map((x) =>
        edit?.kind === x.kind ? (
          <Card key={x.kind} className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Input aria-label={t('templates.title', 'Title')} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              <Input aria-label={t('templates.prefix', 'Serial prefix')} dir="ltr" value={edit.serial_prefix} onChange={(e) => setEdit({ ...edit, serial_prefix: e.target.value.toUpperCase() })} />
            </div>
            <Textarea rows={8} aria-label={t('templates.body', 'Text')} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            <MutationError error={save.error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEdit(null)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate(edit)}>
                {t('common.save', 'Save')}
              </Button>
            </div>
          </Card>
        ) : (
          <Card key={x.kind} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">
                {x.title} <span className="font-mono text-xs text-fg-muted">{x.serial_prefix}-YYYY-0001</span> {x.customised && <Badge tone="info">{t('templates.custom', 'Customised')}</Badge>}
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => setEdit(x)}>
                  {t('common.edit', 'Edit')}
                </Button>
                {x.customised && (
                  <Button variant="ghost" size="sm" aria-label={t('templates.reset', 'Back to the default')} onClick={() => reset.mutate(x.kind)}>
                    <RotateCcw className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-fg-muted">{x.body}</p>
          </Card>
        )
      )}
    </div>
  );
}

export function AdminSettings() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/institution/settings') });
  return (
    <>
      <PageHeader title={t('nav.settings', 'Settings')} subtitle={t('settings.subtitle', 'Your {{institution}}, its words and its rules', { institution: term('institution', false, { lower: true }) })} />
      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Tabs
          tabs={[
            { id: 'profile', label: t('settings.profile', 'Profile'), content: () => <Profile key={q.dataUpdatedAt} s={q.data} /> },
            { id: 'words', label: t('settings.words', 'Words'), content: () => <Words key={q.dataUpdatedAt} s={q.data} /> },
            { id: 'grading', label: t('settings.grading', 'Grading'), content: () => <Grading /> },
            { id: 'fields', label: t('settings.fields', 'Custom fields'), content: () => <CustomFieldsAdmin /> },
            { id: 'templates', label: t('settings.templates', 'Certificates'), hidden: !can('documents.issue'), content: () => <Templates /> },
          ]}
        />
      )}
    </>
  );
}

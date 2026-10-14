// The setup guide for a new institution: kind of institution (which sets the words, grading,
// terms and structure templates) → campuses → apply the defaults → next steps.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2, Check, FileSpreadsheet, Plus, School, Trash2, Users } from 'lucide-react';
import { INSTITUTION_TYPES, type InstitutionType, type Terminology } from '@acadex/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, ErrorState, Input, MutationError, PageHeader, Skeleton } from '@/components/ui';

interface Defaults {
  grading: string;
  termKind: string;
  programs: { name: string; code: string; levels: string[] }[];
  year: { name: string; startsOn: string; endsOn: string; terms: { name: string; startsOn: string; endsOn: string | null }[] };
  grading_scheme: { name: string; bands: { min: number; label: string }[] };
  terminology: Terminology;
}
interface Onboarding {
  institution: { name: string; type: InstitutionType };
  counts: Record<string, number>;
  done: boolean;
  defaults: Record<InstitutionType, Defaults>;
}

const STEPS = ['type', 'campuses', 'defaults', 'next'] as const;

export function AdminOnboarding() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<Onboarding>('/institution/onboarding') });
  const [step, setStep] = useState<(typeof STEPS)[number]>('type');
  const [type, setType] = useState<InstitutionType | null>(null);
  const [campuses, setCampuses] = useState<{ name: string; code: string }[]>([]);
  const [programs, setPrograms] = useState<string[] | null>(null);
  const apply = useMutation({
    mutationFn: () => api.post<{ created: Record<string, number> }>('/institution/onboarding/apply', { type: chosen, campuses: campuses.filter((c) => c.name && c.code), programs: programs ?? undefined }),
    onSuccess: () => {
      void qc.invalidateQueries();
      setStep('next');
    },
  });
  const finish = useMutation({
    mutationFn: () => api.post('/institution/onboarding/complete'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
      nav('/admin');
    },
  });
  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const chosen = type ?? q.data.institution.type;
  const d = q.data.defaults[chosen];
  const words = d.terminology;
  const selectedPrograms = programs ?? d.programs.map((p) => p.code);
  const stepIndex = STEPS.indexOf(step);
  return (
    <>
      <PageHeader title={t('onboarding.title', 'Set up {{name}}', { name: q.data.institution.name })} subtitle={t('onboarding.subtitle', 'You can change everything later in Settings and Structure.')} />
      <ol className="mb-6 flex flex-wrap gap-2 text-sm" aria-label={t('onboarding.steps', 'Steps')}>
        {STEPS.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-2 rounded-full px-3 py-1', i === stepIndex ? 'bg-primary text-primary-fg' : i < stepIndex ? 'bg-success-soft text-success' : 'bg-surface-2 text-fg-muted')} aria-current={i === stepIndex ? 'step' : undefined}>
            {i < stepIndex ? <Check className="size-3.5" aria-hidden /> : <span>{i + 1}</span>}
            {t(`onboarding.step.${s}`, { type: 'Kind', campuses: 'Campuses', defaults: 'Year, grading & structure', next: 'People' }[s])}
          </li>
        ))}
      </ol>

      {step === 'type' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {INSTITUTION_TYPES.map((x) => {
              const w = q.data.defaults[x].terminology;
              return (
                <button
                  key={x}
                  type="button"
                  onClick={() => {
                    setType(x);
                    setPrograms(null);
                  }}
                  aria-pressed={chosen === x}
                  className={cn('rounded-xl border-2 p-4 text-start transition-colors', chosen === x ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2')}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <School className="size-4" aria-hidden /> {t(`institutionType.${x}`, w.institution.one)}
                  </div>
                  <p className="mt-2 text-sm text-fg-muted">
                    {w.section.other} · {w.teacher.other} · {w.student.other} · {w.term.other}
                  </p>
                  <p className="mt-1 text-xs text-fg-muted">{q.data.defaults[x].grading_scheme.name}</p>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setStep('campuses')}>{t('common.next', 'Next')}</Button>
          </div>
        </>
      )}

      {step === 'campuses' && (
        <Card className="max-w-2xl space-y-4 p-5">
          <p className="text-sm text-fg-muted">
            {t('onboarding.campusesHelp', 'Your main {{campus}} is set up already. Add the others if you have more than one ({{count}} now).', { campus: words.campus.one.toLowerCase(), count: q.data.counts.campuses || 1 })}
          </p>
          {campuses.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={t('common.name', 'Name')} placeholder={t('onboarding.campusName', 'e.g. DHA branch')} value={c.name} onChange={(e) => setCampuses(campuses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label={t('common.code', 'Code')} className="w-28" dir="ltr" placeholder="DHA" value={c.code} onChange={(e) => setCampuses(campuses.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} />
              <Button variant="ghost" aria-label={t('common.delete', 'Delete')} onClick={() => setCampuses(campuses.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setCampuses([...campuses, { name: '', code: '' }])}>
            <Plus className="size-4" /> {t('onboarding.addCampus', 'Add a {{campus}}', { campus: words.campus.one.toLowerCase() })}
          </Button>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('type')}>
              {t('common.back', 'Back')}
            </Button>
            <Button onClick={() => setStep('defaults')}>{t('common.next', 'Next')}</Button>
          </div>
        </Card>
      )}

      {step === 'defaults' && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <h3 className="mb-2 font-semibold">{words.academicYear.one}</h3>
              <p className="text-sm">
                {d.year.name} · {formatDate(d.year.startsOn)} – {formatDate(d.year.endsOn)}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-fg-muted">
                {d.year.terms.map((x) => (
                  <li key={x.name}>
                    {x.name}: {formatDate(x.startsOn)} – {x.endsOn ? formatDate(x.endsOn) : t('structure.rolling', 'rolling')}
                  </li>
                ))}
              </ul>
              {(q.data.counts.academic_years ?? 0) > 0 && <p className="mt-2 text-xs text-fg-muted">{t('onboarding.haveYear', 'You already have a year — it is kept.')}</p>}
            </Card>
            <Card className="p-5">
              <h3 className="mb-2 font-semibold">{t('onboarding.grading', 'Grading')}</h3>
              <p className="text-sm">{d.grading_scheme.name}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {d.grading_scheme.bands.map((b) => (
                  <span key={b.label} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                    {b.label} ≥ {b.min}%
                  </span>
                ))}
              </div>
              {(q.data.counts.grading_schemes ?? 0) > 0 && <p className="mt-2 text-xs text-fg-muted">{t('onboarding.haveScheme', 'You already have a scheme — it is kept.')}</p>}
            </Card>
            <Card className="p-5">
              <h3 className="mb-2 font-semibold">{words.program.other}</h3>
              <ul className="space-y-2">
                {d.programs.map((p) => (
                  <li key={p.code}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedPrograms.includes(p.code)}
                        onChange={(e) => setPrograms(e.target.checked ? [...selectedPrograms, p.code] : selectedPrograms.filter((c) => c !== p.code))}
                      />
                      <span>
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-xs text-fg-muted">{p.levels.join(' → ')}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Alert tone="info">{t('onboarding.words', 'Everyone will see: {{a}}, {{b}}, {{c}}, {{d}}. You can rename any of them in Settings → Words.', { a: words.section.other, b: words.teacher.other, c: words.student.other, d: words.guardian.other })}</Alert>
          <MutationError error={apply.error} />
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('campuses')}>
              {t('common.back', 'Back')}
            </Button>
            <Button loading={apply.isPending} onClick={() => apply.mutate()}>
              <Check className="size-4" /> {t('onboarding.apply', 'Set it up')}
            </Button>
          </div>
        </div>
      )}

      {step === 'next' && (
        <div className="space-y-4">
          <Alert tone="success" title={t('onboarding.ready', 'Your structure is ready')}>
            {apply.data && Object.entries(apply.data.created).filter(([, n]) => n > 0).map(([k, n]) => <Badge key={k} className="me-1">{n} {k.replace('_', ' ')}</Badge>)}
          </Alert>
          <div className="grid gap-4 md:grid-cols-3">
            <Link to="/admin/sections" className="rounded-xl border border-border p-4 hover:bg-surface-2">
              <Building2 className="mb-2 size-5 text-primary" aria-hidden />
              <div className="font-semibold">{t('onboarding.nextSections', 'Create your {{sections}}', { sections: words.section.other.toLowerCase() })}</div>
              <p className="text-sm text-fg-muted">{t('onboarding.nextSectionsHelp', 'One per group of {{students}} that learn together.', { students: words.student.other.toLowerCase() })}</p>
            </Link>
            <Link to="/admin/imports" className="rounded-xl border border-border p-4 hover:bg-surface-2">
              <FileSpreadsheet className="mb-2 size-5 text-primary" aria-hidden />
              <div className="font-semibold">{t('onboarding.nextImport', 'Import your people')}</div>
              <p className="text-sm text-fg-muted">{t('onboarding.nextImportHelp', 'Students, staff and guardians from a spreadsheet, checked before anything is saved.')}</p>
            </Link>
            <Link to="/admin/teachers" className="rounded-xl border border-border p-4 hover:bg-surface-2">
              <Users className="mb-2 size-5 text-primary" aria-hidden />
              <div className="font-semibold">{t('onboarding.nextStaff', 'Invite your {{teachers}}', { teachers: words.teacher.other.toLowerCase() })}</div>
              <p className="text-sm text-fg-muted">{t('onboarding.nextStaffHelp', 'They choose their own password from the invitation.')}</p>
            </Link>
          </div>
          <div className="flex justify-end">
            <Button loading={finish.isPending} onClick={() => finish.mutate()}>
              {t('onboarding.finish', 'Finish setup')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

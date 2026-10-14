// Year end in four steps: choose the years → create next year's classes → check who moves where
// (promote, repeat, graduate, leave) → apply all at once and archive the old year. Batches
// (universities, academies) can instead move up a level.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Archive, ArrowRight, CheckCircle2, Wand2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useTerms } from '@/lib/terms';
import { Alert, Badge, Button, Card, ConfirmDialog, ErrorState, Field, PageHeader, Select, Skeleton, Tabs, useToast } from '@/components/ui';
import { sectionName, useStructure } from './structure-data';

type Action = 'promoted' | 'repeated' | 'graduated' | 'left';
interface PreviewSection {
  id: number;
  name: string;
  label: string;
  campus_name: string | null;
  level_name: string | null;
  program_name: string | null;
  students: number;
  default_action: Action;
  promote_to: { id: number; name: string; label: string } | null;
  repeat_to: { id: number; name: string; label: string } | null;
  missing_target: boolean;
}
interface Preview {
  from: { id: number; name: string; status: string; is_current: boolean };
  to: { id: number; name: string };
  sections: PreviewSection[];
  to_sections: { id: number; name: string; label: string; level_name: string | null; campus_name: string | null }[];
  moves: { student_id: number; first_name: string; last_name: string; roll_no: string | null; from_section_id: number; action: Action; to_section_id: number | null }[];
}

function Promote() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const toast = useToast();
  const qc = useQueryClient();
  const structure = useStructure();
  const years = useMemo(() => [...(structure.data?.academic_years ?? [])].sort((a, b) => a.starts_on.localeCompare(b.starts_on)), [structure.data]);
  const current = years.find((y) => y.is_current);
  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const from = fromId || String(current?.id ?? '');
  const to = toId || String(years.find((y) => current && y.starts_on > current.starts_on)?.id ?? '');
  const [moves, setMoves] = useState<Record<number, { action: Action; to_section_id: number | null }>>({});
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [done, setDone] = useState<Record<Action, number> | null>(null);
  const preview = useQuery({
    queryKey: ['year-end', from, to],
    queryFn: () => api.get<Preview>('/institution/year-end/preview', { from_year_id: from, to_year_id: to }),
    enabled: !!from && !!to && from !== to,
  });
  const prepare = useMutation({
    mutationFn: () => api.post<{ created: { code: string }[] }>('/institution/year-end/prepare-sections', { from_year_id: Number(from), to_year_id: Number(to) }),
    onSuccess: (r) => {
      toast('success', t('yearEnd.prepared', '{{n}} {{sections}} created', { n: r.created.length, sections: term('section', true, { lower: true }) }));
      setMoves({});
      void qc.invalidateQueries({ queryKey: ['year-end'] });
      void qc.invalidateQueries({ queryKey: ['/institution/sections'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () =>
      api.post<Record<Action, number>>('/institution/year-end/promote', {
        moves: preview.data!.moves.map((m) => ({ student_id: m.student_id, ...(moves[m.student_id] ?? { action: m.action, to_section_id: m.to_section_id }) })),
      }),
    onSuccess: (r) => {
      setDone(r);
      void qc.invalidateQueries();
    },
  });
  const archive = useMutation({
    mutationFn: () => api.post(`/institution/academic-years/${from}/archive`, preview.data?.from.is_current ? { next_current_year_id: Number(to) } : {}),
    onSuccess: () => {
      setArchiveOpen(false);
      toast('success', t('yearEnd.archived', 'Archived. It is read-only from now on.'));
      void qc.invalidateQueries();
    },
  });
  if (structure.isPending) return <Skeleton className="h-64" />;
  const move = (m: Preview['moves'][number]) => moves[m.student_id] ?? { action: m.action, to_section_id: m.to_section_id };
  const setMove = (id: number, v: Partial<{ action: Action; to_section_id: number | null }>, base: { action: Action; to_section_id: number | null }) =>
    setMoves({ ...moves, [id]: { ...base, ...v } });
  const missing = preview.data?.moves.filter((m) => ['promoted', 'repeated'].includes(move(m).action) && !move(m).to_section_id).length ?? 0;
  const setSection = (sec: PreviewSection, action: Action) => {
    const next = { ...moves };
    for (const m of preview.data!.moves.filter((x) => x.from_section_id === sec.id)) {
      next[m.student_id] = { action, to_section_id: action === 'promoted' ? (sec.promote_to?.id ?? null) : action === 'repeated' ? (sec.repeat_to?.id ?? null) : null };
    }
    setMoves(next);
  };
  return (
    <div className="space-y-6">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label={t('yearEnd.from', 'Finishing')}>
          {(a) => (
            <Select {...a} value={from} onChange={(e) => (setFromId(e.target.value), setMoves({}))}>
              {years.filter((y) => y.status !== 'archived').map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ArrowRight className="mb-3 size-4 text-fg-muted rtl:rotate-180" aria-hidden />
        <Field label={t('yearEnd.to', 'Starting')}>
          {(a) => (
            <Select {...a} value={to} onChange={(e) => (setToId(e.target.value), setMoves({}))}>
              <option value="">{t('common.choose', 'Choose…')}</option>
              {years.filter((y) => y.status !== 'archived' && String(y.id) !== from).map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!to && (
          <Alert tone="info" className="flex-1">
            {t('yearEnd.needNextYear', 'First add next year in')} <Link to="/admin/structure#years" className="font-medium text-primary underline">{t('nav.structure', 'Structure')}</Link>.
          </Alert>
        )}
      </Card>
      {preview.isPending && to ? <Skeleton className="h-64" /> : preview.error ? <ErrorState error={preview.error} /> : null}
      {done && (
        <Alert tone="success" title={t('yearEnd.applied', 'Done')}>
          {t('yearEnd.summary', '{{p}} promoted, {{r}} repeating, {{g}} graduated, {{l}} left.', { p: done.promoted, r: done.repeated, g: done.graduated, l: done.left })}{' '}
          <Button variant="outline" size="sm" className="ms-2" onClick={() => setArchiveOpen(true)}>
            <Archive className="size-4" /> {t('yearEnd.archiveNow', 'Archive {{year}}', { year: preview.data?.from.name })}
          </Button>
        </Alert>
      )}
      {preview.data && !done && (
        <>
          {preview.data.sections.some((s) => s.missing_target) && (
            <Alert tone="warning" title={t('yearEnd.missingTitle', '{{year}} has no {{sections}} to move into yet', { year: preview.data.to.name, sections: term('section', true, { lower: true }) })}>
              <Button className="mt-2" size="sm" loading={prepare.isPending} onClick={() => prepare.mutate()}>
                <Wand2 className="size-4" /> {t('yearEnd.prepare', 'Create them from this year')}
              </Button>
            </Alert>
          )}
          {preview.data.sections.map((sec) => {
            const rows = preview.data!.moves.filter((m) => m.from_section_id === sec.id);
            if (!rows.length) return null;
            return (
              <Card key={sec.id} className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {sectionName(sec)} <span className="text-sm font-normal text-fg-muted">{[sec.program_name, sec.campus_name].filter(Boolean).join(' · ')}</span>
                    </div>
                    <div className="text-sm text-fg-muted">
                      {sec.default_action === 'graduated' ? t('yearEnd.finalLevel', 'Final level: students graduate') : sec.promote_to ? t('yearEnd.goesTo', 'Moves to {{name}}', { name: sectionName(sec.promote_to) }) : t('yearEnd.noTarget', 'No class to move into yet')}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['promoted', 'repeated', 'graduated', 'left'] as const).map((a) => (
                      <Button key={a} variant="outline" size="sm" onClick={() => setSection(sec, a)}>
                        {t('yearEnd.allAction', 'All {{action}}', { action: t(`promotion.${a}`, a) })}
                      </Button>
                    ))}
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((m) => {
                    const v = move(m);
                    return (
                      <li key={m.student_id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <span className="min-w-40 flex-1">
                          {m.first_name} {m.last_name} <span className="font-mono text-xs text-fg-muted">{m.roll_no}</span>
                        </span>
                        <Select className="w-36" aria-label={t('yearEnd.action', 'Action for {{name}}', { name: m.first_name })} value={v.action} onChange={(e) => {
                          const action = e.target.value as Action;
                          setMove(m.student_id, { action, to_section_id: action === 'promoted' ? (sec.promote_to?.id ?? null) : action === 'repeated' ? (sec.repeat_to?.id ?? null) : null }, v);
                        }}>
                          {(['promoted', 'repeated', 'graduated', 'left'] as const).map((a) => (
                            <option key={a} value={a}>
                              {t(`promotion.${a}`, a)}
                            </option>
                          ))}
                        </Select>
                        {['promoted', 'repeated'].includes(v.action) && (
                          <Select className="w-48" aria-label={t('yearEnd.target', 'Class for {{name}}', { name: m.first_name })} value={v.to_section_id ?? ''} onChange={(e) => setMove(m.student_id, { to_section_id: e.target.value ? Number(e.target.value) : null }, v)}>
                            <option value="">{t('common.choose', 'Choose…')}</option>
                            {preview.data!.to_sections.map((s) => (
                              <option key={s.id} value={s.id}>
                                {sectionName(s)}
                                {s.campus_name ? ` · ${s.campus_name}` : ''}
                              </option>
                            ))}
                          </Select>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
          {preview.data.moves.length === 0 ? (
            <Alert tone="info">{t('yearEnd.nobody', 'No active students in {{year}}.', { year: preview.data.from.name })}</Alert>
          ) : (
            <Card className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 p-4 shadow-lg">
              <span className="text-sm">
                {missing > 0 ? (
                  <Badge tone="warning">{t('yearEnd.missingN', '{{n}} students still need a class', { n: missing })}</Badge>
                ) : (
                  t('yearEnd.ready', '{{n}} students ready. Everything is applied together, or nothing is.', { n: preview.data.moves.length })
                )}
              </span>
              {apply.isError && <span className="text-sm text-danger">{errorMessage(apply.error)}</span>}
              <Button disabled={missing > 0} loading={apply.isPending} onClick={() => apply.mutate()}>
                <CheckCircle2 className="size-4" /> {t('yearEnd.apply', 'Apply year end')}
              </Button>
            </Card>
          )}
        </>
      )}
      <ConfirmDialog open={archiveOpen} title={t('yearEnd.archiveTitle', 'Archive {{year}}?', { year: preview.data?.from.name })} confirmLabel={t('yearEnd.archive', 'Archive')} danger={false} busy={archive.isPending} error={archive.error} onConfirm={() => archive.mutate()} onClose={() => setArchiveOpen(false)}>
        {t('yearEnd.archiveHelp', 'Its classes, attendance and grades stay visible but can no longer be changed. {{next}} becomes the current year.', { next: preview.data?.to.name })}
      </ConfirmDialog>
    </div>
  );
}

function Advance() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const toast = useToast();
  const qc = useQueryClient();
  const sections = useQuery({
    queryKey: ['/institution/sections', 'advance'],
    queryFn: () => api.get<{ id: number; name: string; label: string | null; level_name: string | null; program_name: string | null; students: number }[]>('/institution/sections', { pageSize: 100 }),
  });
  const [picked, setPicked] = useState<number[]>([]);
  const m = useMutation({
    mutationFn: () => api.post<{ advanced: number }>('/institution/year-end/advance-sections', { section_ids: picked, steps: 1 }),
    onSuccess: (r) => {
      toast('success', t('yearEnd.advanced', '{{n}} moved up a level', { n: r.advanced }));
      setPicked([]);
      void qc.invalidateQueries({ queryKey: ['/institution/sections'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm text-fg-muted">{t('yearEnd.advanceHelp', 'For {{sections}} that stay together (a batch or cohort): move each one to the next {{level}} of its program.', { sections: term('section', true, { lower: true }), level: term('level', false, { lower: true }) })}</p>
      <ul className="divide-y divide-border">
        {sections.data?.map((s) => (
          <li key={s.id}>
            <label className="flex items-center gap-3 py-2 text-sm">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
              <span className="flex-1">
                {sectionName(s)} <span className="text-fg-muted">{s.program_name && `${s.program_name} · ${s.level_name}`}</span>
              </span>
              <span className="text-xs text-fg-muted">{s.students}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button disabled={!picked.length} loading={m.isPending} onClick={() => m.mutate()}>
        {t('yearEnd.advance', 'Move {{n}} up a level', { n: picked.length })}
      </Button>
    </Card>
  );
}

export function AdminYearEnd() {
  const { t } = useTranslation();
  const { type } = useTerms();
  const batches = ['university', 'academy', 'training_center', 'college'].includes(type);
  return (
    <>
      <PageHeader title={t('nav.yearEnd', 'Year end')} subtitle={t('yearEnd.subtitle', 'Promote, graduate and close the year')} />
      <Tabs
        tabs={[
          { id: 'promote', label: t('yearEnd.promoteTab', 'Promote students'), content: () => <Promote /> },
          { id: 'advance', label: t('yearEnd.advanceTab', 'Move batches up'), hidden: !batches, content: () => <Advance /> },
        ]}
      />
    </>
  );
}

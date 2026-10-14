// Bulk import from CSV or Excel: choose what to import, upload, see a dry run row by row, then
// import (all at once, or only the good rows). Templates, history and bulk invitations.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, FileSpreadsheet, MailPlus, Upload, XCircle } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useTerms } from '@/lib/terms';
import { Alert, Badge, Button, Card, DataTable, Field, PageHeader, Select, StatCard, useToast } from '@/components/ui';

const ENTITIES = ['students', 'staff', 'guardians', 'courses', 'enrollments'] as const;
type Entity = (typeof ENTITIES)[number];

interface PreviewRow {
  row: number;
  action: 'create' | 'update' | 'link' | 'skip';
  label: string;
  errors: { field: string; message: string }[];
}
interface Preview {
  entity: Entity;
  mode: 'create' | 'upsert';
  file_name: string;
  total: number;
  valid: number;
  invalid: number;
  creates: number;
  updates: number;
  links: number;
  columns: { matched: string[]; unmatched: string[] };
  rows: PreviewRow[];
}
interface Job {
  id: number;
  entity: string;
  mode: string;
  file_name: string;
  total_rows: number;
  ok_rows: number;
  error_rows: number;
  created_at: string;
  created_by_name: string | null;
}

export function AdminImports() {
  const { t } = useTranslation();
  const { term } = useTerms();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const initial = (typeof window !== 'undefined' && (ENTITIES as readonly string[]).includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'students') as Entity;
  const [entity, setEntity] = useState<Entity>(initial);
  const [mode, setMode] = useState<'create' | 'upsert'>('create');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sendInvites, setSendInvites] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const label: Record<Entity, string> = {
    students: term('student', true),
    staff: t('nav.staff', 'Staff'),
    guardians: term('guardian', true),
    courses: term('course', true),
    enrollments: t('imports.enrollments', 'Enrolments'),
  };
  const jobs = useQuery({ queryKey: ['import-jobs'], queryFn: () => api.get<Job[]>('/institution/imports') });
  const reset = () => {
    setPreview(null);
    run.reset();
    commit.reset();
  };
  const run = useMutation({
    mutationFn: () => api.upload<Preview>('POST', `/institution/imports/${entity}/preview`, file!, { mode }),
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: (skipInvalid: boolean) =>
      api.upload<Preview & { imported: number; skipped: number; accounts: number; invites_sent: number }>('POST', `/institution/imports/${entity}/commit`, file!, {
        mode,
        skip_invalid: String(skipInvalid),
        send_invites: String(sendInvites),
      }),
    onSuccess: (r) => {
      toast('success', t('imports.done', '{{n}} rows imported', { n: r.imported }));
      setPreview(null);
      setFile(null);
      void qc.invalidateQueries({ queryKey: ['import-jobs'] });
      void qc.invalidateQueries();
    },
    onError: (e) => {
      // 422 carries a fresh row-by-row report
      if (e instanceof ApiError && e.status === 422) run.mutate();
    },
  });
  const bulkInvite = useMutation({
    mutationFn: (kind: 'students' | 'staff' | 'guardians') => api.post<{ invited: number; skipped: number }>('/institution/bulk-invite', { kind }),
    onSuccess: (r) => toast('success', t('imports.invited', '{{n}} invitations sent', { n: r.invited })),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const template = () => void api.download(`/institution/imports/templates/${entity}`, `acadex-${entity}-template.csv`).catch((e) => toast('error', errorMessage(e)));
  const rows = preview ? (onlyErrors ? preview.rows.filter((r) => r.errors.length) : preview.rows) : [];

  return (
    <>
      <PageHeader title={t('nav.imports', 'Imports')} subtitle={t('imports.subtitle', 'Add or update many records at once from a spreadsheet. Nothing changes until you confirm.')} />
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <Field label={t('imports.what', 'What are you importing?')}>
              {(a) => (
                <Select
                  {...a}
                  value={entity}
                  onChange={(e) => {
                    setEntity(e.target.value as Entity);
                    reset();
                  }}
                >
                  {ENTITIES.map((x) => (
                    <option key={x} value={x}>
                      {label[x]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{t('imports.mode', 'Existing records')}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === 'create'} onChange={() => (setMode('create'), reset())} /> {t('imports.createOnly', 'Only add new ones (skip existing)')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="mode" checked={mode === 'upsert'} onChange={() => (setMode('upsert'), reset())} /> {t('imports.upsert', 'Add new and update existing')}
              </label>
            </fieldset>
            <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border text-sm text-fg-muted hover:bg-surface-2">
              <FileSpreadsheet className="size-6" aria-hidden />
              {file ? <span className="font-medium text-fg">{file.name}</span> : t('imports.choose', 'Choose a CSV or Excel file')}
              <input
                type="file"
                className="sr-only"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  reset();
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!file} loading={run.isPending} onClick={() => run.mutate()}>
                <Upload className="size-4" /> {t('imports.check', 'Check the file')}
              </Button>
              <Button variant="ghost" onClick={template}>
                <Download className="size-4" /> {t('imports.template', 'Template')}
              </Button>
            </div>
            <p className="text-xs text-fg-muted">{t('imports.formats', 'Up to 2,000 rows. Column names are matched loosely, and OneRoster names (givenName, familyName, identifier…) work too. Dates as YYYY-MM-DD or DD/MM/YYYY.')}</p>
            {run.isError && <Alert tone="danger">{errorMessage(run.error)}</Alert>}
          </Card>
          {can('students.manage') && (
            <Card className="space-y-2 p-5">
              <h3 className="font-semibold">{t('imports.inviteTitle', 'Send invitations')}</h3>
              <p className="text-sm text-fg-muted">{t('imports.inviteHelp', 'Everyone who has not activated an account gets a fresh link by email.')}</p>
              <div className="flex flex-wrap gap-2">
                {(['students', 'staff', 'guardians'] as const).map((k) => (
                  <Button key={k} variant="outline" size="sm" loading={bulkInvite.isPending && bulkInvite.variables === k} onClick={() => bulkInvite.mutate(k)}>
                    <MailPlus className="size-4" /> {label[k]}
                  </Button>
                ))}
              </div>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          {preview ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label={t('imports.rows', 'Rows')} value={preview.total} />
                <StatCard label={t('imports.ready', 'Ready')} value={preview.valid} tone="success" />
                <StatCard label={t('imports.problems', 'With problems')} value={preview.invalid} tone={preview.invalid ? 'danger' : 'success'} />
                <StatCard label={t('imports.changes', 'New / updated / linked')} value={`${preview.creates} / ${preview.updates} / ${preview.links}`} />
              </div>
              {preview.columns.unmatched.length > 0 && (
                <Alert tone="warning">{t('imports.unmatched', 'These columns are ignored: {{cols}}', { cols: preview.columns.unmatched.join(', ') })}</Alert>
              )}
              <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> {t('imports.onlyProblems', 'Show only rows with problems')}
                  </label>
                  {['students', 'staff'].includes(entity) && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} /> {t('imports.sendInvites', 'Email invitations right away')}
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={preview.invalid > 0 || preview.valid === 0} loading={commit.isPending && commit.variables === false} onClick={() => commit.mutate(false)}>
                    <CheckCircle2 className="size-4" /> {t('imports.importAll', 'Import all {{n}} rows', { n: preview.valid })}
                  </Button>
                  {preview.invalid > 0 && preview.valid > 0 && (
                    <Button variant="outline" loading={commit.isPending && commit.variables === true} onClick={() => commit.mutate(true)}>
                      {t('imports.importValid', 'Import the {{n}} good rows, skip {{bad}}', { n: preview.valid, bad: preview.invalid })}
                    </Button>
                  )}
                </div>
                {commit.isError && !(commit.error instanceof ApiError && commit.error.status === 422) && <Alert tone="danger">{errorMessage(commit.error)}</Alert>}
              </Card>
              <DataTable
                rows={rows}
                rowKey={(r) => r.row}
                empty={t('imports.noProblems', 'No problems')}
                columns={[
                  { key: 'row', header: t('imports.row', 'Row'), cell: (r) => <span className="font-mono text-xs">{r.row}</span> },
                  { key: 'label', header: t('imports.record', 'Record'), cell: (r) => r.label },
                  {
                    key: 'action',
                    header: t('imports.result', 'What happens'),
                    cell: (r) =>
                      r.errors.length ? (
                        <ul className="space-y-0.5 text-sm text-danger">
                          {r.errors.map((e, i) => (
                            <li key={i} className="flex items-start gap-1">
                              <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                              <span>
                                <span className="font-mono text-xs">{e.field}</span>: {e.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Badge tone={r.action === 'create' ? 'success' : 'info'}>{t(`imports.action.${r.action}`, r.action === 'create' ? 'Add' : r.action === 'update' ? 'Update' : 'Link')}</Badge>
                      ),
                  },
                ]}
              />
            </>
          ) : (
            <Card className="p-5">
              <h3 className="mb-3 font-semibold">{t('imports.recent', 'Recent imports')}</h3>
              <DataTable
                rows={jobs.data}
                loading={jobs.isPending}
                error={jobs.error}
                rowKey={(j) => j.id}
                empty={t('imports.none', 'No imports yet')}
                columns={[
                  { key: 'when', header: t('common.date', 'Date'), cell: (j) => formatDate(j.created_at) },
                  { key: 'what', header: t('imports.what', 'What are you importing?'), cell: (j) => label[j.entity as Entity] ?? j.entity },
                  { key: 'file', header: t('imports.file', 'File'), cell: (j) => <span className="text-xs">{j.file_name}</span>, hideOnMobile: true },
                  { key: 'rows', header: t('imports.rows', 'Rows'), cell: (j) => `${j.ok_rows} / ${j.total_rows}${j.error_rows ? ` · ${j.error_rows} ${t('imports.skippedShort', 'skipped')}` : ''}` },
                  { key: 'who', header: t('imports.by', 'By'), cell: (j) => j.created_by_name ?? '—', hideOnMobile: true },
                ]}
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

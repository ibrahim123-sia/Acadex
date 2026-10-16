// Institution-level AI screens: AI settings, usage and cost (the transparency page), student
// success (early warning and interventions), Ask Acadex, and the help center with its assistant.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookOpen, HelpCircle, Play, Sparkles } from 'lucide-react';
import { HELP_ARTICLES } from '@acadex/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, ErrorState, Field, Input, MutationError, PageHeader, Select, Spinner, Tabs, useToast } from '@/components/ui';
import { AiBadge } from './CourseAi';

// ---------------------------------------------------------------- settings and usage

interface AiSettingsResponse {
  settings: { enabled: boolean; features: Record<string, boolean>; provider: string | null; models: Record<string, string>; monthly_budget_usd: number | null; minors_strict: boolean; risk_include_fees: boolean; risk_guardian_alerts: boolean };
  features: { feature: string; label: string; enabled: boolean; provider: string; model: string; own_key: boolean }[];
  budget: { spent_usd: number; cap_usd: number };
  own_keys: { provider: string; updated_at: string }[];
}

export function AiSettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.ai', 'AI')} subtitle={t('ai.settingsSubtitle', 'What AI does here, which model, what it costs — and the off switches')} />
      <Tabs tabs={[{ id: 'settings', label: t('nav.settings', 'Settings'), content: () => <SettingsTab /> }, { id: 'usage', label: t('ai.usage', 'Usage and cost'), content: () => <UsageTab /> }]} />
    </>
  );
}

function SettingsTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const q = useQuery({ queryKey: ['/ai/settings'], queryFn: () => api.get<AiSettingsResponse>('/ai/settings') });
  const [v, setV] = useState<AiSettingsResponse['settings'] | null>(null);
  const [key, setKey] = useState({ provider: 'anthropic', key: '' });
  const cur = v ?? q.data?.settings;
  const save = useMutation({ mutationFn: () => api.put('/ai/settings', cur), onSuccess: () => { toast('success', t('common.saved', 'Saved')); setV(null); void q.refetch(); } });
  const saveKey = useMutation({ mutationFn: () => api.put('/ai/keys', key), onSuccess: () => { setKey({ ...key, key: '' }); void q.refetch(); toast('success', t('common.saved', 'Saved')); } });
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data || !cur) return <Spinner />;
  const b = q.data.budget;
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={cur.enabled} onChange={(e) => setV({ ...cur, enabled: e.target.checked })} /> {t('ai.enabledAll', 'AI is on for the institution')}</label>
        <DataTable
          rows={q.data.features}
          rowKey={(r) => r.feature}
          columns={[
            { key: 'on', header: t('ai.on', 'On'), cell: (r) => <input type="checkbox" aria-label={r.label} checked={cur.features[r.feature] !== false} onChange={(e) => setV({ ...cur, features: { ...cur.features, [r.feature]: e.target.checked } })} /> },
            { key: 'f', header: t('ai.feature', 'Feature'), cell: (r) => r.label },
            { key: 'm', header: t('ai.model', 'Model'), cell: (r) => <span className="font-mono text-xs">{r.provider} / {r.model}{r.own_key && ' (your key)'}</span>, hideOnMobile: true },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ai.budget', 'Monthly budget (USD)')} hint={t('ai.budgetHint', 'Spent this month: ${{spent}} of ${{cap}}', { spent: b.spent_usd.toFixed(2), cap: Number.isFinite(b.cap_usd) ? b.cap_usd.toFixed(2) : '∞' })}>
            {(a) => <Input {...a} type="number" min={0} placeholder={t('ai.planCap', 'Plan limit')} value={cur.monthly_budget_usd ?? ''} onChange={(e) => setV({ ...cur, monthly_budget_usd: e.target.value === '' ? null : Number(e.target.value) })} />}
          </Field>
          <Field label={t('ai.provider', 'Provider (with your own key)')} optional>
            {(a) => <Select {...a} value={cur.provider ?? ''} onChange={(e) => setV({ ...cur, provider: e.target.value || null })}><option value="">{t('ai.platform', 'Acadex default')}</option>{['anthropic', 'openai', 'gemini', 'groq'].map((p) => <option key={p} value={p}>{p}</option>)}</Select>}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.minors_strict} onChange={(e) => setV({ ...cur, minors_strict: e.target.checked })} /> {t('ai.minors', 'Extra-safe tutor for students under 18')}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.risk_include_fees} onChange={(e) => setV({ ...cur, risk_include_fees: e.target.checked })} /> {t('ai.riskFees', 'Count overdue fees in the early-warning score')}</label>
        <MutationError error={save.error} />
        <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save', 'Save')}</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">{t('ai.ownKey', 'Your own provider key')}</h2>
        <p className="text-sm text-fg-muted">{t('ai.ownKeyHelp', 'Calls on your own key are logged but not counted against the plan budget. Keys are encrypted and never shown again.')}</p>
        {q.data.own_keys.map((k) => <Badge key={k.provider} tone="success">{k.provider} · {formatDate(k.updated_at)}</Badge>)}
        <div className="flex flex-wrap items-end gap-2">
          <Select aria-label={t('ai.provider', 'Provider')} value={key.provider} onChange={(e) => setKey({ ...key, provider: e.target.value })} className="w-40">{['anthropic', 'openai', 'gemini', 'groq'].map((p) => <option key={p} value={p}>{p}</option>)}</Select>
          <Input aria-label={t('ai.key', 'API key')} type="password" autoComplete="off" value={key.key} onChange={(e) => setKey({ ...key, key: e.target.value })} className="max-w-sm" placeholder={t('ai.keyHint', 'Paste the key (empty removes it)')} />
          <Button variant="outline" loading={saveKey.isPending} onClick={() => saveKey.mutate()}>{t('common.save', 'Save')}</Button>
        </div>
        <MutationError error={saveKey.error} />
      </Card>
      <Alert>{t('ai.privacy', 'Before anything is sent to a model, names, emails, phone numbers and ID numbers are removed; course and student content is treated as data, never as instructions; and nothing changes in Acadex until a person approves it.')}</Alert>
    </div>
  );
}

function UsageTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/ai/usage'], queryFn: () => api.get<{ by_feature: { feature: string; provider: string; model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; failed: number }[]; recent: { created_at: string; feature: string; model: string; cost_usd: number; status: string; by: string | null }[] }>('/ai/usage') });
  return (
    <div className="space-y-4">
      <DataTable
        rows={q.data?.by_feature}
        loading={q.isPending}
        error={q.error}
        rowKey={(r, i) => i}
        empty={t('ai.noUsage', 'No AI use in the last 30 days')}
        columns={[
          { key: 'f', header: t('ai.feature', 'Feature'), cell: (r) => r.feature },
          { key: 'm', header: t('ai.model', 'Model'), cell: (r) => <span className="font-mono text-xs">{r.provider}/{r.model}</span>, hideOnMobile: true },
          { key: 'c', header: t('ai.calls', 'Calls'), cell: (r) => `${r.calls}${r.failed ? ` (${r.failed} failed)` : ''}` },
          { key: 't', header: t('ai.tokens', 'Tokens'), cell: (r) => (r.input_tokens + r.output_tokens).toLocaleString(), hideOnMobile: true },
          { key: 'usd', header: 'USD', cell: (r) => r.cost_usd.toFixed(4) },
        ]}
      />
      <Card className="p-4">
        <h3 className="mb-2 font-semibold">{t('ai.recent', 'Recent calls')}</h3>
        <ul className="divide-y divide-border text-sm">{q.data?.recent.map((r, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{formatDateTime(r.created_at)} · {r.feature} · {r.by ?? '—'}</span><span className="text-fg-muted">{r.model} · ${r.cost_usd.toFixed(4)} · {r.status}</span></li>)}</ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- student success

interface RiskRow { student_id: number; name: string; roll_no: string | null; section_name: string | null; score: number; level: 'low' | 'medium' | 'high'; factors: { key: string; label: string; value: string; points: number }[]; computed_on: string; open_interventions: number }
const LEVEL_TONE = { high: 'danger', medium: 'warning', low: 'success' } as const;

export function SuccessPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const toast = useToast();
  const [level, setLevel] = useState('high');
  const q = useQuery({ queryKey: ['/ai/risk', level], queryFn: () => api.get<RiskRow[]>('/ai/risk', { level: level || undefined }) });
  const run = useMutation({ mutationFn: () => api.post<{ students: number; high: number }>('/ai/risk/run'), onSuccess: (r) => { toast('success', t('ai.riskRan', '{{n}} students scored, {{h}} at high risk', { n: r.students, h: r.high })); void q.refetch(); } });
  const [open, setOpen] = useState<RiskRow | null>(null);
  return (
    <>
      <PageHeader title={t('nav.success', 'Student success')} subtitle={t('ai.successSubtitle', 'Who may need help, and why — scored every night from attendance, grades, work and activity')} actions={can('risk.manage') && <Button variant="outline" loading={run.isPending} onClick={() => run.mutate()}><Play className="size-4" /> {t('ai.runNow', 'Score now')}</Button>} />
      <div className="mb-4 flex gap-2">
        {['high', 'medium', 'low', ''].map((l) => <Button key={l} size="sm" variant={level === l ? 'primary' : 'outline'} onClick={() => setLevel(l)}>{l ? t(`ai.level.${l}`, l) : t('common.all', 'All')}</Button>)}
      </div>
      <DataTable
        rows={q.data}
        loading={q.isPending}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(r) => r.student_id}
        empty={t('ai.noRisk', 'Nobody here — or scores have not been calculated yet')}
        columns={[
          { key: 'n', header: t('common.student', 'Student'), cell: (r) => <button className="text-start font-medium text-primary hover:underline" onClick={() => setOpen(r)}>{r.name} <span className="text-fg-muted">{r.roll_no}</span></button> },
          { key: 'c', header: t('common.class', 'Class'), cell: (r) => r.section_name ?? '—', hideOnMobile: true },
          { key: 's', header: t('ai.score', 'Risk'), cell: (r) => <Badge tone={LEVEL_TONE[r.level]}>{r.score}</Badge> },
          { key: 'f', header: t('ai.why', 'Why'), cell: (r) => <span className="text-xs">{r.factors.slice(0, 3).map((f) => `${f.label} (${f.value})`).join(' · ') || '—'}</span>, hideOnMobile: true },
          { key: 'i', header: t('ai.actions', 'Follow-up'), cell: (r) => (r.open_interventions ? <Badge tone="info">{r.open_interventions} open</Badge> : '—') },
        ]}
      />
      {open && <StudentRisk row={open} onClose={() => { setOpen(null); void q.refetch(); }} />}
    </>
  );
}

function StudentRisk({ row, onClose }: { row: RiskRow; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/ai/risk/students', row.student_id], queryFn: () => api.get<{ history: { computed_on: string; score: number }[]; interventions: { id: number; kind: string; note: string; status: string; owner: string | null; created_at: string; outcome: string }[] }>(`/ai/risk/students/${row.student_id}`) });
  const suggest = useMutation({ mutationFn: () => api.post<{ suggestion: string; kind: string }>(`/ai/risk/students/${row.student_id}/suggest`) });
  const [v, setV] = useState({ kind: 'meeting', note: '', due_on: '', alert_guardian: false });
  const add = useMutation({ mutationFn: () => api.post('/ai/interventions', { student_id: row.student_id, ...v }), onSuccess: () => { setV({ kind: 'meeting', note: '', due_on: '', alert_guardian: false }); void q.refetch(); } });
  const close = useMutation({ mutationFn: (id: number) => api.patch(`/ai/interventions/${id}`, { status: 'done' }), onSuccess: () => void q.refetch() });
  return (
    <Dialog open onClose={onClose} title={row.name} description={`${row.section_name ?? ''} · ${t('ai.score', 'Risk')} ${row.score}`} className="max-w-2xl">
      <div className="space-y-4 text-sm">
        <ul className="space-y-1">{row.factors.map((f) => <li key={f.key} className="flex justify-between"><span>{f.label}: <b>{f.value}</b></span><span className="text-fg-muted">+{f.points}</span></li>)}</ul>
        {q.data && q.data.history.length > 1 && <p className="text-fg-muted">{t('ai.trend', 'Trend')}: {q.data.history.slice(0, 8).reverse().map((h) => h.score).join(' → ')}</p>}
        <div className="space-y-2">
          <Button size="sm" variant="outline" loading={suggest.isPending} onClick={() => suggest.mutate()}><Sparkles className="size-4" /> {t('ai.suggestStep', 'Suggest a next step')}</Button>
          {suggest.data && <Alert><AiBadge /> {suggest.data.suggestion}</Alert>}
          <MutationError error={suggest.error} />
        </div>
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="font-semibold">{t('ai.interventions', 'Follow-up')}</h3>
          {q.data?.interventions.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-2">
              <span>{i.kind.replace('_', ' ')} · {i.note} <span className="text-fg-muted">{formatDate(i.created_at)} · {i.owner}</span></span>
              {i.status === 'open' ? <Button size="sm" variant="ghost" onClick={() => close.mutate(i.id)}>{t('ai.markDone', 'Done')}</Button> : <Badge tone="success">{i.status}</Badge>}
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <Select aria-label={t('ai.kind', 'Kind')} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{['meeting', 'call_guardian', 'tutoring', 'counselling', 'study_plan', 'fee_plan', 'other'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</Select>
            <Input aria-label={t('ai.note', 'Note')} value={v.note} placeholder={t('ai.notePlaceholder', 'What will happen')} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input aria-label={t('ai.due', 'Due')} type="date" value={v.due_on} onChange={(e) => setV({ ...v, due_on: e.target.value })} className="w-44" />
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={v.alert_guardian} onChange={(e) => setV({ ...v, alert_guardian: e.target.checked })} /> {t('ai.alertGuardian', 'Tell the guardian')}</label>
            <Button size="sm" loading={add.isPending} onClick={() => add.mutate()}>{t('common.add', 'Add')}</Button>
          </div>
          <MutationError error={add.error} />
        </section>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Ask Acadex

export function AskPage() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const m = useMutation({ mutationFn: (qq: string) => api.post<{ sql: string; explanation: string; columns: string[]; rows: Record<string, unknown>[]; truncated: boolean }>('/ai/ask', { question: qq }) });
  const examples = [t('ai.ex1', 'How many active students do we have?'), t('ai.ex2', 'How many students have overdue fees?'), t('ai.ex3', 'Average grade by course'), t('ai.ex4', 'Attendance by status this week')];
  const csv = () => {
    const d = m.data!;
    const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const blob = new Blob([[d.columns.map(esc).join(','), ...d.rows.map((r) => d.columns.map((c) => esc(r[c])).join(','))].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ask-acadex.csv';
    a.click();
  };
  return (
    <>
      <PageHeader title={t('nav.ask', 'Ask Acadex')} subtitle={t('ai.askSubtitle', 'Questions about your own data, in plain words — read-only, and you see the query')} />
      <Card className="space-y-3 p-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) m.mutate(question.trim()); }}>
          <Input aria-label={t('ai.question', 'Question')} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={examples[0]} />
          <Button type="submit" loading={m.isPending}>{t('ai.ask', 'Ask')}</Button>
        </form>
        <div className="flex flex-wrap gap-2">{examples.map((e) => <Button key={e} size="sm" variant="ghost" onClick={() => { setQuestion(e); m.mutate(e); }}>{e}</Button>)}</div>
      </Card>
      <MutationError error={m.error} />
      {m.data && (
        <Card className="mt-4 space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{m.data.explanation}</p><div className="flex items-center gap-2"><AiBadge /><Button size="sm" variant="outline" onClick={csv}>CSV</Button></div></div>
          <details><summary className="cursor-pointer text-xs text-fg-muted">{t('ai.showQuery', 'Show the query')}</summary><pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 text-xs">{m.data.sql}</pre></details>
          {m.data.rows.length === 0 ? <EmptyState title={t('ai.noRows', 'No rows')} /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>{m.data.columns.map((c) => <th key={c} className="border-b border-border px-2 py-1 text-start text-xs uppercase text-fg-muted">{c}</th>)}</tr></thead>
                <tbody>{m.data.rows.map((r, i) => <tr key={i}>{m.data!.columns.map((c) => <td key={c} className="border-b border-border px-2 py-1">{String(r[c] ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- help

export function HelpCenterPage() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const { user } = useAuth();
  const role = user?.role === 'institution_admin' || user?.role === 'super_admin' || user?.role === 'group_admin' ? 'admin' : user?.role;
  const articles = HELP_ARTICLES.filter((a) => !role || a.roles.includes(role as never));
  const article = HELP_ARTICLES.find((a) => a.slug === slug);
  return (
    <>
      <PageHeader title={t('nav.help', 'Help')} subtitle={t('ai.helpSubtitle', 'Short guides to the things you do every day')} />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card className="p-3">
          <ul className="space-y-1 text-sm">{articles.map((a) => <li key={a.slug}><Link to={`/help/${a.slug}`} className={`block rounded px-2 py-1.5 hover:bg-surface-2 ${a.slug === slug ? 'bg-primary-soft text-primary' : ''}`}>{a.title}</Link></li>)}</ul>
        </Card>
        <div className="space-y-4">
          <HelpAsk />
          {article ? (
            <Card className="space-y-2 p-5"><h2 className="text-lg font-semibold">{article.title}</h2>{article.body.split('\n\n').map((p, i) => <p key={i} className="text-sm leading-relaxed">{p}</p>)}</Card>
          ) : (
            <EmptyState title={t('ai.pickArticle', 'Pick a guide, or ask a question above')} />
          )}
        </div>
      </div>
    </>
  );
}

function HelpAsk() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const m = useMutation({ mutationFn: () => api.post<{ answer: string; citations: { n: number; title: string; locator: string }[] }>('/ai/help', { question: q }) });
  return (
    <Card className="space-y-2 p-4">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) m.mutate(); }}>
        <Input aria-label={t('ai.howDoI', 'How do I…')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ai.howDoI', 'How do I…')} />
        <Button type="submit" loading={m.isPending}><HelpCircle className="size-4" /> {t('ai.ask', 'Ask')}</Button>
      </form>
      <MutationError error={m.error} />
      {m.data && (
        <div className="space-y-1 text-sm">
          <AiBadge />
          <p className="whitespace-pre-wrap">{m.data.answer}</p>
          <div className="flex flex-wrap gap-1">{m.data.citations.map((c) => <Link key={c.n} to={c.locator} className="rounded bg-surface-2 px-2 py-0.5 text-xs text-primary"><BookOpen className="me-1 inline size-3" />[{c.n}] {c.title}</Link>)}</div>
        </div>
      )}
    </Card>
  );
}


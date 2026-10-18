// The platform owner's AI screens: API management (provider keys, the model of each AI feature,
// prices) and AI usage (calls and cost by institution, feature, model, day…, with filters).
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, Building2, Download, KeyRound, RefreshCw, Wallet } from 'lucide-react';
import { AI_USAGE_GROUPS, INSTITUTION_TYPES } from '@acadex/shared';
import { api } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { usePagedList } from '@/lib/queries';
import { Alert, Badge, Button, Card, DataTable, ErrorState, Field, Input, MutationError, PageHeader, Pager, Select, Spinner, StatCard, useToast } from '@/components/ui';

type Capability = 'chat' | 'embed' | 'speech';
interface ModelOption {
  id: string;
  provider: string;
  label: string;
  price: [number, number];
  known: boolean;
}
interface AiConfigResponse {
  features: { feature: string; label: string; capability: Capability; chosen: { provider: string; model: string } | null; active: { provider: string; model: string; from_choice: boolean; price: [number, number] } }[];
  keys: { provider: 'gemini' | 'groq'; source: 'saved' | 'environment' | 'none'; last4: string | null; updated_at: string | null }[];
  options: Record<Capability, ModelOption[]>;
  prices: Record<string, [number, number]>;
  live: Record<string, string | null>;
}

const PROVIDER_NAME: Record<string, string> = { gemini: 'Gemini', groq: 'Groq', fake: 'Test', openai: 'OpenAI', anthropic: 'Anthropic' };
const KIND: Record<Capability, string> = { chat: 'Text', embed: 'Search (embeddings)', speech: 'Speech to text' };
const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;
const priceText = (cap: Capability, p: [number, number]) => (cap === 'speech' ? `${usd(p[0], 3)} / hour` : `${usd(p[0], 2)} in · ${usd(p[1], 2)} out per 1M tokens`);

// ---------------------------------------------------------------- API management

export function ApiManagementPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['/platform/ai/config'], queryFn: () => api.get<AiConfigResponse>('/platform/ai/config') });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Spinner />;
  return (
    <>
      <PageHeader title={t('nav.apiManagement', 'API management')} subtitle={t('pai.subtitle', 'Choose the AI model for every feature. Only you can change these; every institution uses them.')} />
      <div className="space-y-4">
        <ProviderKeys data={q.data} />
        <FeatureModels data={q.data} />
        <Alert>{t('pai.safe', 'A model is tested before it is saved. If a chosen model later stops working, Acadex uses the provider’s default model so features keep running. Changing the search model re-indexes course material in the background.')}</Alert>
      </div>
    </>
  );
}

function ProviderKeys({ data }: { data: AiConfigResponse }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['/platform/ai/config'] });
  const save = useMutation({
    mutationFn: (v: { provider: string; key: string }) => api.put('/platform/ai/keys', v),
    onSuccess: (_r, v) => {
      setDraft({ ...draft, [v.provider]: '' });
      toast('success', v.key ? t('pai.keySaved', 'Key saved') : t('pai.keyRemoved', 'Key removed'));
      void refresh();
    },
  });
  const models = useMutation({ mutationFn: (provider: string) => api.post<{ count: number }>(`/platform/ai/models/${provider}/refresh`, {}), onSuccess: (r) => { toast('success', t('pai.modelsFetched', '{{n}} models found', { n: r.count })); void refresh(); } });
  return (
    <Card className="space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="size-4" aria-hidden /> {t('pai.keys', 'Provider keys')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {data.keys.map((k) => (
          <div key={k.provider} className="space-y-2 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{PROVIDER_NAME[k.provider]}</span>
              {k.source === 'saved' ? <Badge tone="success">{t('pai.saved', 'Saved')} ··{k.last4}</Badge> : k.source === 'environment' ? <Badge tone="info">{t('pai.env', 'From the server settings')}</Badge> : <Badge tone="warning">{t('pai.noKey', 'No key')}</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input aria-label={t('pai.keyFor', '{{p}} API key', { p: PROVIDER_NAME[k.provider] })} type="password" autoComplete="off" value={draft[k.provider] ?? ''} onChange={(e) => setDraft({ ...draft, [k.provider]: e.target.value })} placeholder={t('pai.paste', 'Paste a new key')} className="min-w-0 flex-1" />
              <Button size="sm" disabled={!draft[k.provider]} loading={save.isPending && save.variables?.provider === k.provider && !!save.variables.key} onClick={() => save.mutate({ provider: k.provider, key: draft[k.provider]! })}>{t('common.save', 'Save')}</Button>
              {k.source === 'saved' && <Button size="sm" variant="ghost" onClick={() => save.mutate({ provider: k.provider, key: '' })}>{t('common.remove', 'Remove')}</Button>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span>{data.live[k.provider] ? t('pai.listed', 'Model list updated {{when}}', { when: formatDateTime(data.live[k.provider]!) }) : t('pai.notListed', 'Model list not fetched yet')}</span>
              <Button size="sm" variant="outline" disabled={k.source === 'none'} loading={models.isPending && models.variables === k.provider} onClick={() => models.mutate(k.provider)}><RefreshCw className="size-3.5" aria-hidden /> {t('pai.fetch', 'Get latest models')}</Button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-muted">{t('pai.keysHelp', 'Keys are encrypted and never shown again. Without a saved key, the server’s environment key is used.')}</p>
      <MutationError error={save.error ?? models.error} />
    </Card>
  );
}

function FeatureModels({ data }: { data: AiConfigResponse }) {
  const { t } = useTranslation();
  return (
    <Card className="p-0">
      <div className="border-b border-border p-5">
        <h2 className="font-semibold">{t('pai.features', 'AI features and their models')}</h2>
        <p className="text-sm text-fg-muted">{t('pai.featuresHelp', 'Pick a model for each feature and save — Acadex tries it once before switching.')}</p>
      </div>
      <ul className="divide-y divide-border">
        {data.features.map((f) => <FeatureRow key={f.feature} row={f} options={data.options[f.capability]} />)}
      </ul>
    </Card>
  );
}

function FeatureRow({ row, options }: { row: AiConfigResponse['features'][number]; options: ModelOption[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const current = `${row.active.provider}:${row.active.model}`;
  const [pick, setPick] = useState(current);
  const [provider, model] = pick.split(/:(.*)/s) as [string, string];
  const byProvider = useMemo(() => {
    const m = new Map<string, ModelOption[]>();
    for (const o of options) m.set(o.provider, [...(m.get(o.provider) ?? []), o]);
    return [...m.entries()];
  }, [options]);
  const chosen = options.find((o) => `${o.provider}:${o.id}` === pick);
  const refresh = () => qc.invalidateQueries({ queryKey: ['/platform/ai/config'] });
  const save = useMutation({
    mutationFn: () => api.put<{ latency_ms: number; reindexing: boolean }>('/platform/ai/assignments', { feature: row.feature, provider, model }),
    onSuccess: (r) => {
      toast('success', r.reindexing ? t('pai.savedReindex', 'Saved — course material is being re-indexed') : t('pai.savedModel', 'Saved (test answered in {{ms}} ms)', { ms: r.latency_ms }));
      void refresh();
    },
  });
  const reset = useMutation({ mutationFn: () => api.delete(`/platform/ai/assignments/${row.feature}`), onSuccess: () => { toast('success', t('pai.reset', 'Back to the default model')); void refresh(); } });
  const hasCurrent = options.some((o) => `${o.provider}:${o.id}` === current);
  return (
    <li className="grid gap-3 p-5 lg:grid-cols-[1fr_minmax(0,22rem)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="font-medium">{row.label}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge>{KIND[row.capability]}</Badge>
          <span className="font-mono">{PROVIDER_NAME[row.active.provider] ?? row.active.provider} / {row.active.model}</span>
          {!row.active.from_choice && <Badge tone="info">{t('pai.default', 'Default')}</Badge>}
          {row.chosen && !row.active.from_choice && <Badge tone="warning">{t('pai.chosenUnavailable', 'Your choice needs its provider key')}</Badge>}
        </div>
      </div>
      <div className="space-y-1">
        <Select aria-label={t('pai.modelFor', 'Model for {{f}}', { f: row.label })} value={pick} onChange={(e) => setPick(e.target.value)}>
          {!hasCurrent && <option value={current}>{row.active.model}</option>}
          {byProvider.map(([p, list]) => (
            <optgroup key={p} label={PROVIDER_NAME[p] ?? p}>
              {list.map((o) => <option key={o.id} value={`${o.provider}:${o.id}`}>{o.known ? o.label : o.id}</option>)}
            </optgroup>
          ))}
        </Select>
        {chosen && <div className="text-xs text-fg-muted">{priceText(row.capability, chosen.price)}</div>}
        <MutationError error={save.error ?? reset.error} />
      </div>
      <div className="flex gap-2 lg:justify-end">
        <Button size="sm" disabled={pick === current && row.active.from_choice} loading={save.isPending} onClick={() => save.mutate()}>{t('pai.testSave', 'Test and save')}</Button>
        {row.chosen && <Button size="sm" variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>{t('pai.useDefault', 'Use default')}</Button>}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- AI usage

interface UsageRow {
  key: string;
  label: string;
  type: string | null;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  failed: number;
  avg_latency_ms: number;
}
interface UsageResponse {
  from: string;
  to: string;
  group: string;
  totals: Omit<UsageRow, 'key' | 'label' | 'type'> & { institutions: number };
  groups: UsageRow[];
  by_day: { day: string; calls: number; cost_usd: number; failed: number }[];
  filters: { institutions: { id: number; name: string; type: string }[]; features: { value: string; label: string }[]; models: { provider: string; model: string }[] };
}
interface CallRow {
  id: number;
  created_at: string;
  institution: string | null;
  feature: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status: string;
  error: string | null;
  user_name: string | null;
}

const GROUP_LABEL: Record<(typeof AI_USAGE_GROUPS)[number], string> = { institution: 'Institution', feature: 'Feature', provider: 'Provider', model: 'Model', day: 'Day', status: 'Status' };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const tokens = (n: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(n);

export function AiUsagePage() {
  const { t } = useTranslation();
  const [f, setF] = useState({ from: daysAgo(29), to: daysAgo(0), institution_id: '', institution_type: '', feature: '', provider: '', model: '', status: '', group: 'institution' });
  const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) as Record<string, string>;
  const q = useQuery({ queryKey: ['/platform/ai/usage', params], queryFn: () => api.get<UsageResponse>('/platform/ai/usage', params) });
  const calls = usePagedList<CallRow>('/platform/ai/usage/calls', params, 25);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const csv = useMutation({ mutationFn: () => api.download(`/platform/ai/usage.csv?${new URLSearchParams(params)}`, `ai-usage-${f.from}-to-${f.to}.csv`) });
  const featureLabel = (v: string) => q.data?.filters.features.find((x) => x.value === v)?.label ?? v;
  const d = q.data;
  return (
    <>
      <PageHeader
        title={t('nav.aiUsage', 'AI usage')}
        subtitle={t('pai.usageSubtitle', 'Which institution uses how much AI, on which feature and model, and what it costs (estimated).')}
        actions={<Button variant="outline" loading={csv.isPending} onClick={() => csv.mutate()}><Download className="size-4" aria-hidden /> {t('pai.csv', 'Export CSV')}</Button>}
      />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('common.from', 'From')}>{(a) => <Input {...a} type="date" value={f.from} max={f.to} onChange={set('from')} />}</Field>
        <Field label={t('common.to', 'To')}>{(a) => <Input {...a} type="date" value={f.to} min={f.from} onChange={set('to')} />}</Field>
        <Field label={t('pai.institution', 'Institution')}>
          {(a) => <Select {...a} value={f.institution_id} onChange={set('institution_id')}><option value="">{t('common.all', 'All')}</option>{d?.filters.institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select>}
        </Field>
        <Field label={t('pai.type', 'Kind of institution')}>
          {(a) => <Select {...a} value={f.institution_type} onChange={set('institution_type')}><option value="">{t('common.all', 'All')}</option>{INSTITUTION_TYPES.map((x) => <option key={x} value={x}>{t(`institutionType.${x}`, x.replace('_', ' '))}</option>)}</Select>}
        </Field>
        <Field label={t('ai.feature', 'Feature')}>
          {(a) => <Select {...a} value={f.feature} onChange={set('feature')}><option value="">{t('common.all', 'All')}</option>{d?.filters.features.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>}
        </Field>
        <Field label={t('pai.provider', 'Provider')}>
          {(a) => <Select {...a} value={f.provider} onChange={set('provider')}><option value="">{t('common.all', 'All')}</option>{[...new Set(d?.filters.models.map((m) => m.provider) ?? [])].map((p) => <option key={p} value={p}>{PROVIDER_NAME[p] ?? p}</option>)}</Select>}
        </Field>
        <Field label={t('ai.model', 'Model')}>
          {(a) => <Select {...a} value={f.model} onChange={set('model')}><option value="">{t('common.all', 'All')}</option>{d?.filters.models.filter((m) => !f.provider || m.provider === f.provider).map((m) => <option key={`${m.provider}:${m.model}`} value={m.model}>{m.model}</option>)}</Select>}
        </Field>
        <Field label={t('common.status', 'Status')}>
          {(a) => <Select {...a} value={f.status} onChange={set('status')}><option value="">{t('common.all', 'All')}</option>{['ok', 'error', 'blocked', 'quota'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>}
        </Field>
      </Card>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('pai.cost', 'Estimated cost')} value={usd(d.totals.cost_usd)} sub={`${formatDate(d.from)} – ${formatDate(d.to)}`} icon={Wallet} />
            <StatCard label={t('pai.calls', 'AI calls')} value={d.totals.calls.toLocaleString()} sub={t('pai.tokens', '{{in}} in · {{out}} out tokens', { in: tokens(d.totals.input_tokens), out: tokens(d.totals.output_tokens) })} icon={Activity} />
            <StatCard label={t('pai.institutions', 'Institutions using AI')} value={d.totals.institutions} icon={Building2} />
            <StatCard label={t('pai.failed', 'Failed calls')} value={d.totals.failed} sub={t('pai.latency', 'Average {{ms}} ms', { ms: d.totals.avg_latency_ms })} icon={AlertTriangle} tone={d.totals.failed ? 'warning' : 'success'} />
          </div>
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{t('pai.perDay', 'Cost per day')}</h2>
            {d.by_day.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d.by_day}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(v: string) => v.slice(5)} fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v: number) => `$${v}`} width={48} />
                  <Tooltip formatter={(v) => usd(Number(v), 4)} />
                  <Bar dataKey="cost_usd" name={t('pai.cost', 'Estimated cost')} fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-fg-muted">{t('pai.none', 'No AI use in this period')}</p>
            )}
          </Card>
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
              <h2 className="font-semibold">{t('pai.breakdown', 'Breakdown')}</h2>
              <Select aria-label={t('pai.groupBy', 'Group by')} value={f.group} onChange={set('group')} className="w-44">
                {AI_USAGE_GROUPS.map((g) => <option key={g} value={g}>{t('pai.by', 'By {{g}}', { g: GROUP_LABEL[g].toLowerCase() })}</option>)}
              </Select>
            </div>
            <DataTable
              rows={d.groups}
              rowKey={(r) => r.key}
              empty={t('pai.none', 'No AI use in this period')}
              columns={[
                { key: 'l', header: GROUP_LABEL[d.group as keyof typeof GROUP_LABEL], cell: (r) => <span>{d.group === 'feature' ? featureLabel(r.label) : d.group === 'provider' ? (PROVIDER_NAME[r.label] ?? r.label) : r.label}{r.type && <span className="ms-2 text-xs text-fg-muted">{t(`institutionType.${r.type}`, r.type.replace('_', ' '))}</span>}</span> },
                { key: 'c', header: t('pai.calls', 'AI calls'), cell: (r) => r.calls.toLocaleString() },
                { key: 't', header: t('pai.tokensCol', 'Tokens (in / out)'), cell: (r) => `${tokens(r.input_tokens)} / ${tokens(r.output_tokens)}`, hideOnMobile: true },
                { key: '$', header: t('pai.cost', 'Estimated cost'), cell: (r) => usd(r.cost_usd, r.cost_usd < 1 ? 4 : 2) },
                { key: 'f', header: t('pai.failed', 'Failed calls'), cell: (r) => (r.failed ? <Badge tone="warning">{r.failed}</Badge> : '0'), hideOnMobile: true },
                { key: 'ms', header: t('pai.avg', 'Avg time'), cell: (r) => `${r.avg_latency_ms} ms`, hideOnMobile: true },
              ]}
            />
          </Card>
          <Card className="p-0">
            <h2 className="border-b border-border p-4 font-semibold">{t('pai.recent', 'Each call')}</h2>
            <DataTable
              rows={calls.data?.rows}
              loading={calls.isPending}
              error={calls.error}
              rowKey={(r) => r.id}
              empty={t('pai.none', 'No AI use in this period')}
              columns={[
                { key: 'w', header: t('common.when', 'When'), cell: (r) => formatDateTime(r.created_at) },
                { key: 'i', header: t('pai.institution', 'Institution'), cell: (r) => r.institution ?? t('pai.platform', 'Platform') },
                { key: 'f', header: t('ai.feature', 'Feature'), cell: (r) => featureLabel(r.feature), hideOnMobile: true },
                { key: 'm', header: t('ai.model', 'Model'), cell: (r) => <span className="font-mono text-xs">{r.provider}/{r.model}</span>, hideOnMobile: true },
                { key: '$', header: t('pai.cost', 'Estimated cost'), cell: (r) => usd(r.cost_usd, 4) },
                { key: 's', header: t('common.status', 'Status'), cell: (r) => <Badge tone={r.status === 'ok' ? 'success' : 'warning'} title={r.error ?? undefined}>{r.status}</Badge> },
                { key: 'u', header: t('pai.user', 'By'), cell: (r) => r.user_name ?? '—', hideOnMobile: true },
              ]}
            />
            {calls.data && <div className="p-3"><Pager page={calls.page} pageSize={calls.pageSize} total={calls.data.total} onPage={calls.setPage} /></div>}
          </Card>
        </div>
      )}
    </>
  );
}

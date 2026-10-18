// The platform owner's AI screens. Mounted under /api/platform.
//   API management — provider keys, the model of every AI feature (tested before it is saved),
//                    model prices, the providers' current model lists.
//   AI usage       — calls, tokens and estimated cost by institution, feature, provider, model,
//                    day or status, with filters, a daily series, each call, and a CSV export.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { AI_FEATURE_CAPABILITY, AI_FEATURES, PLATFORM_AI_PROVIDERS, aiAssignmentBody, aiPriceBody, aiProviderKeyBody, aiUsageQuery, type AiFeature } from '@acadex/shared';
import { db, systemContext } from '../db/context';
import { audit } from '../lib/audit';
import { badRequest } from '../lib/errors';
import { toCsv } from '../lib/export';
import { parsePage, sendPage } from '../lib/pagination';
import { auth, currentUser, requirePermission } from '../middleware/auth';
import { enqueue } from '../jobs';
import { FEATURES } from '../ai/models';
import { aiConfig, assignmentFor, capabilityOf, keyStatus, modelOptions, priceOf, refreshModels, saveAiConfig, saveProviderKey, testModel } from '../ai/catalog';

const router = Router();
router.use('/ai', auth, systemContext);
const read = requirePermission('platform.institutions.read');
const manage = requirePermission('platform.institutions.manage');

const auditPlatform = (req: Request, action: string, detail: string) => audit({ institutionId: null, userId: currentUser(req).id, actor: currentUser(req).name, action, entity: 'AiConfig', detail });

// ---------------------------------------------------------------- API management

/** Every AI feature with its model, the provider keys, and the models to choose from. */
router.get('/ai/config', read, async (_req, res) => {
  const config = await aiConfig();
  const features = await Promise.all(
    AI_FEATURES.map(async (f) => {
      const now = await assignmentFor(f);
      return {
        feature: f,
        label: FEATURES[f],
        capability: AI_FEATURE_CAPABILITY[f],
        chosen: config.assignments[f] ?? null,
        // what runs right now (the choice, or the default when nothing is chosen or its key is missing)
        active: { provider: now.provider, model: now.model, from_choice: now.chosen, price: await priceOf(now.model) },
      };
    })
  );
  res.json({
    features,
    keys: await keyStatus(),
    options: { chat: await modelOptions('chat'), embed: await modelOptions('embed'), speech: await modelOptions('speech') },
    prices: config.prices,
    live: Object.fromEntries(PLATFORM_AI_PROVIDERS.map((p) => [p, config.live[p]?.fetched_at ?? null])),
  });
});

/** Try a model without saving it. */
router.post('/ai/test', manage, async (req, res) => {
  const b = aiAssignmentBody.parse(req.body);
  res.json({ ok: true, ...(await testModel(b.provider, b.model, AI_FEATURE_CAPABILITY[b.feature])) });
});

/** Choose a feature's model. It is tested first, so a model that doesn't work is never saved. */
router.put('/ai/assignments', manage, async (req, res) => {
  const b = aiAssignmentBody.parse(req.body);
  const cap = AI_FEATURE_CAPABILITY[b.feature];
  if (capabilityOf(b.model) !== cap) throw badRequest(`${b.model} can't be used for ${FEATURES[b.feature]}`, { model: 'wrong_kind' });
  const test = await testModel(b.provider, b.model, cap);
  const config = await aiConfig();
  const before = (await assignmentFor(b.feature)).model;
  await saveAiConfig({ ...config, assignments: { ...config.assignments, [b.feature]: { provider: b.provider, model: b.model } } });
  // course material must be re-embedded with a new search model
  if (b.feature === 'embeddings' && before !== b.model) await enqueue('kb.reindex_all', {}, { singletonKey: 'kb.reindex_all' });
  await auditPlatform(req, 'ai_model_changed', `${b.feature}: ${before} → ${b.provider}/${b.model}`);
  res.json({ ok: true, latency_ms: test.latency_ms, reindexing: b.feature === 'embeddings' && before !== b.model });
});

/** Back to the default model for a feature. */
router.delete('/ai/assignments/:feature', manage, async (req, res) => {
  const feature = z.enum(AI_FEATURES).parse(req.params.feature) as AiFeature;
  const config = await aiConfig();
  const before = (await assignmentFor(feature)).model;
  const { [feature]: _gone, ...rest } = config.assignments;
  await saveAiConfig({ ...config, assignments: rest });
  if (feature === 'embeddings' && before !== (await assignmentFor(feature)).model) await enqueue('kb.reindex_all', {}, { singletonKey: 'kb.reindex_all' });
  await auditPlatform(req, 'ai_model_reset', feature);
  res.status(204).end();
});

/** A provider's API key ('' removes it); never shown back. */
router.put('/ai/keys', manage, async (req, res) => {
  const b = aiProviderKeyBody.parse(req.body);
  await saveProviderKey(b.provider, b.key);
  await auditPlatform(req, b.key ? 'ai_key_set' : 'ai_key_removed', b.provider);
  res.json({ keys: await keyStatus() });
});

/** Fetch the provider's current list of models. */
router.post('/ai/models/:provider/refresh', manage, async (req, res) => {
  const provider = z.enum(PLATFORM_AI_PROVIDERS).parse(req.params.provider);
  const models = await refreshModels(provider);
  res.json({ provider, count: models.length });
});

/** Correct a model's price (USD per million tokens; speech: per hour of audio). */
router.put('/ai/prices', manage, async (req, res) => {
  const b = aiPriceBody.parse(req.body);
  const config = await aiConfig();
  await saveAiConfig({ ...config, prices: { ...config.prices, [b.model]: [b.input, b.output] } });
  await auditPlatform(req, 'ai_price_changed', `${b.model}: ${b.input} / ${b.output}`);
  res.json({ ok: true });
});

router.delete('/ai/prices/:model', manage, async (req, res) => {
  const model = z.string().max(120).parse(req.params.model);
  const config = await aiConfig();
  const { [model]: _gone, ...rest } = config.prices;
  await saveAiConfig({ ...config, prices: rest });
  res.status(204).end();
});

// ---------------------------------------------------------------- AI usage

type UsageFilters = z.infer<typeof aiUsageQuery>;

/** WHERE clause and parameters for the usage filters (dates default to the last 30 days). */
function usageWhere(q: UsageFilters) {
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const today = new Date().toISOString().slice(0, 10);
  const from = q.from ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = q.to ?? today;
  if (from > to) throw badRequest('From must be before to', { from: 'invalid' });
  const where = [`a.created_at >= ${add(from)}::date`, `a.created_at < ${add(to)}::date + 1`];
  if (q.institution_id) where.push(`a.institution_id = ${add(q.institution_id)}`);
  if (q.institution_type) where.push(`i.type = ${add(q.institution_type)}`);
  if (q.feature) where.push(`a.feature = ${add(q.feature)}`);
  if (q.provider) where.push(`a.provider = ${add(q.provider)}`);
  if (q.model) where.push(`a.model = ${add(q.model)}`);
  if (q.status) where.push(`a.status = ${add(q.status)}`);
  return { sql: where.join(' AND '), params, from, to };
}

const GROUP_SQL: Record<UsageFilters['group'], { key: string; label: string }> = {
  institution: { key: `COALESCE(a.institution_id::text, 'platform')`, label: `COALESCE(i.name, 'Platform (no institution)')` },
  feature: { key: 'a.feature', label: 'a.feature' },
  provider: { key: 'a.provider', label: 'a.provider' },
  model: { key: 'a.model', label: 'a.model' },
  day: { key: `a.created_at::date::text`, label: `a.created_at::date::text` },
  status: { key: 'a.status', label: 'a.status' },
};

const SUMS = `count(*)::int AS calls, COALESCE(sum(a.input_tokens), 0)::bigint::float8 AS input_tokens, COALESCE(sum(a.output_tokens), 0)::bigint::float8 AS output_tokens,
  COALESCE(sum(a.cost_usd), 0)::float8 AS cost_usd, count(*) FILTER (WHERE a.status <> 'ok')::int AS failed, COALESCE(round(avg(a.latency_ms)), 0)::int AS avg_latency_ms`;

/** Totals, one row per group, a daily series, and the values the filters can take. */
router.get('/ai/usage', read, async (req, res) => {
  const q = aiUsageQuery.parse(req.query);
  const w = usageWhere(q);
  const g = GROUP_SQL[q.group];
  const from = `FROM ai_usage a LEFT JOIN institutions i ON i.id = a.institution_id WHERE ${w.sql}`;
  const [totals, groups, days, institutions, models] = await Promise.all([
    db.query(`SELECT ${SUMS}, count(DISTINCT a.institution_id)::int AS institutions ${from}`, w.params),
    db.query(
      `SELECT ${g.key} AS key, ${g.label} AS label, ${q.group === 'institution' ? 'max(i.type)' : 'NULL'} AS type, ${SUMS} ${from}
        GROUP BY 1, 2 ORDER BY ${q.group === 'day' ? 'key' : 'cost_usd DESC, calls DESC'} LIMIT 500`,
      w.params
    ),
    db.query(`SELECT a.created_at::date::text AS day, count(*)::int AS calls, COALESCE(sum(a.cost_usd), 0)::float8 AS cost_usd, count(*) FILTER (WHERE a.status <> 'ok')::int AS failed ${from} GROUP BY 1 ORDER BY 1`, w.params),
    db.query(`SELECT id, name, type FROM institutions ORDER BY name`),
    db.query(`SELECT DISTINCT provider, model FROM ai_usage WHERE created_at > now() - interval '400 days' ORDER BY provider, model`),
  ]);
  res.json({
    from: w.from,
    to: w.to,
    group: q.group,
    totals: totals.rows[0],
    groups: groups.rows,
    by_day: days.rows,
    filters: { institutions: institutions.rows, features: AI_FEATURES.map((f) => ({ value: f, label: FEATURES[f] })), models: models.rows },
  });
});

const CALL_COLUMNS = `a.id, a.created_at, a.institution_id, i.name AS institution, i.type AS institution_type, a.feature, a.provider, a.model,
  a.input_tokens, a.output_tokens, a.cost_usd::float8 AS cost_usd, a.latency_ms, a.status, a.error, u.full_name AS user_name`;

/** Each call, newest first (paged). */
router.get('/ai/usage/calls', read, async (req, res) => {
  const q = aiUsageQuery.parse(req.query);
  const w = usageWhere(q);
  const pg = parsePage(req.query);
  const { rows } = await db.query(
    `SELECT ${CALL_COLUMNS}, count(*) OVER() AS _total
       FROM ai_usage a LEFT JOIN institutions i ON i.id = a.institution_id LEFT JOIN users u ON u.id = a.user_id
      WHERE ${w.sql} ORDER BY a.id DESC LIMIT $${w.params.length + 1} OFFSET $${w.params.length + 2}`,
    [...w.params, pg.limit, pg.offset]
  );
  sendPage(res, rows, pg);
});

/** The calls as CSV (up to 50,000 rows). */
router.get('/ai/usage.csv', read, async (req, res) => {
  const q = aiUsageQuery.parse(req.query);
  const w = usageWhere(q);
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${CALL_COLUMNS} FROM ai_usage a LEFT JOIN institutions i ON i.id = a.institution_id LEFT JOIN users u ON u.id = a.user_id
      WHERE ${w.sql} ORDER BY a.id DESC LIMIT 50000`,
    w.params
  );
  const header = ['Time', 'Institution', 'Type', 'Feature', 'Provider', 'Model', 'Input tokens', 'Output tokens', 'Cost (USD)', 'Latency (ms)', 'Status', 'Error', 'User'];
  const body = rows.map((r) => [
    new Date(r.created_at as string).toISOString(),
    (r.institution as string) ?? 'Platform',
    (r.institution_type as string) ?? '',
    r.feature as string,
    r.provider as string,
    r.model as string,
    r.input_tokens as number,
    r.output_tokens as number,
    r.cost_usd as number,
    r.latency_ms as number,
    r.status as string,
    (r.error as string) ?? '',
    (r.user_name as string) ?? '',
  ]);
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ai-usage-${w.from}-to-${w.to}.csv"` });
  res.send(toCsv(header, body));
});

export default router;

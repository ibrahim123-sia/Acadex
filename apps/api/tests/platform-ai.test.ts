// The platform owner's AI screens: only the platform chooses models; a model is tested before it
// is saved; a chosen model that stops working falls back to the provider's default; keys are
// sealed and never shown; changing the search model re-indexes course material; usage can be
// filtered, grouped, paged and exported.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { as, fixture } from './helpers/http';
import { clearJobs, pendingJobs } from '../src/jobs';
import { aiText } from '../src/ai/client';
import { resetAiConfigCache, saveAiConfig, aiConfig, estimateCost, defaultAssignment } from '../src/ai/catalog';
import { PROVIDERS, ProviderError } from '../src/ai/providers';
import { helpPrompt } from '../src/ai/prompts';
import { runAsSystem } from '../src/db/context';

let f: Awaited<ReturnType<typeof fixture.resetDb>>;
const q = async (sql: string, p: unknown[] = []) => (await fixture.pool.query(sql, p)).rows;

beforeAll(async () => {
  f = await fixture.resetDb();
  resetAiConfigCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetAiConfigCache();
});

describe('API management', () => {
  it('only the platform owner sees and changes the AI configuration', async () => {
    const sup = as(f.tokens.super);
    const res = await sup.get('/api/platform/ai/config');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.features).toHaveLength(9);
    expect(res.body.features.find((x: { feature: string }) => x.feature === 'captions').capability).toBe('speech');
    expect(res.body.keys.map((k: { provider: string }) => k.provider)).toEqual(['gemini', 'groq']);
    expect(res.body.options.chat.some((m: { id: string }) => m.id === 'gemini-2.5-flash')).toBe(true);
    expect(res.body.options.speech.some((m: { id: string }) => m.id === 'whisper-large-v3-turbo')).toBe(true);
    for (const who of ['adminA', 't1', 's1'] as const) {
      expect((await as(f.tokens[who]).get('/api/platform/ai/config')).status, who).toBe(403);
      expect((await as(f.tokens[who]).put('/api/platform/ai/assignments', { feature: 'tutor', provider: 'gemini', model: 'gemini-2.5-flash' })).status, who).toBe(403);
    }
  });

  it('tests a model before saving it, and refuses one of the wrong kind or without a key', async () => {
    const sup = as(f.tokens.super);
    const noKey = await sup.put('/api/platform/ai/assignments', { feature: 'tutor', provider: 'gemini', model: 'gemini-2.5-flash' });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error).toMatch(/Gemini API key/);
    expect((await sup.put('/api/platform/ai/assignments', { feature: 'embeddings', provider: 'groq', model: 'llama-3.3-70b-versatile' })).status).toBe(400);
    expect((await sup.put('/api/platform/ai/assignments', { feature: 'tutor', provider: 'gemini', model: 'bad model!' })).status).toBe(400);
    // with a key, the provider is called once to test the model
    await sup.put('/api/platform/ai/keys', { provider: 'gemini', key: 'test-gemini-key-1234' });
    const chat = vi.spyOn(PROVIDERS.gemini, 'chat').mockResolvedValue({ text: 'OK', inputTokens: 5, outputTokens: 1 });
    const ok = await sup.put('/api/platform/ai/assignments', { feature: 'tutor', provider: 'gemini', model: 'gemini-2.5-pro' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(chat).toHaveBeenCalledWith('test-gemini-key-1234', expect.objectContaining({ model: 'gemini-2.5-pro' }));
    const cfg = (await sup.get('/api/platform/ai/config')).body.features.find((x: { feature: string }) => x.feature === 'tutor');
    expect(cfg.active).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-pro', from_choice: true });
    // a model whose test fails is not saved
    chat.mockRejectedValueOnce(new ProviderError('generativelanguage.googleapis.com 404: model not found', 404));
    const bad = await sup.put('/api/platform/ai/assignments', { feature: 'copilot', provider: 'gemini', model: 'gemini-9-ultra' });
    expect(bad.status).toBe(400);
    expect((await aiConfig()).assignments.copilot).toBeUndefined();
    // the institution's page shows the platform's choice (read-only)
    const inst = await as(f.tokens.adminA).get('/api/ai/settings');
    expect(inst.body.features.find((x: { feature: string }) => x.feature === 'tutor')).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-pro' });
    expect((await sup.delete('/api/platform/ai/assignments/tutor')).status).toBe(204);
    expect((await aiConfig()).assignments.tutor).toBeUndefined();
  });

  it('keys are sealed and never shown back; removing one falls back to the environment', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.put('/api/platform/ai/keys', { provider: 'groq', key: 'test-groq-secret-9876' });
    expect(r.body.keys.find((k: { provider: string }) => k.provider === 'groq')).toMatchObject({ source: 'saved', last4: '9876' });
    const stored = await q(`SELECT value::text AS v FROM platform_settings WHERE key = 'ai_keys'`);
    expect(stored[0].v).not.toContain('test-groq-secret');
    expect(JSON.stringify((await sup.get('/api/platform/ai/config')).body)).not.toContain('test-groq-secret');
    const gone = await sup.put('/api/platform/ai/keys', { provider: 'groq', key: '' });
    expect(gone.body.keys.find((k: { provider: string }) => k.provider === 'groq').source).not.toBe('saved');
  });

  it('a chosen model that stops working falls back to the provider default, without failing', async () => {
    await runAsSystem(async () => {
      await saveAiConfig({ ...(await aiConfig()), assignments: { helpdesk: { provider: 'gemini', model: 'gemini-retired' } } });
    });
    const chat = vi.spyOn(PROVIDERS.gemini, 'chat').mockImplementation(async (_k, req) => {
      if (req.model === 'gemini-retired') throw new ProviderError('generativelanguage.googleapis.com 404: models/gemini-retired is not found', 404);
      return { text: 'Open Settings → AI.', inputTokens: 10, outputTokens: 5 };
    });
    const out = await runAsSystem(() => aiText({ institutionId: f.institutions.A.id, userId: null, feature: 'helpdesk' }, helpPrompt, [{ role: 'user', content: 'How do I turn AI off?' }]));
    expect(out.model).toBe(defaultAssignment('helpdesk', ['gemini'])!.model);
    expect(out.text).toMatch(/Settings/);
    expect(chat).toHaveBeenCalledTimes(2);
    const logged = await q(`SELECT model, status FROM ai_usage WHERE feature = 'helpdesk' ORDER BY id`);
    expect(logged.map((l) => `${l.model}:${l.status}`)).toEqual(['gemini-retired:error', 'gemini-2.5-flash-lite:ok']);
  });

  it('a new search model re-indexes course material', async () => {
    clearJobs();
    const sup = as(f.tokens.super);
    vi.spyOn(PROVIDERS.gemini, 'embed').mockResolvedValue({ vectors: [new Array(768).fill(0.1)], tokens: 3 });
    const r = await sup.put('/api/platform/ai/assignments', { feature: 'embeddings', provider: 'gemini', model: 'text-embedding-004' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.reindexing).toBe(true);
    expect(pendingJobs().map((j) => j.name)).toContain('kb.reindex_all');
  });

  it('prices can be corrected; speech is priced per hour of audio', async () => {
    const sup = as(f.tokens.super);
    expect((await sup.put('/api/platform/ai/prices', { model: 'gemini-2.5-flash', input: 1, output: 2 })).status).toBe(200);
    resetAiConfigCache();
    expect(await runAsSystem(() => estimateCost('gemini-2.5-flash', 1_000_000, 1_000_000))).toBe(3);
    expect(await runAsSystem(() => estimateCost('whisper-large-v3-turbo', 36_000, 0))).toBeCloseTo(0.04, 5); // one hour
    expect((await sup.delete('/api/platform/ai/prices/gemini-2.5-flash')).status).toBe(204);
  });
});

describe('AI usage', () => {
  beforeAll(async () => {
    await q(`DELETE FROM ai_usage`);
    const A = f.institutions.A.id;
    const B = f.institutions.B.id;
    await q(`UPDATE institutions SET type = 'university' WHERE id = $1`, [B]);
    const rows: [number | null, string, string, string, number, string, string][] = [
      [A, 'tutor', 'gemini', 'gemini-2.5-flash', 0.5, 'ok', '2026-10-01'],
      [A, 'tutor', 'gemini', 'gemini-2.5-flash', 0.25, 'ok', '2026-10-02'],
      [A, 'grading', 'groq', 'llama-3.3-70b-versatile', 1, 'error', '2026-10-02'],
      [B, 'tutor', 'groq', 'llama-3.3-70b-versatile', 2, 'ok', '2026-10-03'],
      [null, 'helpdesk', 'gemini', 'gemini-2.5-flash-lite', 0.01, 'ok', '2026-10-03'],
    ];
    for (const [inst, feature, provider, model, cost, status, day] of rows)
      await q(`INSERT INTO ai_usage (institution_id, feature, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, status, created_at) VALUES ($1,$2,$3,$4,100,50,$5,800,$6,$7::date + time '10:00')`, [inst, feature, provider, model, cost, status, day]);
  });

  it('groups by institution with totals, filters and a daily series', async () => {
    const sup = as(f.tokens.super);
    const r = await sup.get('/api/platform/ai/usage?from=2026-10-01&to=2026-10-03&group=institution');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totals).toMatchObject({ calls: 5, failed: 1, institutions: 2 });
    expect(r.body.totals.cost_usd).toBeCloseTo(3.76, 5);
    expect(r.body.groups[0]).toMatchObject({ label: f.institutions.B.name, type: 'university', calls: 1 });
    expect(r.body.groups.find((g: { key: string }) => g.key === 'platform').label).toMatch(/Platform/);
    expect(r.body.by_day.map((d: { day: string }) => d.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(r.body.filters.features).toHaveLength(9);

    const tutor = await sup.get(`/api/platform/ai/usage?from=2026-10-01&to=2026-10-03&group=model&feature=tutor&institution_id=${f.institutions.A.id}`);
    expect(tutor.body.groups).toEqual([expect.objectContaining({ key: 'gemini-2.5-flash', calls: 2 })]);
    const uni = await sup.get('/api/platform/ai/usage?from=2026-10-01&to=2026-10-03&group=provider&institution_type=university');
    expect(uni.body.totals.calls).toBe(1);
    const failed = await sup.get('/api/platform/ai/usage?from=2026-10-01&to=2026-10-03&group=status&status=error');
    expect(failed.body.groups).toEqual([expect.objectContaining({ key: 'error', calls: 1 })]);
    expect((await sup.get('/api/platform/ai/usage?from=2026-10-05&to=2026-10-01')).status).toBe(400);
    expect((await as(f.tokens.adminA).get('/api/platform/ai/usage')).status).toBe(403);
  });

  it('lists each call (paged) and exports CSV', async () => {
    const sup = as(f.tokens.super);
    const calls = await sup.get('/api/platform/ai/usage/calls?from=2026-10-01&to=2026-10-03&pageSize=2&page=1');
    expect(calls.body).toHaveLength(2);
    expect(Number(calls.headers['x-total-count'])).toBe(5);
    const csv = await sup.get('/api/platform/ai/usage.csv?from=2026-10-01&to=2026-10-03&feature=tutor');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Time,Institution,Type,Feature,Provider,Model/);
    expect(csv.text.trim().split('\r\n')).toHaveLength(4); // header + 3 tutor calls
  });
});

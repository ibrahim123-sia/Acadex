// The one way features call a model: checks the kill switches (platform, institution, feature,
// course), the monthly budget, picks the provider, model and key (the institution's own key
// first), sends the prompt, parses structured replies with Zod (one repair retry), and logs
// tokens and cost for every call — successful or not.
import type { z } from 'zod';
import { aiSettingsBody, type AiSettings } from '@acadex/shared';
import { decryptSecret } from '../auth/crypto';
import { getConfig } from '../config';
import { db, inContext, runAsSystem } from '../db/context';
import { HttpError } from '../lib/errors';
import { logger } from '../lib/logger';
import { costUsd, defaultModel, DEFAULT_MODELS, type Feature, effortFor } from './models';
import { PROVIDERS, ProviderError, type ChatMessage, type ProviderName } from './providers';
import type { PromptDef } from './prompts';

export interface AiCtx {
  institutionId: number | null;
  userId: number | null;
  feature: Feature;
  offeringId?: number | null;
}

export class AiUnavailable extends HttpError {
  constructor(message: string, code: string) {
    super(code === 'AI_QUOTA' ? 429 : code === 'AI_ERROR' ? 502 : code === 'AI_DECLINED' ? 422 : 403, message, undefined, code);
  }
}

/** Read through the request's context when there is one, else a system transaction. */
const query = <R extends Record<string, unknown>>(sql: string, params: unknown[]) =>
  inContext() ? db.query<R>(sql, params) : runAsSystem(() => db.query<R>(sql, params));

export async function aiSettings(institutionId: number | null): Promise<AiSettings & { plan: string }> {
  if (!institutionId) return { ...aiSettingsBody.parse({}), plan: 'enterprise' };
  const { rows } = await query<{ ai: unknown; plan: string }>(`SELECT settings->'ai' AS ai, plan FROM institutions WHERE id = $1`, [institutionId]);
  return { ...aiSettingsBody.parse(rows[0]?.ai ?? {}), plan: rows[0]?.plan ?? 'free' };
}

/** Is this feature on here? (and why not, when it isn't) */
export async function aiStatus(ctx: AiCtx): Promise<{ enabled: boolean; reason?: string }> {
  if (getConfig().ai.disabled) return { enabled: false, reason: 'AI is switched off on this server' };
  const s = await aiSettings(ctx.institutionId);
  if (!s.enabled) return { enabled: false, reason: 'AI is switched off for your institution' };
  if (s.features[ctx.feature] === false) return { enabled: false, reason: 'This AI feature is switched off for your institution' };
  if (ctx.offeringId) {
    const { rows } = await query<{ ai_enabled: boolean }>(`SELECT ai_enabled FROM course_offerings WHERE id = $1`, [ctx.offeringId]);
    if (rows[0] && !rows[0].ai_enabled) return { enabled: false, reason: 'AI is switched off in this course' };
  }
  return { enabled: true };
}

interface Resolved {
  provider: ProviderName;
  key: string | undefined;
  byo: boolean;
  model: string;
}

async function resolve(ctx: AiCtx, kind: 'chat' | 'embed' | 'speech'): Promise<Resolved> {
  const cfg = getConfig().ai;
  const s = await aiSettings(ctx.institutionId);
  const own = ctx.institutionId
    ? (await query<{ provider: ProviderName; key_sealed: string }>(`SELECT provider, key_sealed FROM ai_provider_keys WHERE institution_id = $1`, [ctx.institutionId])).rows
    : [];
  const ownKey = (p: ProviderName) => {
    const r = own.find((o) => o.provider === p);
    return r ? decryptSecret(r.key_sealed) : undefined;
  };
  const platformKey = (p: ProviderName) => (p === 'fake' ? undefined : cfg.keys[p]);
  // chat: the institution's chosen provider (its own key), else the platform's
  let provider: ProviderName = s.provider && ownKey(s.provider) ? s.provider : cfg.provider;
  const capable = (p: ProviderName) => (kind === 'embed' ? !!DEFAULT_MODELS[p].embed : kind === 'speech' ? !!DEFAULT_MODELS[p].speech : true);
  if (!capable(provider)) {
    // embeddings / speech need OpenAI or Gemini (or the fake one)
    provider = (['openai', 'gemini'] as ProviderName[]).find((p) => capable(p) && (ownKey(p) || platformKey(p))) ?? 'fake';
  }
  const key = ownKey(provider) ?? platformKey(provider);
  if (provider !== 'fake' && !key) provider = 'fake';
  const model =
    kind === 'embed' ? DEFAULT_MODELS[provider].embed! : kind === 'speech' ? DEFAULT_MODELS[provider].speech! : (s.provider === provider && s.models[ctx.feature]) || defaultModel(provider, ctx.feature);
  return { provider, key: provider === 'fake' ? undefined : key, byo: !!ownKey(provider), model };
}

/** Spend this calendar month on the platform's keys, and the cap that applies. */
export async function budget(institutionId: number | null) {
  if (!institutionId) return { spent: 0, cap: Infinity };
  const s = await aiSettings(institutionId);
  const { rows } = await query<{ spent: string }>(
    `SELECT COALESCE(sum(cost_usd), 0) AS spent FROM ai_usage WHERE institution_id = $1 AND NOT byo_key AND created_at >= date_trunc('month', now())`,
    [institutionId]
  );
  const limits = (await query<{ ai: number | null }>(`SELECT (limits->>'ai_usd')::float AS ai FROM plans WHERE key = $1`, [s.plan])).rows[0];
  const plan = limits ? (limits.ai ?? Infinity) : (getConfig().ai.budgets[s.plan] ?? getConfig().ai.budgets.free!);
  return { spent: Number(rows[0]?.spent ?? 0), cap: s.monthly_budget_usd != null ? Math.min(plan, s.monthly_budget_usd) : plan };
}

async function logUsage(ctx: AiCtx, r: Resolved, input: number, output: number, ms: number, status: string, error: string | null = null) {
  const cost = costUsd(r.model, input, output);
  try {
    await runAsSystem(() =>
      db.query(
        `INSERT INTO ai_usage (institution_id, user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, latency_ms, status, error, byo_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [ctx.institutionId, ctx.userId, ctx.feature, r.provider, r.model, input, output, cost, Math.round(ms), status, error, r.byo]
      )
    );
  } catch (err) {
    logger.error({ err }, 'ai usage could not be logged');
  }
}

async function prepare(ctx: AiCtx, kind: 'chat' | 'embed' | 'speech' = 'chat') {
  const st = await aiStatus(ctx);
  if (!st.enabled) throw new AiUnavailable(st.reason!, 'AI_OFF');
  const r = await resolve(ctx, kind);
  if (!r.byo) {
    const b = await budget(ctx.institutionId);
    if (b.spent >= b.cap) {
      await logUsage(ctx, r, 0, 0, 0, 'quota');
      throw new AiUnavailable('Your institution has used its AI budget for this month', 'AI_QUOTA');
    }
  }
  return r;
}

async function call<T>(ctx: AiCtx, r: Resolved, fn: () => Promise<{ inputTokens: number; outputTokens: number } & T>) {
  const t0 = performance.now();
  try {
    const out = await fn();
    await logUsage(ctx, r, out.inputTokens, out.outputTokens, performance.now() - t0, 'ok');
    return out;
  } catch (e) {
    await logUsage(ctx, r, 0, 0, performance.now() - t0, 'error', (e as Error).message.slice(0, 500));
    if (e instanceof ProviderError && e.refused) throw new AiUnavailable('The AI declined to help with this request. Try rephrasing it, or ask your teacher.', 'AI_DECLINED');
    if (e instanceof ProviderError) {
      logger.warn({ err: e.message, provider: r.provider }, 'ai provider error');
      throw new AiUnavailable('The AI service is not available right now. Please try again later.', 'AI_ERROR');
    }
    throw e;
  }
}

export interface TextResult {
  text: string;
  provider: ProviderName;
  model: string;
}

/** Free text (or a stream of it when onDelta is given). */
export async function aiText(ctx: AiCtx, prompt: PromptDef, messages: ChatMessage[], opts: { onDelta?: (t: string) => void; maxTokens?: number } = {}): Promise<TextResult> {
  const r = await prepare(ctx);
  const p = PROVIDERS[r.provider];
  const req = { model: r.model, messages: [{ role: 'system' as const, content: prompt.system }, ...messages], maxTokens: opts.maxTokens, effort: effortFor(ctx.feature) };
  const out = await call(ctx, r, () => (opts.onDelta && p.stream ? p.stream(r.key, req, opts.onDelta) : p.chat(r.key, req)));
  return { text: out.text, provider: r.provider, model: r.model };
}

/** Pull the first JSON object out of a reply (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const src = fenced ?? text;
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(src.slice(start, end + 1));
}

/** A structured reply, validated with the prompt's schema; one repair attempt. */
export async function aiJson<S extends z.ZodType>(ctx: AiCtx, prompt: PromptDef<S>, userContent: string, opts: { maxTokens?: number } = {}): Promise<{ data: z.infer<S>; provider: ProviderName; model: string }> {
  const r = await prepare(ctx);
  const p = PROVIDERS[r.provider];
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: userContent },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await call(ctx, r, () => p.chat(r.key, { model: r.model, messages, json: true, maxTokens: opts.maxTokens ?? 3000, effort: effortFor(ctx.feature) }));
    try {
      return { data: prompt.schema!.parse(extractJson(out.text)), provider: r.provider, model: r.model };
    } catch (e) {
      messages.push({ role: 'assistant', content: out.text }, { role: 'user', content: `That reply was not valid (${(e as Error).message.slice(0, 200)}). Reply again with only the JSON object in the required shape.` });
    }
  }
  throw new AiUnavailable('The AI reply could not be understood. Please try again.', 'AI_ERROR');
}

/** Embeddings for indexing and search (always EMBED_DIMS long). */
export async function aiEmbed(ctx: Omit<AiCtx, 'feature'>, texts: string[]): Promise<{ vectors: number[][]; model: string }> {
  if (!texts.length) return { vectors: [], model: '' };
  const c = { ...ctx, feature: 'embeddings' as const };
  const r = await prepare(c, 'embed');
  const p = PROVIDERS[r.provider];
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const out = await call(c, r, async () => {
      const e = await p.embed!(r.key, r.model, batch);
      return { ...e, inputTokens: e.tokens, outputTokens: 0 };
    });
    vectors.push(...out.vectors);
  }
  return { vectors, model: r.model };
}

/** Speech to text for captions. */
export async function aiTranscribe(ctx: Omit<AiCtx, 'feature'>, audio: Buffer, filename: string, language?: string) {
  const c = { ...ctx, feature: 'captions' as const };
  const r = await prepare(c, 'speech');
  const p = PROVIDERS[r.provider];
  return call(c, r, async () => {
    const t = await p.transcribe!(r.key, audio, filename, language);
    // billed per minute; logged as tokens ≈ seconds × 10 for the usage report
    return { ...t, inputTokens: Math.round(t.seconds * 10), outputTokens: 0 };
  });
}

/** What admins see on the transparency page: which provider and model each feature uses. */
export async function aiOverview(institutionId: number) {
  const s = await aiSettings(institutionId);
  const features = ['tutor', 'copilot', 'grading', 'evidence', 'ask', 'helpdesk', 'risk', 'captions', 'embeddings'] as Feature[];
  const out: { feature: Feature; enabled: boolean; provider: ProviderName; model: string; own_key: boolean }[] = [];
  for (const f of features) {
    const kind = f === 'embeddings' ? 'embed' : f === 'captions' ? 'speech' : 'chat';
    const r = await resolve({ institutionId, userId: null, feature: f }, kind);
    out.push({ feature: f, enabled: s.enabled && s.features[f] !== false && !getConfig().ai.disabled, provider: r.provider, model: r.model, own_key: r.byo });
  }
  return out;
}

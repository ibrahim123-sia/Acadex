// The platform owner's AI configuration (API management): which provider and model each feature
// uses, the providers' keys (sealed), model prices, and the models each provider offers. Only
// the platform owner changes it; every AI call reads it, so a change applies at once. A model is
// saved only after a test call succeeds, and a call whose model stops working falls back to the
// provider's default model (client.ts), so a change can't take the AI features down.
import { AI_FEATURE_CAPABILITY, PLATFORM_AI_PROVIDERS, type AiCapability, type AiFeature, type PlatformAiProvider } from '@acadex/shared';
import { getConfig } from '../config';
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { db, inContext, runAsSystem } from '../db/context';
import { badRequest } from '../lib/errors';
import { EMBED_DIMS, PROVIDERS, type ProviderName } from './providers';

export interface CatalogModel {
  id: string;
  provider: ProviderName;
  capability: AiCapability;
  label: string;
  /** USD per million tokens [input, output]; speech: [per hour of audio, 0]. Estimates, editable. */
  price: [number, number];
}

const M = (provider: ProviderName, id: string, capability: AiCapability, label: string, price: [number, number]): CatalogModel => ({ id, provider, capability, label, price });

/** Known models with list prices (Oct 2026 estimates; the platform owner can correct them). */
export const CATALOG: CatalogModel[] = [
  M('gemini', 'gemini-2.5-flash-lite', 'chat', 'Gemini 2.5 Flash-Lite — cheapest, quick help', [0.1, 0.4]),
  M('gemini', 'gemini-2.5-flash', 'chat', 'Gemini 2.5 Flash — good balance of quality and cost', [0.3, 2.5]),
  M('gemini', 'gemini-2.5-pro', 'chat', 'Gemini 2.5 Pro — strongest reasoning, highest cost', [1.25, 10]),
  M('gemini', 'gemini-embedding-001', 'embed', 'Gemini Embedding — course material search', [0.15, 0]),
  M('gemini', 'text-embedding-004', 'embed', 'Text Embedding 004 — older search model', [0, 0]),
  M('groq', 'llama-3.1-8b-instant', 'chat', 'Llama 3.1 8B Instant — very fast and cheap', [0.05, 0.08]),
  M('groq', 'llama-3.3-70b-versatile', 'chat', 'Llama 3.3 70B — solid general model', [0.59, 0.79]),
  M('groq', 'openai/gpt-oss-20b', 'chat', 'GPT-OSS 20B — reasoning, low cost', [0.1, 0.5]),
  M('groq', 'openai/gpt-oss-120b', 'chat', 'GPT-OSS 120B — strongest reasoning on Groq', [0.15, 0.75]),
  M('groq', 'qwen/qwen3-32b', 'chat', 'Qwen3 32B — reasoning', [0.29, 0.59]),
  M('groq', 'whisper-large-v3-turbo', 'speech', 'Whisper Large v3 Turbo — captions, fast', [0.04, 0]),
  M('groq', 'whisper-large-v3', 'speech', 'Whisper Large v3 — captions, most accurate', [0.111, 0]),
  // development and tests only
  M('fake', 'fake-fast', 'chat', 'Test model', [0, 0]),
  M('fake', 'fake-strong', 'chat', 'Test model (strong)', [0, 0]),
  M('fake', 'fake-embed', 'embed', 'Test embeddings', [0, 0]),
  M('fake', 'fake-speech', 'speech', 'Test speech to text', [0, 0]),
];

/** A model id's capability: from the catalog, else guessed from its name (live lists). */
export function capabilityOf(model: string): AiCapability {
  const known = CATALOG.find((m) => m.id === model);
  if (known) return known.capability;
  if (/embed/i.test(model)) return 'embed';
  if (/whisper|transcri|speech|tts|audio/i.test(model)) return 'speech';
  return 'chat';
}

// ---------------------------------------------------------------- stored configuration

export interface AiAssignment {
  provider: ProviderName;
  model: string;
}
export interface AiConfig {
  assignments: Partial<Record<AiFeature, AiAssignment>>;
  /** price overrides per model id */
  prices: Record<string, [number, number]>;
  /** the providers' own model lists, as last fetched */
  live: Partial<Record<PlatformAiProvider, { models: string[]; fetched_at: string }>>;
}
interface StoredKey {
  sealed: string;
  last4: string;
  updated_at: string;
}

const query = <R extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (inContext() ? db.query<R>(sql, params) : runAsSystem(() => db.query<R>(sql, params)));

let cache: { config: AiConfig; keys: Partial<Record<PlatformAiProvider, StoredKey>>; at: number } | undefined;
const TTL_MS = 10_000;

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const { rows } = await query<{ key: string; value: unknown }>(`SELECT key, value FROM platform_settings WHERE key IN ('ai_config', 'ai_keys')`);
  const config = (rows.find((r) => r.key === 'ai_config')?.value as AiConfig | undefined) ?? { assignments: {}, prices: {}, live: {} };
  const keys = (rows.find((r) => r.key === 'ai_keys')?.value as Partial<Record<PlatformAiProvider, StoredKey>> | undefined) ?? {};
  cache = { config: { assignments: config.assignments ?? {}, prices: config.prices ?? {}, live: config.live ?? {} }, keys, at: Date.now() };
  return cache;
}

/** Forget the cached copy (after a change, and in tests). */
export const resetAiConfigCache = () => {
  cache = undefined;
};

export async function aiConfig(): Promise<AiConfig> {
  return (await load()).config;
}

export async function saveAiConfig(next: AiConfig): Promise<void> {
  await query(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('ai_config', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(next)]);
  resetAiConfigCache();
}

// ---------------------------------------------------------------- keys

/** The key used for a provider: the one saved in API management, else the server's environment. */
export async function providerKey(provider: ProviderName): Promise<string | undefined> {
  if (provider === 'fake') return undefined;
  const stored = (PLATFORM_AI_PROVIDERS as readonly string[]).includes(provider) ? (await load()).keys[provider as PlatformAiProvider] : undefined;
  if (stored) return decryptSecret(stored.sealed);
  return getConfig().ai.keys[provider as Exclude<ProviderName, 'fake'>] || undefined;
}

/** Key status per provider for the screen (never the key itself). */
export async function keyStatus() {
  const { keys } = await load();
  const env = getConfig().ai.keys;
  return PLATFORM_AI_PROVIDERS.map((p) => ({ provider: p, source: keys[p] ? ('saved' as const) : env[p] ? ('environment' as const) : ('none' as const), last4: keys[p]?.last4 ?? null, updated_at: keys[p]?.updated_at ?? null }));
}

export async function saveProviderKey(provider: PlatformAiProvider, key: string): Promise<void> {
  const { keys } = await load();
  const next = { ...keys };
  if (key) next[provider] = { sealed: encryptSecret(key), last4: key.slice(-4), updated_at: new Date().toISOString() };
  else delete next[provider];
  await query(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('ai_keys', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(next)]);
  resetAiConfigCache();
}

// ---------------------------------------------------------------- defaults and resolution

/** The providers that have a key (and the test provider outside production). */
export async function availableProviders(): Promise<ProviderName[]> {
  const out: ProviderName[] = [];
  for (const p of PLATFORM_AI_PROVIDERS) if (await providerKey(p)) out.push(p);
  // a provider set only in the environment from before (OpenAI / Anthropic) keeps working
  const legacy = getConfig().ai.provider;
  if (legacy !== 'fake' && !out.includes(legacy) && (await providerKey(legacy))) out.push(legacy);
  return out;
}

/** What a feature uses when the platform owner hasn't chosen: sensible, low-cost models. */
export function defaultAssignment(feature: AiFeature, available: ProviderName[]): AiAssignment | null {
  const cap = AI_FEATURE_CAPABILITY[feature];
  const light = feature === 'helpdesk' || feature === 'risk';
  for (const p of available) {
    if (p === 'gemini') {
      if (cap === 'chat') return { provider: p, model: light ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash' };
      if (cap === 'embed') return { provider: p, model: 'gemini-embedding-001' };
    }
    if (p === 'groq') {
      if (cap === 'chat') return { provider: p, model: light ? 'llama-3.1-8b-instant' : 'llama-3.3-70b-versatile' };
      if (cap === 'speech') return { provider: p, model: 'whisper-large-v3-turbo' };
    }
    if (p === 'openai') {
      if (cap === 'chat') return { provider: p, model: light ? 'gpt-4.1-mini' : 'gpt-4.1' };
      if (cap === 'embed') return { provider: p, model: 'text-embedding-3-small' };
      if (cap === 'speech') return { provider: p, model: 'whisper-1' };
    }
    if (p === 'anthropic' && cap === 'chat') return { provider: p, model: light ? 'claude-haiku-5-5' : 'claude-sonnet-5-5' };
  }
  return null;
}

const FAKE: Record<AiCapability, string> = { chat: 'fake-fast', embed: 'fake-embed', speech: 'fake-speech' };

/**
 * The provider, key and model a feature uses now: the platform owner's choice when its
 * provider has a key, else a default from the providers that have one, else the built-in test
 * provider (answers locally, costs nothing).
 */
export async function assignmentFor(feature: AiFeature): Promise<AiAssignment & { key: string | undefined; chosen: boolean }> {
  const cap = AI_FEATURE_CAPABILITY[feature];
  const chosen = (await aiConfig()).assignments[feature];
  if (chosen && chosen.provider !== 'fake' && capabilityOf(chosen.model) === cap) {
    const key = await providerKey(chosen.provider);
    if (key && PROVIDERS[chosen.provider]) return { ...chosen, key, chosen: true };
  }
  if (chosen?.provider === 'fake' && getConfig().env !== 'production') return { ...chosen, key: undefined, chosen: true };
  const d = defaultAssignment(feature, await availableProviders());
  if (d) return { ...d, key: await providerKey(d.provider), chosen: false };
  return { provider: 'fake', model: FAKE[cap], key: undefined, chosen: false };
}

/** The default model on the same provider, for when a chosen model fails (removed, renamed). */
export function fallbackModel(feature: AiFeature, provider: ProviderName): string | null {
  return defaultAssignment(feature, [provider])?.model ?? null;
}

// ---------------------------------------------------------------- prices

export async function priceOf(model: string): Promise<[number, number]> {
  const override = (await aiConfig()).prices[model];
  return override ?? CATALOG.find((m) => m.id === model)?.price ?? [0, 0];
}

/** Estimated cost of a call (speech: input carries seconds × 10). */
export async function estimateCost(model: string, input: number, output: number): Promise<number> {
  const [i, o] = await priceOf(model);
  const usd = capabilityOf(model) === 'speech' ? (input / 10 / 3600) * i : (input * i + output * o) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------- models offered and tests

/** The models to choose from for a capability: the catalog plus the providers' live lists. */
export async function modelOptions(cap: AiCapability) {
  const { live } = await aiConfig();
  const prod = getConfig().env === 'production';
  const out = new Map<string, { id: string; provider: ProviderName; label: string; price: [number, number]; known: boolean }>();
  for (const m of CATALOG) if (m.capability === cap && (m.provider !== 'fake' || !prod)) out.set(`${m.provider}:${m.id}`, { id: m.id, provider: m.provider, label: m.label, price: await priceOf(m.id), known: true });
  for (const p of PLATFORM_AI_PROVIDERS)
    for (const id of live[p]?.models ?? []) if (capabilityOf(id) === cap && !out.has(`${p}:${id}`)) out.set(`${p}:${id}`, { id, provider: p, label: id, price: await priceOf(id), known: false });
  return [...out.values()];
}

/** Fetch a provider's current model list and keep it. */
export async function refreshModels(provider: PlatformAiProvider): Promise<string[]> {
  const key = await providerKey(provider);
  if (!key) throw badRequest(`Add the ${provider === 'gemini' ? 'Gemini' : 'Groq'} API key first`);
  const models = await PROVIDERS[provider].listModels!(key);
  const config = await aiConfig();
  await saveAiConfig({ ...config, live: { ...config.live, [provider]: { models, fetched_at: new Date().toISOString() } } });
  return models;
}

/** One second of silence as a WAV file (tests speech-to-text models). */
function silentWav(): Buffer {
  const rate = 16000;
  const data = Buffer.alloc(rate * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Call the model once with a tiny request; throws with the provider's reason when it can't be used. */
export async function testModel(provider: ProviderName, model: string, cap: AiCapability): Promise<{ latency_ms: number }> {
  const p = PROVIDERS[provider];
  if (!p) throw badRequest('Unknown provider');
  if (provider === 'fake' && getConfig().env === 'production') throw badRequest('The test provider is not available in production');
  const key = await providerKey(provider);
  if (provider !== 'fake' && !key) throw badRequest(`Add the ${provider === 'gemini' ? 'Gemini' : provider === 'groq' ? 'Groq' : provider} API key first`);
  if (capabilityOf(model) !== cap) throw badRequest(`${model} is not a ${cap === 'chat' ? 'text' : cap === 'embed' ? 'search (embedding)' : 'speech-to-text'} model`);
  const t0 = performance.now();
  try {
    if (cap === 'chat') {
      await p.chat(key, { model, messages: [{ role: 'system', content: 'Reply with one word.' }, { role: 'user', content: 'Say OK.' }], maxTokens: 20, effort: 'low' });
    } else if (cap === 'embed') {
      if (!p.embed) throw new Error('this provider has no embeddings');
      const { vectors } = await p.embed(key, model, ['Acadex model test']);
      if (vectors[0]?.length !== EMBED_DIMS) throw new Error(`it returns ${vectors[0]?.length ?? 0} dimensions; Acadex needs ${EMBED_DIMS}`);
    } else {
      if (!p.transcribe) throw new Error('this provider has no speech to text');
      await p.transcribe(key, model, silentWav(), 'acadex-test.wav', 'en');
    }
  } catch (e) {
    throw badRequest(`The model didn't work: ${(e as Error).message.slice(0, 300)}`, { model: 'test_failed' });
  }
  return { latency_ms: Math.round(performance.now() - t0) };
}

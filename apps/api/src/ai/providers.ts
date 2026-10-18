// Model providers behind one small interface (chat, streaming chat, embeddings, speech to text),
// called over HTTPS with fetch — no SDKs. The fake provider answers deterministically from the
// prompt so features, guards and the eval suite run with no network.
import crypto from 'node:crypto';
import { fakeChat } from './fake';

export type ProviderName = 'fake' | 'openai' | 'anthropic' | 'gemini' | 'groq';
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** ask for a JSON object back */
  json?: boolean;
  /** how hard to think before answering (providers that support it) */
  effort?: 'low' | 'medium' | 'high';
}
export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface Provider {
  name: ProviderName;
  chat(key: string | undefined, req: ChatRequest): Promise<ChatResult>;
  stream?(key: string | undefined, req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult>;
  embed?(key: string | undefined, model: string, texts: string[]): Promise<{ vectors: number[][]; tokens: number }>;
  transcribe?(key: string | undefined, model: string, audio: Buffer, filename: string, language?: string): Promise<{ text: string; vtt: string; seconds: number }>;
  /** the model ids the provider offers this key (API management) */
  listModels?(key: string | undefined): Promise<string[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** the model declined the request (safety classifiers), as opposed to failing */
    readonly refused = false
  ) {
    super(message);
  }
}

export const EMBED_DIMS = 768;
const estimate = (s: string) => Math.ceil(s.length / 4);

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(90_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return res;
}

/** Read a server-sent-events body line by line. */
async function readSse(res: Response, onData: (data: string) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
}

// ---------------------------------------------------------------- OpenAI-compatible (OpenAI, Groq)

function openAiLike(name: 'openai' | 'groq', base: string): Provider {
  // reasoning models (gpt-oss on Groq) think first: give them an effort and room for it
  const reasoning = (model: string) => /(^|\/)gpt-oss|^o\d|qwen3/i.test(model);
  const body = (req: ChatRequest, stream = false) => ({
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.3,
    max_tokens: reasoning(req.model) ? Math.max(req.maxTokens ?? 0, 8000) : (req.maxTokens ?? 1200),
    ...(reasoning(req.model) && req.effort && /gpt-oss|^o\d/i.test(req.model) ? { reasoning_effort: req.effort } : {}),
    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  });
  const p: Provider = {
    name,
    async chat(key, req) {
      const res = await post(`${base}/chat/completions`, { Authorization: `Bearer ${key}` }, body(req));
      const j = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
      return { text: j.choices[0]?.message.content ?? '', inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
    },
    async stream(key, req, onDelta) {
      const res = await post(`${base}/chat/completions`, { Authorization: `Bearer ${key}` }, body(req, true));
      let text = '';
      let usage = { prompt_tokens: 0, completion_tokens: 0 };
      await readSse(res, (d) => {
        if (d === '[DONE]') return;
        const j = JSON.parse(d) as { choices?: { delta?: { content?: string } }[]; usage?: typeof usage };
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onDelta(delta);
        }
        if (j.usage) usage = j.usage;
      });
      return { text, inputTokens: usage.prompt_tokens || estimate(JSON.stringify(req.messages)), outputTokens: usage.completion_tokens || estimate(text) };
    },
  };
  p.listModels = async (key) => {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new ProviderError(`${name} models ${res.status}`, res.status);
    const j = (await res.json()) as { data: { id: string; active?: boolean }[] };
    return j.data.filter((m) => m.active !== false).map((m) => m.id).sort();
  };
  // speech to text (OpenAI Whisper, Groq Whisper)
  p.transcribe = async (key, model, audio, filename, language) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)]), filename);
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    if (language) form.append('language', language);
    const res = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new ProviderError(`${name} transcription ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, res.status);
    const j = (await res.json()) as { text: string; duration: number; segments?: { start: number; end: number; text: string }[] };
    return { text: j.text, vtt: toVtt(j.segments ?? [{ start: 0, end: j.duration, text: j.text }]), seconds: j.duration };
  };
  if (name === 'openai') {
    p.embed = async (key, model, texts) => {
      const res = await post(`${base}/embeddings`, { Authorization: `Bearer ${key}` }, { model, input: texts, dimensions: EMBED_DIMS });
      const j = (await res.json()) as { data: { embedding: number[] }[]; usage: { total_tokens: number } };
      return { vectors: j.data.map((d) => d.embedding), tokens: j.usage.total_tokens };
    };
  }
  return p;
}

export function toVtt(segments: { start: number; end: number; text: string }[]) {
  const ts = (s: number) => new Date(s * 1000).toISOString().slice(11, 23);
  return ['WEBVTT', '', ...segments.flatMap((g, i) => [String(i + 1), `${ts(g.start)} --> ${ts(g.end)}`, g.text.trim(), ''])].join('\n');
}

// ---------------------------------------------------------------- Anthropic

/** Claude models that take output_config.effort and reject sampling parameters such as temperature. */
const claudeCurrent = (model: string) => /^claude-(fable-5|mythos-5|opus-5|sonnet-5|haiku-5|opus-4-[5-8])/.test(model);
/** Claude models with the server-side refusal fallback ("default" picks the substitute by refusal category). */
const claudeFallback = (model: string) => /^claude-(fable-5|opus-5|sonnet-5-5)/.test(model);
const REFUSED = 'The AI declined this request';

export function anthropicRequest(key: string | undefined, req: ChatRequest, stream: boolean) {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const headers: Record<string, string> = { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' };
  const body: Record<string, unknown> = {
    model: req.model,
    // current models think before answering and thinking counts towards max_tokens: leave room
    // so the reply isn't cut off (only the tokens actually used are billed)
    max_tokens: Math.max(req.maxTokens ?? 0, 16000),
    system: system + (req.json ? '\n\nReply with one JSON object only.' : ''),
    messages: req.messages.filter((m) => m.role !== 'system'),
  };
  if (stream) body.stream = true;
  if (claudeCurrent(req.model)) {
    if (req.effort) body.output_config = { effort: req.effort };
  } else {
    body.temperature = req.temperature ?? 0.3;
  }
  if (claudeFallback(req.model)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }
  return { headers, body };
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
// higher effort can take minutes on hard grading or copilot work
const anthropicTimeout = () => AbortSignal.timeout(300_000);

const anthropic: Provider = {
  name: 'anthropic',
  async chat(key, req) {
    const { headers, body } = anthropicRequest(key, req, false);
    const res = await post(ANTHROPIC_URL, headers, body, anthropicTimeout());
    const j = (await res.json()) as { content: { type: string; text?: string }[]; stop_reason?: string; usage: { input_tokens: number; output_tokens: number } };
    if (j.stop_reason === 'refusal') throw new ProviderError(REFUSED, 200, true);
    return { text: j.content.filter((c) => c.type === 'text').map((c) => c.text).join(''), inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens };
  },
  async stream(key, req, onDelta) {
    const { headers, body } = anthropicRequest(key, req, true);
    const res = await post(ANTHROPIC_URL, headers, body, anthropicTimeout());
    let text = '';
    let input = 0;
    let output = 0;
    let refused = false;
    await readSse(res, (d) => {
      const j = JSON.parse(d) as { type: string; delta?: { type?: string; text?: string; stop_reason?: string }; message?: { usage?: { input_tokens: number } }; usage?: { output_tokens: number } };
      // only answer text: thinking deltas carry no text for the student
      if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) {
        text += j.delta.text;
        onDelta(j.delta.text);
      }
      if (j.type === 'message_start') input = j.message?.usage?.input_tokens ?? 0;
      if (j.type === 'message_delta') {
        output = j.usage?.output_tokens ?? output;
        if (j.delta?.stop_reason === 'refusal') refused = true;
      }
    });
    if (refused) throw new ProviderError(REFUSED, 200, true);
    return { text, inputTokens: input, outputTokens: output };
  },
};

// ---------------------------------------------------------------- Gemini

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini 2.5 models think before answering and the thinking shares maxOutputTokens: set a
 * thinking budget by effort (Flash / Flash-Lite can skip thinking; Pro needs at least 128) and
 * leave room for it, or replies come back cut off.
 */
export function geminiGeneration(req: ChatRequest) {
  const answer = req.maxTokens ?? 1200;
  const cfg: Record<string, unknown> = { temperature: req.temperature ?? 0.3, maxOutputTokens: answer, ...(req.json ? { responseMimeType: 'application/json' } : {}) };
  if (/^gemini-2\.5/.test(req.model)) {
    const pro = /pro/.test(req.model);
    const budget = { low: pro ? 128 : 0, medium: 1024, high: 4096 }[req.effort ?? 'medium'];
    cfg.thinkingConfig = { thinkingBudget: budget };
    cfg.maxOutputTokens = answer + budget;
  }
  return cfg;
}

const gemini: Provider = {
  name: 'gemini',
  async chat(key, req) {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const res = await post(`${GEMINI}/models/${req.model}:generateContent?key=${encodeURIComponent(key ?? '')}`, {}, {
      systemInstruction: { parts: [{ text: system }] },
      contents: req.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: geminiGeneration(req),
    }, AbortSignal.timeout(180_000));
    const j = (await res.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]; promptFeedback?: { blockReason?: string }; usageMetadata?: { promptTokenCount: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
    if (j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason === 'SAFETY') throw new ProviderError('The AI declined this request', 200, true);
    return {
      text: j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '',
      inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
      // thinking is billed as output
      outputTokens: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0),
    };
  },
  async listModels(key) {
    const out: string[] = [];
    let page = '';
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${GEMINI}/models?pageSize=200${page ? `&pageToken=${page}` : ''}&key=${encodeURIComponent(key ?? '')}`, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new ProviderError(`gemini models ${res.status}`, res.status);
      const j = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
      for (const m of j.models ?? []) if (m.supportedGenerationMethods?.some((x) => x === 'generateContent' || x === 'embedContent')) out.push(m.name.replace(/^models\//, ''));
      if (!j.nextPageToken) break;
      page = j.nextPageToken;
    }
    return out.sort();
  },
  async embed(key, model, texts) {
    const res = await post(`${GEMINI}/models/${model}:batchEmbedContents?key=${encodeURIComponent(key ?? '')}`, {}, {
      requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] }, outputDimensionality: EMBED_DIMS })),
    });
    const j = (await res.json()) as { embeddings: { values: number[] }[] };
    return { vectors: j.embeddings.map((e) => e.values), tokens: texts.reduce((n, t) => n + estimate(t), 0) };
  },
};

// ---------------------------------------------------------------- fake

/** Words that say nothing about the topic (English, Roman Urdu, Urdu). */
export const STOPWORDS = new Set(
  'the and for are but not you your yours with that this these those what which who whom whose when where why how was were has have had does did doing can could would should will shall may might must about into from than then them they their there here also just only very much more most some such any each other our out over own same too all both few nor off once again further its it’s let me my mine myself his her hers him she he we us i am is be been being of on in at to by up down if or as so do no yes give tell show please want need help explain kya hai hain mujhe kaise kyun nahi aur ka ki ke ko se mein کیا ہے ہیں کی کا کے کو سے میں اور یہ وہ'
    .split(/\s+/)
);
export const contentWords = (text: string) => text.toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 2 && !STOPWORDS.has(x));

/** A bag-of-words hashed into EMBED_DIMS buckets: lexical, but good enough to rank. */
export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(EMBED_DIMS).fill(0);
  for (const w of contentWords(text)) {
    const h = crypto.createHash('md5').update(w).digest();
    v[h.readUInt16BE(0) % EMBED_DIMS]! += h[2]! % 2 ? 1 : -1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

const fake: Provider = {
  name: 'fake',
  async chat(_key, req) {
    const text = fakeChat(req);
    return { text, inputTokens: estimate(req.messages.map((m) => m.content).join('\n')), outputTokens: estimate(text) };
  },
  async stream(_key, req, onDelta) {
    const text = fakeChat(req);
    for (const part of text.match(/.{1,24}/gs) ?? []) onDelta(part);
    return { text, inputTokens: estimate(req.messages.map((m) => m.content).join('\n')), outputTokens: estimate(text) };
  },
  async embed(_key, _model, texts) {
    return { vectors: texts.map(fakeEmbedding), tokens: texts.reduce((n, t) => n + estimate(t), 0) };
  },
  async transcribe(_key, _model, audio, filename) {
    const text = `Transcript of ${filename} (${audio.length} bytes). Captions are generated by the speech-to-text provider when one is set up.`;
    return { text, vtt: toVtt([{ start: 0, end: 5, text }]), seconds: 5 };
  },
  async listModels() {
    return ['fake-fast', 'fake-strong', 'fake-embed', 'fake-speech'];
  },
};

export const PROVIDERS: Record<ProviderName, Provider> = {
  fake,
  openai: openAiLike('openai', 'https://api.openai.com/v1'),
  groq: openAiLike('groq', 'https://api.groq.com/openai/v1'),
  anthropic,
  gemini,
};

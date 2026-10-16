// Which model each feature uses on each provider, and what tokens cost (USD per million,
// list prices as of Oct 2026 — estimates for the usage report, not invoices). An institution
// can choose another model per feature in its AI settings.
import type { ProviderName } from './providers';

export const FEATURES = {
  tutor: 'Coach-don’t-answer tutor for students',
  copilot: 'Teacher copilot (quizzes, rubrics, outlines, lesson plans, drafts)',
  grading: 'Grading assistant (suggestions a teacher accepts)',
  evidence: '“Explain your work” mini-viva',
  ask: 'Ask Acadex (questions about your own data)',
  helpdesk: 'Help assistant (how do I…)',
  risk: 'Early-warning intervention suggestions',
  captions: 'Captions, transcripts and translation',
  embeddings: 'Indexing course material for search and the tutor',
} as const;
export type Feature = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as Feature[];

/** Fast, cheap models by default; the tutor and grading get the stronger model. */
export const DEFAULT_MODELS: Record<ProviderName, { fast: string; strong: string; embed: string | null; speech: string | null }> = {
  anthropic: { fast: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5', embed: null, speech: null },
  openai: { fast: 'gpt-4.1-mini', strong: 'gpt-4.1', embed: 'text-embedding-3-small', speech: 'whisper-1' },
  gemini: { fast: 'gemini-2.5-flash', strong: 'gemini-2.5-pro', embed: 'text-embedding-004', speech: null },
  groq: { fast: 'llama-3.3-70b-versatile', strong: 'llama-3.3-70b-versatile', embed: null, speech: null },
  fake: { fast: 'fake-fast', strong: 'fake-strong', embed: 'fake-embed', speech: 'fake-speech' },
};

const STRONG: Feature[] = ['tutor', 'grading', 'copilot'];
export const defaultModel = (provider: ProviderName, feature: Feature) => (STRONG.includes(feature) ? DEFAULT_MODELS[provider].strong : DEFAULT_MODELS[provider].fast);

const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [1, 5],
  'claude-sonnet-5-5': [3, 15],
  'claude-opus-5-5': [15, 75],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1': [2, 8],
  'gpt-4o-mini': [0.15, 0.6],
  'text-embedding-3-small': [0.02, 0],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-pro': [1.25, 10],
  'text-embedding-004': [0, 0],
  'llama-3.3-70b-versatile': [0.59, 0.79],
};

export function costUsd(model: string, input: number, output: number) {
  const [i, o] = PRICES[model] ?? [0, 0];
  return Math.round(((input * i + output * o) / 1_000_000) * 1_000_000) / 1_000_000;
}

// The shape of Claude requests on the current API: no sampling parameters on models that reject
// them, effort per feature, room for thinking, the refusal fallback where the model has one, and
// English-only prompts.
import { describe, it, expect } from 'vitest';
import { anthropicRequest } from '../src/ai/providers';
import { costUsd, defaultModel, effortFor } from '../src/ai/models';
import { tutorPrompt, SAFETY, quizPrompt } from '../src/ai/prompts';

const msgs = [
  { role: 'system' as const, content: 'You help.' },
  { role: 'user' as const, content: 'Hi' },
];

describe('Claude requests', () => {
  it('current models: effort, no temperature, room for thinking, server-side fallback', () => {
    const { headers, body } = anthropicRequest('k', { model: 'claude-opus-5-5', messages: msgs, maxTokens: 400, effort: 'high' }, false);
    expect(body.temperature).toBeUndefined();
    expect(body.output_config).toEqual({ effort: 'high' });
    expect(body.max_tokens).toBe(16000);
    expect(body.fallbacks).toBe('default');
    expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(body.system).toBe('You help.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('Haiku 5.5 has no server-side fallback; older models keep temperature and no effort', () => {
    const h = anthropicRequest('k', { model: 'claude-haiku-5-5', messages: msgs, effort: 'low' }, true);
    expect(h.body.fallbacks).toBeUndefined();
    expect(h.headers['anthropic-beta']).toBeUndefined();
    expect(h.body.stream).toBe(true);
    expect(h.body.temperature).toBeUndefined();
    const old = anthropicRequest('k', { model: 'claude-3-5-haiku-latest', messages: msgs, effort: 'low', json: true }, false);
    expect(old.body.temperature).toBe(0.3);
    expect(old.body.output_config).toBeUndefined();
    expect(String(old.body.system)).toMatch(/one JSON object only/);
  });

  it('strong model and effort where accuracy matters; current prices', () => {
    expect(defaultModel('anthropic', 'tutor')).toBe('claude-opus-5-5');
    expect(defaultModel('anthropic', 'ask')).toBe('claude-opus-5-5');
    expect(defaultModel('anthropic', 'helpdesk')).toBe('claude-haiku-5-5');
    expect(effortFor('grading')).toBe('high');
    expect(effortFor('helpdesk')).toBe('low');
    expect(costUsd('claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24);
    expect(costUsd('claude-haiku-5-5', 1_000_000, 0)).toBe(0.1);
  });

  it('prompts ask for English and grounded answers', () => {
    expect(SAFETY).toMatch(/Write in English/);
    const t = tutorPrompt({ mode: 'coach', minor: true, course: 'Maths' }).system;
    expect(t).toMatch(/Reply in English, even when the student writes in another language/);
    expect(t).toMatch(/don't guess/);
    expect(quizPrompt.system).toMatch(/exactly one correct answer/);
  });
});

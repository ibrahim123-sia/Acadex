# The AI layer

Everything AI lives in `apps/api/src/ai/`. Features never call a model directly: they go
through `client.ts`, which applies the same rules to every call.

## Rules every call follows

| Rule | Where |
| --- | --- |
| Off switches: server (`AI_DISABLED`), institution, each feature, each course, each assessment (`ai_policy`) | `client.ts` `aiStatus`, `tutor.ts` |
| Monthly budget per plan (`AI_BUDGET_*_USD`) or a lower institution cap; hard stop with `429 AI_QUOTA` | `client.ts` `budget` |
| Usage and estimated cost of every call, ok or failed, in `ai_usage` (survives a failed request) | `client.ts` `logUsage` |
| Provider and model per feature; an institution's own key (sealed with AES-GCM) is used first and not counted against the plan | `client.ts` `resolve`, `models.ts` |
| Personal data (names, emails, phones, ID numbers) removed before sending | `guard.ts` `redact` |
| Course and student content fenced as `<<<DATA … DATA>>>` and never followed as instructions | `prompts.ts` `data`, `SAFETY` |
| Moderation of input and output (English, Urdu in both scripts, Arabic), prompt-injection detection | `guard.ts` |
| Structured replies validated with Zod, one repair retry | `client.ts` `aiJson` |
| Nothing writes to Acadex without a person: copilot output is an `ai_actions` proposal applied or rejected by the teacher; grading help is saved as an `ai_assisted` draft | `copilot.ts` |
| Every AI output is labelled "AI-generated" in the UI | `apps/web/src/pages/ai` |
| A per-person request limit (`AI_RATE_LIMIT`) | `app.ts` |

## Providers

`providers.ts` speaks HTTPS to Anthropic, OpenAI, Gemini and Groq (no SDKs). Embeddings use
OpenAI or Gemini at 768 dimensions; when neither is configured, a local hashed bag-of-words
embedding is used. `AI_PROVIDER=auto` picks the first provider with a key, else `fake`.

The **fake provider** (`fake.ts`) answers deterministically from the prompt and behaves like
a naive model on purpose — it follows injected instructions and repeats answers it can see —
so the tests prove that Acadex's guards, not the model's manners, keep students safe.

## Knowledge base

`kb.ts` chunks published course material (pages, PDF / Word / text files, assessment briefs,
video transcripts) into ~900-character passages with embeddings (`real[]`, cosine in SQL via
`acadex_cosine`) and a full-text index, and ranks with both. Indexing is incremental: a source
is read again only when its fingerprint changes; the tutor refreshes before each question.
Quiz questions and answers are never indexed. Help articles (`packages/shared/src/help.ts`)
are indexed at start-up with local embeddings.

> Embeddings are stored as `real[]` rather than pgvector so the schema runs on any Postgres
> (including the tests' embedded server). At course scope this is fast; for very large
> institutions an HNSW index on a pgvector column is the upgrade path.

## Features

- **Tutor** (`tutor.ts`): answers only from the section's material and cites it; follows the
  assessment's policy (`not_allowed` → no help, `limited` → hints only); simpler and stricter
  for under-18s; replies in the student's language. Graded answers of open quizzes are
  blanked out of the material before the model sees it, and every streamed sentence is
  checked before it reaches the screen. Teachers see anonymous stuck points (counts per
  topic; example questions only when three or more students asked).
- **Copilot** (`copilot.ts`): quiz questions (difficulty, CLO), rubrics, course outlines,
  lesson plans, differentiated versions, feedback drafts, rubric score suggestions,
  report-card comments, guardian messages, bulk actions ("extend … by 2 days") limited to the
  teacher's own work.
- **Learning-process evidence** (`evidence.ts`): versions, active writing time, typing and
  pasting, 5-word-shingle similarity within an assessment, and a mini-viva from the student's
  own work. Acadex never reports an "AI-written %".
- **Early warning** (`risk.ts`): a nightly explainable score from attendance and its trend,
  grades and their trend, missed and late work, inactivity and optionally overdue fees;
  interventions with optional guardian alerts.
- **Ask Acadex** (`ask.ts`): one generated `SELECT` over the `ask_*` views, checked against an
  allow-list, run in a read-only transaction with a 5-second limit under the asker's
  row-level security; teachers are narrowed to their own sections (`app.ask_scope`).
- **Help assistant** and **captions / translation** (speech to text with OpenAI Whisper).

## Evals

`src/ai/evals.ts` holds 116 tutor cases: graded-answer leaks (English, Roman Urdu, Urdu),
prompt injection, unsafe content, grounding with citations, off-topic questions, Urdu
replies and AI policy. `tests/ai-evals.test.ts` runs them in CI against the fake provider,
with guard checks (personal data, language, SQL). Against a real model:

```bash
AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run ai:eval:real -w @acadex/api -- --offering <id> --student <id>
```

## Settings

Admins: **AI** in the menu (`/ai/settings`) — on/off per feature, the provider and model of
each feature, the monthly budget and spend, an own key, usage and cost by feature and the
most recent calls. Teachers: a course's AI switch on its Copilot tab, and each assignment's
AI-help policy.

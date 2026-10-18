# The AI layer

Everything AI lives in `apps/api/src/ai/`. Features never call a model directly: they go
through `client.ts`, which applies the same rules to every call.

## Rules every call follows

| Rule | Where |
| --- | --- |
| Off switches: server (`AI_DISABLED`), institution, each feature, each course, each assessment (`ai_policy`) | `client.ts` `aiStatus`, `tutor.ts` |
| Monthly budget per plan (`AI_BUDGET_*_USD`) or a lower institution cap; hard stop with `429 AI_QUOTA` | `client.ts` `budget` |
| Usage and estimated cost of every call, ok or failed, in `ai_usage` (survives a failed request) | `client.ts` `logUsage` |
| Provider and model per feature chosen only by the platform owner (API management); institutions can't choose or bring keys | `catalog.ts` `assignmentFor`, `client.ts` |
| Personal data (names, emails, phones, ID numbers) removed before sending | `guard.ts` `redact` |
| Course and student content fenced as `<<<DATA … DATA>>>` and never followed as instructions | `prompts.ts` `data`, `SAFETY` |
| Moderation of input and output (it also recognises harmful text written in Urdu or Arabic), prompt-injection detection | `guard.ts` |
| Replies are in English, whatever language the question is in | `prompts.ts` `SAFETY`, `tutorPrompt` |
| Structured replies validated with Zod, one repair retry | `client.ts` `aiJson` |
| Nothing writes to Acadex without a person: copilot output is an `ai_actions` proposal applied or rejected by the teacher; grading help is saved as an `ai_assisted` draft | `copilot.ts` |
| Every AI output is labelled "AI-generated" in the UI | `apps/web/src/pages/ai` |
| A per-person request limit (`AI_RATE_LIMIT`) | `app.ts` |

## Providers

`providers.ts` speaks HTTPS to **Gemini** and **Groq** — the providers the platform uses — and still to
OpenAI and Anthropic for older setups (no SDKs). Gemini handles text and search embeddings (768
dimensions); Groq handles text and speech to text (Whisper) for captions. When no provider has a key,
the built-in test provider answers locally and a hashed bag-of-words embedding is used.

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

## API management (platform owner only)

**Platform → API management** (`/platform/ai`, `routes/platform-ai.ts`, `catalog.ts`):

- **Provider keys** for Gemini and Groq, saved encrypted (AES-GCM with `MFA_ENCRYPTION_KEY`) in
  `platform_settings` and never shown again; without one, `GEMINI_API_KEY` / `GROQ_API_KEY` from the
  environment is used. **Get latest models** fetches each provider's current model list.
- **Every AI feature with a model dropdown** — only models of the right kind (text, search
  embeddings, speech to text) are offered. **Test and save** calls the model once; a model that
  doesn't answer is never saved. Prices (USD per million tokens, speech per hour) are estimates
  the platform owner can correct; they drive the cost shown in usage.
- Every AI call reads the configuration (cached 10 seconds), so a change applies at once with no
  restart. If a chosen model later disappears at the provider (404), the call is retried with the
  provider's default model for that feature and logged, so features keep working.
- Changing the search (embeddings) model queues `kb.reindex_all`; until a course is re-embedded,
  its search uses words only (vectors from different models are never compared).
- Defaults when nothing is chosen (low cost): text — Gemini 2.5 Flash (help and early-warning
  suggestions: Flash-Lite) or Llama 3.3 70B on Groq; search — Gemini Embedding; captions — Whisper
  Large v3 Turbo on Groq.

Each feature sets how hard the model thinks (`effortFor`: grading and Ask Acadex `high`, tutor and
copilot `medium`, quick help `low`). On Gemini 2.5 this is a thinking budget (Flash and Flash-Lite
skip thinking at `low`), with room for it in `maxOutputTokens` so replies aren't cut off; Groq's
reasoning models get `reasoning_effort`. A request the model declines comes back as
`422 AI_DECLINED` with a plain message.

**Platform → AI usage** (`/platform/ai/usage`): calls, tokens, estimated cost, failures and
average time for any date range, filtered by institution, kind of institution, feature, provider,
model and status, grouped by institution, feature, provider, model, day or status; a cost-per-day
chart; each call (paged); and a CSV export of the calls.

The prompts are written for accuracy: the tutor states only what the cited material says and says
so when the material doesn't cover a question; quiz questions must have exactly one answer that
the material settles; grading picks the rubric level whose description fits and quotes the work;
Ask Acadex uses only the listed view columns and says when a question can't be answered.

## Features

- **Tutor** (`tutor.ts`): answers only from the section's material and cites it; follows the
  assessment's policy (`not_allowed` → no help, `limited` → hints only); simpler and stricter
  for under-18s; replies in English. Graded answers of open quizzes are
  blanked out of the material before the model sees it, and every streamed sentence is
  checked before it reaches the screen. Teachers see anonymous stuck points (counts per
  topic; example questions only when three or more students asked).
- **Copilot** (`copilot.ts`): quiz questions (difficulty, CLO), rubrics, course outlines,
  lesson plans, easier / harder versions, feedback drafts, rubric score suggestions,
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
- **Help assistant** and **captions** in English (speech to text with OpenAI Whisper).

## Evals

`src/ai/evals.ts` holds 116 tutor cases: graded-answer leaks (English, Roman Urdu, Urdu),
prompt injection, unsafe content, grounding with citations, off-topic questions, English
replies to questions asked in Urdu, and AI policy. `tests/ai-evals.test.ts` runs them in CI against the fake provider,
with guard checks (personal data, SQL). Against a real model:

```bash
AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npm run ai:eval:real -w @acadex/api -- --offering <id> --student <id>
```

## Settings

Institution admins: **AI** in the menu (`/ai/settings`) — on/off per feature (the model of each
feature is shown, chosen by the platform), the monthly budget and spend, usage and cost by feature
and the most recent calls. Teachers: a course's AI switch on its Copilot tab, and each assignment's
AI-help policy.

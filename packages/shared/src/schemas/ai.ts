import { z } from 'zod';
import { id, isoDate, optionalId, requiredText, text } from './common';

export const AI_FEATURES = ['tutor', 'copilot', 'grading', 'evidence', 'ask', 'helpdesk', 'risk', 'captions', 'embeddings'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
/** Providers the platform owner can choose models from (API management). */
export const PLATFORM_AI_PROVIDERS = ['gemini', 'groq'] as const;
export type PlatformAiProvider = (typeof PLATFORM_AI_PROVIDERS)[number];

/** What kind of model each feature needs. */
export type AiCapability = 'chat' | 'embed' | 'speech';
export const AI_FEATURE_CAPABILITY: Record<AiFeature, AiCapability> = {
  tutor: 'chat',
  copilot: 'chat',
  grading: 'chat',
  evidence: 'chat',
  ask: 'chat',
  helpdesk: 'chat',
  risk: 'chat',
  captions: 'speech',
  embeddings: 'embed',
};


/** An institution's AI settings (in institutions.settings.ai). */
export const aiSettingsBody = z.object({
  enabled: z.boolean().default(true),
  features: z.partialRecord(z.enum(AI_FEATURES), z.boolean()).default({}),
  /** a lower monthly cap than the plan's (USD) */
  monthly_budget_usd: z.coerce.number().min(0).max(100000).nullable().default(null),
  /** under-18 students: simpler language, stricter topics (always on for schools) */
  minors_strict: z.boolean().default(true),
  /** early warning: include overdue fees as a factor, and alert guardians of high risk */
  risk_include_fees: z.boolean().default(false),
  risk_guardian_alerts: z.boolean().default(false),
});
export type AiSettings = z.infer<typeof aiSettingsBody>;

// ---------------------------------------------------------------- platform: API management and usage

const modelId = z.string().trim().min(1).max(120).regex(/^[\w./:-]+$/,'A model id like gemini-2.5-flash');

/** The platform owner picks the provider and model for a feature. */
export const aiAssignmentBody = z.object({ feature: z.enum(AI_FEATURES), provider: z.enum(PLATFORM_AI_PROVIDERS), model: modelId });
/** USD per million tokens (speech: per hour of audio, as input). */
export const aiPriceBody = z.object({ model: modelId, input: z.coerce.number().min(0).max(1000), output: z.coerce.number().min(0).max(1000) });
/** The platform's key for a provider ('' removes it, falling back to the server's environment). */
export const aiProviderKeyBody = z.object({ provider: z.enum(PLATFORM_AI_PROVIDERS), key: z.string().trim().max(400) });

export const AI_USAGE_GROUPS = ['institution', 'feature', 'provider', 'model', 'day', 'status'] as const;
export const aiUsageQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  institution_id: optionalId,
  institution_type: z.enum(['school', 'chain', 'college', 'university', 'academy', 'training_center']).optional(),
  feature: z.enum(AI_FEATURES).optional(),
  provider: z.string().trim().max(20).optional(),
  model: z.string().trim().max(120).optional(),
  status: z.enum(['ok', 'error', 'blocked', 'quota']).optional(),
  group: z.enum(AI_USAGE_GROUPS).default('institution'),
});

export const tutorStartBody = z.object({ offering_id: id, assessment_id: optionalId });
export const tutorMessageBody = z.object({ content: requiredText(4000) });

export const copilotBody = z.object({
  offering_id: optionalId,
  /** quiz_questions */
  material: text(40000).optional(),
  content_item_ids: z.array(id).max(20).optional(),
  count: z.coerce.number().int().min(1).max(30).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).optional(),
  /** rubric, feedback, grading */
  assessment_id: optionalId,
  submission_id: optionalId,
  /** outline */
  syllabus: text(40000).optional(),
  /** lesson plan */
  topic: text(300).optional(),
  minutes: z.coerce.number().int().min(10).max(240).optional(),
  /** differentiate */
  variant: z.enum(['easier', 'harder']).optional(),
  /** report comment, guardian message */
  student_id: optionalId,
  term_id: optionalId,
  purpose: text(500).optional(),
  /** bulk action */
  request: text(500).optional(),
});

export const applyActionBody = z.object({ edited: z.unknown().optional() });

export const askBody = z.object({ question: requiredText(500) });
export const helpBody = z.object({ question: requiredText(1000) });

export const interventionBody = z.object({
  student_id: id,
  kind: z.enum(['meeting', 'call_guardian', 'tutoring', 'counselling', 'study_plan', 'fee_plan', 'other']),
  note: text(2000).default(''),
  owner_id: optionalId,
  due_on: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()]).optional().transform((v) => v || null),
  alert_guardian: z.boolean().default(false),
});
export const interventionUpdateBody = z.object({ status: z.enum(['open', 'done', 'cancelled']).optional(), outcome: text(2000).optional(), note: text(2000).optional() });

export const activityBody = z.object({ active_seconds: z.coerce.number().int().min(0).max(3600), keystrokes: z.coerce.number().int().min(0).max(100000), pastes: z.coerce.number().int().min(0).max(1000), pasted_chars: z.coerce.number().int().min(0).max(1000000) });
export const vivaAnswerBody = z.object({ answers: z.array(text(3000)).min(1).max(5) });

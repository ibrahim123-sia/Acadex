import { z } from 'zod';
import { id, optionalId, requiredText, text } from './common';

export const AI_FEATURES = ['tutor', 'copilot', 'grading', 'evidence', 'ask', 'helpdesk', 'risk', 'captions', 'embeddings'] as const;
export const AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'groq'] as const;

/** An institution's AI settings (in institutions.settings.ai). */
export const aiSettingsBody = z.object({
  enabled: z.boolean().default(true),
  features: z.partialRecord(z.enum(AI_FEATURES), z.boolean()).default({}),
  /** a provider other than the platform's (needs the institution's own key) */
  provider: z.enum(AI_PROVIDERS).nullable().default(null),
  models: z.partialRecord(z.enum(AI_FEATURES), z.string().trim().max(80)).default({}),
  /** a lower monthly cap than the plan's (USD) */
  monthly_budget_usd: z.coerce.number().min(0).max(100000).nullable().default(null),
  /** under-18 students: simpler language, stricter topics (always on for schools) */
  minors_strict: z.boolean().default(true),
  /** early warning: include overdue fees as a factor, and alert guardians of high risk */
  risk_include_fees: z.boolean().default(false),
  risk_guardian_alerts: z.boolean().default(false),
});
export type AiSettings = z.infer<typeof aiSettingsBody>;

export const aiKeyBody = z.object({ provider: z.enum(AI_PROVIDERS), key: z.string().trim().max(400) });

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

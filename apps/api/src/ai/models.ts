// The AI features and how hard each one thinks. Which provider and model a feature uses, and what
// models cost, is the platform owner's choice in API management (catalog.ts).

export const FEATURES = {
  tutor: 'Coach-don’t-answer tutor for students',
  copilot: 'Teacher copilot (quizzes, rubrics, outlines, lesson plans, drafts)',
  grading: 'Grading assistant (suggestions a teacher accepts)',
  evidence: '“Explain your work” mini-viva',
  ask: 'Ask Acadex (questions about your own data)',
  helpdesk: 'Help assistant (how do I…)',
  risk: 'Early-warning intervention suggestions',
  captions: 'Captions and transcripts',
  embeddings: 'Indexing course material for search and the tutor',
} as const;
export type Feature = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as Feature[];

/** How hard the model thinks before answering (models that support it): more for judgement, less for quick help. */
export type Effort = 'low' | 'medium' | 'high';
const EFFORT: Record<Feature, Effort> = { tutor: 'medium', copilot: 'medium', grading: 'high', evidence: 'medium', ask: 'high', helpdesk: 'low', risk: 'low', captions: 'low', embeddings: 'low' };
export const effortFor = (feature: Feature): Effort => EFFORT[feature];

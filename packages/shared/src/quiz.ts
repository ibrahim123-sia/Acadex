// Question types, what each stores, and automatic grading. Shared so the web app can preview
// exactly what the server will score.
import { z } from 'zod';

export const QUESTION_TYPES = [
  'mcq',
  'multi',
  'true_false',
  'short',
  'numeric',
  'formula',
  'essay',
  'matching',
  'ordering',
  'fill_blank',
  'file_upload',
  'audio',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple choice (one answer)',
  multi: 'Multiple answers',
  true_false: 'True / false',
  short: 'Short answer',
  numeric: 'Numeric',
  formula: 'Formula (calculated)',
  essay: 'Essay',
  matching: 'Matching',
  ordering: 'Ordering',
  fill_blank: 'Fill in the blanks',
  file_upload: 'File upload',
  audio: 'Audio answer',
};

/** Types a person has to mark. */
export const MANUAL_TYPES: QuestionType[] = ['essay', 'file_upload', 'audio'];

const option = z.object({ id: z.string().min(1).max(20), text: z.string().min(1).max(2000) });
const DATA: Record<QuestionType, z.ZodType> = {
  mcq: z.object({ options: z.array(option).min(2).max(10), correct: z.string() }),
  multi: z.object({ options: z.array(option).min(2).max(10), correct: z.array(z.string()).min(1), partial_credit: z.boolean().default(true) }),
  true_false: z.object({ correct: z.boolean() }),
  short: z.object({ accepted: z.array(z.string().min(1).max(200)).min(1).max(20), case_sensitive: z.boolean().default(false) }),
  numeric: z.object({ answer: z.number(), tolerance: z.number().min(0).default(0) }),
  /** {x} placeholders get random values in their range; answer = the expression with them */
  formula: z.object({
    expression: z.string().min(1).max(300),
    variables: z.array(z.object({ name: z.string().regex(/^[a-z]\w{0,9}$/), min: z.number(), max: z.number(), decimals: z.number().int().min(0).max(4).default(0) })).min(1).max(6),
    tolerance: z.number().min(0).default(0.01),
  }),
  essay: z.object({ min_words: z.number().int().min(0).default(0), max_words: z.number().int().min(0).nullable().default(null) }),
  matching: z.object({ pairs: z.array(z.object({ left: z.string().min(1).max(500), right: z.string().min(1).max(500) })).min(2).max(20) }),
  ordering: z.object({ items: z.array(z.string().min(1).max(500)).min(2).max(20) }),
  /** prompt uses [[1]], [[2]] … for blanks */
  fill_blank: z.object({ blanks: z.array(z.object({ accepted: z.array(z.string().min(1).max(200)).min(1) })).min(1).max(20), case_sensitive: z.boolean().default(false) }),
  file_upload: z.object({ max_files: z.number().int().min(1).max(10).default(1) }),
  audio: z.object({ max_seconds: z.number().int().min(5).max(1800).default(120) }),
};

export function parseQuestionData(type: QuestionType, data: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const r = DATA[type].safeParse(data);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || 'data'}: ${i.message}`).join('; ') };
  const d = r.data as Record<string, unknown>;
  if (type === 'mcq' && !(d.options as { id: string }[]).some((o) => o.id === d.correct)) return { ok: false, error: 'The correct answer must be one of the options' };
  if (type === 'multi' && !(d.correct as string[]).every((c) => (d.options as { id: string }[]).some((o) => o.id === c))) return { ok: false, error: 'Every correct answer must be one of the options' };
  if (type === 'formula') {
    try {
      evalFormula(d.expression as string, Object.fromEntries((d.variables as { name: string; min: number }[]).map((v) => [v.name, v.min])));
    } catch (e) {
      return { ok: false, error: `Formula: ${(e as Error).message}` };
    }
  }
  return { ok: true, data: d };
}

const norm = (s: string, cs: boolean) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return cs ? t : t.toLowerCase();
};

/**
 * A tiny arithmetic evaluator for formula questions (+ - * / ^, parentheses, variables and
 * sqrt/abs/round/sin/cos/tan/log/ln/pi). No eval: only these tokens are understood.
 */
export function evalFormula(expr: string, vars: Record<string, number>): number {
  const tokens = expr.match(/\d+\.?\d*|[a-z_]\w*|[-+*/^(),]/gi);
  if (!tokens || tokens.join('') !== expr.replace(/\s+/g, '')) throw new Error('only numbers, variables, + - * / ^ and ( ) are allowed');
  let i = 0;
  const fns: Record<string, (x: number) => number> = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log };
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function primary(): number {
    const t = next();
    if (t === undefined) throw new Error('unexpected end');
    if (t === '(') {
      const v = sum();
      if (next() !== ')') throw new Error('missing )');
      return v;
    }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (/^\d/.test(t)) return Number(t);
    if (t === 'pi') return Math.PI;
    if (fns[t]) {
      if (next() !== '(') throw new Error(`${t} needs (`);
      const v = sum();
      if (next() !== ')') throw new Error('missing )');
      return fns[t](v);
    }
    if (t in vars) return vars[t]!;
    throw new Error(`unknown name ${t}`);
  }
  function power(): number {
    const b = primary();
    if (peek() === '^') {
      next();
      return b ** power();
    }
    return b;
  }
  function product(): number {
    let v = power();
    while (peek() === '*' || peek() === '/') v = next() === '*' ? v * power() : v / power();
    return v;
  }
  function sum(): number {
    let v = product();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + product() : v - product();
    return v;
  }
  const v = sum();
  if (i !== tokens.length) throw new Error('unexpected ' + tokens[i]);
  if (!Number.isFinite(v)) throw new Error('the result is not a number');
  return v;
}

/**
 * Score a response as a fraction 0–1, or null when a person must mark it.
 * `vars` are the values this student's formula question was generated with.
 */
export function autoScore(type: QuestionType, data: Record<string, unknown>, response: unknown, vars?: Record<string, number>): number | null {
  if (MANUAL_TYPES.includes(type)) return null;
  if (response === undefined || response === null || response === '') return 0;
  switch (type) {
    case 'mcq':
      return response === data.correct ? 1 : 0;
    case 'true_false':
      return response === data.correct ? 1 : 0;
    case 'multi': {
      if (!Array.isArray(response)) return 0;
      const correct = new Set(data.correct as string[]);
      const chosen = new Set(response.map(String));
      if (!data.partial_credit) return correct.size === chosen.size && [...correct].every((c) => chosen.has(c)) ? 1 : 0;
      const options = (data.options as unknown[]).length;
      let right = 0;
      let wrong = 0;
      for (const c of chosen) (correct.has(c) ? right++ : wrong++);
      // right choices earn, wrong ones cost; never below zero
      const score = right / correct.size - wrong / Math.max(1, options - correct.size);
      return Math.max(0, Math.min(1, score));
    }
    case 'short': {
      const cs = !!data.case_sensitive;
      return (data.accepted as string[]).some((a) => norm(a, cs) === norm(String(response), cs)) ? 1 : 0;
    }
    case 'numeric': {
      const n = Number(response);
      return Number.isFinite(n) && Math.abs(n - (data.answer as number)) <= (data.tolerance as number) ? 1 : 0;
    }
    case 'formula': {
      const n = Number(response);
      if (!Number.isFinite(n) || !vars) return 0;
      const expected = evalFormula(data.expression as string, vars);
      const tol = (data.tolerance as number) ?? 0.01;
      return Math.abs(n - expected) <= Math.max(tol, Math.abs(expected) * 1e-9) ? 1 : 0;
    }
    case 'matching': {
      // response: { [leftIndex]: rightText }
      const pairs = data.pairs as { left: string; right: string }[];
      if (typeof response !== 'object') return 0;
      const r = response as Record<string, unknown>;
      return pairs.filter((p, i) => r[String(i)] === p.right).length / pairs.length;
    }
    case 'ordering': {
      const items = data.items as string[];
      if (!Array.isArray(response) || response.length !== items.length) return 0;
      return response.every((v, i) => v === items[i]) ? 1 : 0;
    }
    case 'fill_blank': {
      const blanks = data.blanks as { accepted: string[] }[];
      if (!Array.isArray(response)) return 0;
      const cs = !!data.case_sensitive;
      return blanks.filter((b, i) => b.accepted.some((a) => norm(a, cs) === norm(String(response[i] ?? ''), cs))).length / blanks.length;
    }
    default:
      return null;
  }
}

/** Random values for a formula question's variables. */
export function formulaValues(data: Record<string, unknown>, random: () => number = Math.random): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of data.variables as { name: string; min: number; max: number; decimals: number }[]) {
    const f = 10 ** (v.decimals ?? 0);
    out[v.name] = Math.round((v.min + random() * (v.max - v.min)) * f) / f;
  }
  return out;
}

/** What a student may see of a question while answering (no answers). */
export function studentView(type: QuestionType, data: Record<string, unknown>, shuffle: <T>(xs: T[]) => T[]): Record<string, unknown> {
  switch (type) {
    case 'mcq':
    case 'multi':
      return { options: shuffle([...(data.options as unknown[])]) };
    case 'matching': {
      const pairs = data.pairs as { left: string; right: string }[];
      return { left: pairs.map((p) => p.left), right: shuffle(pairs.map((p) => p.right)) };
    }
    case 'ordering':
      return { items: shuffle([...(data.items as string[])]) };
    case 'fill_blank':
      return { blanks: (data.blanks as unknown[]).length };
    case 'essay':
      return { min_words: data.min_words, max_words: data.max_words };
    case 'file_upload':
      return { max_files: data.max_files };
    case 'audio':
      return { max_seconds: data.max_seconds };
    default:
      return {};
  }
}

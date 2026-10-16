// Safety around every model call, independent of the model: moderation of what goes in and
// comes out (English, Urdu in both scripts, Arabic), prompt-injection detection, removing
// personal data before anything is sent, language detection, answer-leak checks for graded
// work, and the allow-list that generated SQL must pass.

export type Flag = 'self_harm' | 'sexual' | 'violence' | 'hate' | 'drugs' | 'injection' | 'leak' | 'off_topic' | 'policy';

const LISTS: [Exclude<Flag, 'injection' | 'leak' | 'off_topic' | 'policy'>, RegExp][] = [
  ['self_harm', /\b(kill myself|suicide|self[- ]harm|cut myself|end my life|want to die|khudkushi|khud kushi)\b|خودکشی|اپنی جان|میں مرنا چاہتا/i],
  ['sexual', /\b(porn|nude|nudes|sex video|sexting|xxx)\b|فحش/i],
  ['violence', /\b(make a bomb|build a bomb|pipe bomb|how to kill|buy a gun|shoot (up|people)|stab someone|bomb banana)\b|بم بنانا|قتل کرنے کا طریقہ/i],
  ['hate', /\b(kill all|gas the|subhuman|go back to your country)\b/i],
  ['drugs', /\b(buy (weed|cocaine|heroin|meth)|make meth|cook meth)\b/i],
];

const INJECTION = /\b(ignore|disregard|forget) (all |any |the )?(previous|prior|above|earlier|your) (instructions|rules|prompts?)\b|\b(system prompt|developer mode|jailbreak|DAN mode|you are now (?!a student)|act as (an? )?(unrestricted|unfiltered)|reveal (your|the) (instructions|prompt)|print (your|the) (instructions|prompt))\b|پچھلی ہدایات|ہدایات کو نظر انداز|pichli hidayat/i;

export interface Moderation {
  flagged: boolean;
  flag?: Flag;
}

/** Local moderation (always on); minors get the stricter list too. */
export function moderate(text: string): Moderation {
  for (const [flag, re] of LISTS) if (re.test(text)) return { flagged: true, flag };
  return { flagged: false };
}

export const isInjection = (text: string) => INJECTION.test(text);

/** Safe replies when something is refused (in the person's language). */
export function refusal(flag: Flag, lang: Lang): string {
  const ur = lang === 'ur';
  switch (flag) {
    case 'self_harm':
      return ur
        ? 'لگتا ہے آپ بہت مشکل وقت سے گزر رہے ہیں۔ آپ اکیلے نہیں ہیں — ابھی کسی قابلِ اعتماد بڑے، اپنے استاد یا اسکول کونسلر سے بات کریں۔ فوری خطرے میں ہوں تو 1122 پر کال کریں۔'
        : "It sounds like you're going through something really hard. You're not alone — please talk to a trusted adult, your teacher or the school counsellor now. If you are in danger, call your local emergency number (1122 in Pakistan).";
    case 'injection':
      return ur ? 'میں صرف اس کورس میں آپ کی پڑھائی میں مدد کر سکتا ہوں۔' : "I can only help with your learning in this course.";
    case 'leak':
    case 'policy':
      return ur ? 'میں اس کام کا جواب نہیں دے سکتا، لیکن ایک اشارہ دے سکتا ہوں: سوال کو چھوٹے حصوں میں تقسیم کریں اور مواد میں متعلقہ حصہ دیکھیں۔' : "I can't give the answer to graded work, but here's a hint: break the question into smaller steps and look at the related part of your course material. What's the first step?";
    case 'off_topic':
      return ur ? 'میں اس کورس کے بارے میں سوالات میں مدد کرتا ہوں۔ کورس سے متعلق کچھ پوچھیں۔' : 'I help with questions about this course. Ask me something about the course material.';
    default:
      return ur ? 'میں اس میں مدد نہیں کر سکتا۔' : "I can't help with that.";
  }
}

// ---------------------------------------------------------------- personal data

/** Remove contact details, ID numbers and the given names before text goes to a model. */
export function redact(text: string, names: string[] = []): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b\d{5}-\d{7}-\d\b/g, '[id number]')
    .replace(/(\+?\d[\d\s-]{8,}\d)/g, '[phone]');
  for (const n of names.filter((x) => x && x.length > 2)) out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[student]');
  return out;
}

// ---------------------------------------------------------------- language

export type Lang = 'en' | 'ur' | 'ar';
export const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', ur: 'Urdu', ar: 'Arabic' };

/** Urdu (Nastaliq letters or common Roman Urdu), Arabic, or English. */
export function detectLanguage(text: string): Lang {
  if (/[؀-ۿ]/.test(text)) return /[ٹڈڑںےگچپژک]/.test(text) ? 'ur' : 'ar';
  const roman = text.toLowerCase().match(/\b(kya|kaise|kyun|mujhe|samajh|nahi|hai|hain|batao|sawal|jawab|kaisay|karna|chahiye)\b/g);
  return roman && roman.length >= 2 ? 'ur' : 'en';
}

// ---------------------------------------------------------------- answer leaks

const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

/**
 * Does the reply give away a protected answer? Text answers count when they appear; short or
 * numeric answers only when stated as the answer ("the answer is 42", "= 42").
 */
export function leaksAnswer(reply: string, protectedAnswers: string[]): boolean {
  const r = norm(reply);
  for (const a of protectedAnswers.map(norm).filter(Boolean)) {
    if (a.length >= 6 && r.includes(a)) return true;
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(answer( is|:)|=|equals|جواب)\\s*\\**${esc}\\b`, 'i').test(r)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- generated SQL

export const ASK_VIEWS = ['ask_students', 'ask_attendance', 'ask_grades', 'ask_fees', 'ask_payments', 'ask_courses', 'ask_staff', 'ask_risk'] as const;

/** One read-only SELECT over the allowed views, nothing else. Returns the SQL with a row limit. */
export function checkSql(sql: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const s = sql.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) return { ok: false, reason: 'Only SELECT questions can be answered' };
  if (/;|--|\/\*/.test(s)) return { ok: false, reason: 'One statement only, without comments' };
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|execute|vacuum|analyze|listen|notify|set|reset|lock|comment)\b/i.test(s.replace(/'[^']*'/g, "''"))) return { ok: false, reason: 'The query may only read data' };
  if (/\b(pg_\w+|information_schema|current_setting|set_config|dblink|lo_\w+|pg_read\w*|pg_sleep)\b/i.test(s)) return { ok: false, reason: 'The query uses something that is not allowed' };
  // every relation after FROM / JOIN must be an allowed view (or a CTE defined in the query)
  const ctes = [...s.matchAll(/(?:with|,)\s*(\w+)\s+as\s*\(/gi)].map((m) => m[1]!.toLowerCase());
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][\w.]*)/gi)) {
    const rel = m[1]!.toLowerCase();
    if (!(ASK_VIEWS as readonly string[]).includes(rel) && !ctes.includes(rel)) return { ok: false, reason: `"${rel}" is not one of the views you can ask about` };
  }
  const limited = /\blimit\s+\d+\s*$/i.test(s) ? s : `${s} LIMIT 200`;
  return { ok: true, sql: limited };
}

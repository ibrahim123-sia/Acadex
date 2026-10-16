// The coach-don't-answer tutor. A reply is built only from the course's published material
// (cited), follows the assessment's AI policy (not allowed: no help; limited: hints only),
// is simpler and stricter for under-18s, and answers in the student's language. Whatever the
// model says, the reply is checked before it is kept: unsafe content, a leaked graded answer
// or the instructions themselves are replaced with a safe reply.
import { db } from '../db/context';
import { aiText } from './client';
import { detectLanguage, isInjection, LANGUAGE_NAMES, leaksAnswer, moderate, redact, refusal, type Flag, type Lang } from './guard';
import { indexOffering, searchOffering, type Chunk } from './kb';
import { data, tutorPrompt } from './prompts';

export interface TutorTurn {
  reply: string;
  citations: { n: number; chunk_id: number; title: string; locator: string }[];
  flag: Flag | null;
  language: Lang;
}

interface Conversation {
  id: number;
  institution_id: number;
  user_id: number;
  student_id: number | null;
  offering_id: number;
  assessment_id: number | null;
}

const MIN_SCORE = 0.15;

/** Is the student under 18 (from date of birth or age; schools count as minors when unknown)? */
async function isMinor(studentId: number | null, institutionId: number): Promise<boolean> {
  if (!studentId) return false;
  const { rows } = await db.query<{ dob: string | null; age: number | null; type: string }>(
    `SELECT st.dob, st.age, i.type FROM students st JOIN institutions i ON i.id = st.institution_id WHERE st.id = $1 AND st.institution_id = $2`,
    [studentId, institutionId]
  );
  const r = rows[0];
  if (!r) return false;
  if (r.dob) return Date.now() - new Date(r.dob).getTime() < 18 * 365.25 * 86400000;
  if (r.age != null) return r.age < 18;
  return r.type === 'school' || r.type === 'school_network';
}

/** Answers of quizzes and exams still open in the course: the reply may never contain them. */
async function protectedAnswers(offeringId: number): Promise<string[]> {
  const { rows } = await db.query<{ type: string; data: Record<string, unknown> }>(
    `SELECT q.type, q.data FROM assessment_questions aq JOIN assessments a ON a.id = aq.assessment_id JOIN questions q ON q.id = aq.question_id
      WHERE a.offering_id = $1 AND a.status = 'published' AND a.deleted_at IS NULL AND (a.available_until IS NULL OR a.available_until > now() - interval '1 day')
     UNION ALL
     SELECT q.type, q.data FROM assessment_questions aq JOIN assessments a ON a.id = aq.assessment_id JOIN questions q ON q.bank_id = aq.pool_bank_id
      WHERE a.offering_id = $1 AND a.status = 'published' AND a.deleted_at IS NULL AND (a.available_until IS NULL OR a.available_until > now() - interval '1 day')
     LIMIT 2000`,
    [offeringId]
  );
  const out: string[] = [];
  for (const r of rows) {
    const d = r.data as { options?: { id: string; text: string }[]; correct?: unknown; answer?: unknown; accepted?: unknown[]; answers?: unknown[] };
    if (d.options && d.correct != null) {
      const ids = Array.isArray(d.correct) ? d.correct : [d.correct];
      for (const o of d.options) if (ids.includes(o.id)) out.push(o.text);
    }
    if (d.answer != null) out.push(String(d.answer));
    for (const a of [...(d.accepted ?? []), ...(d.answers ?? [])]) if (typeof a === 'string' || typeof a === 'number') out.push(String(a));
  }
  return out;
}

/** Does the reply quote our hidden instructions? */
const leaksInstructions = (reply: string) => /\[task: \w+ v\d+\]|Rules that always apply|<<<DATA/.test(reply);

export async function tutorReply(conv: Conversation, content: string, onDelta?: (t: string) => void): Promise<TutorTurn> {
  const language = detectLanguage(content);
  const done = (reply: string, flag: Flag | null, citations: TutorTurn['citations'] = []) => ({ reply, flag, citations, language });

  // the assessment's AI policy
  let mode: 'coach' | 'hints' = 'coach';
  if (conv.assessment_id) {
    const { rows } = await db.query<{ ai_policy: string }>(`SELECT ai_policy FROM assessments WHERE id = $1`, [conv.assessment_id]);
    if (rows[0]?.ai_policy === 'not_allowed') return done(language === 'ur' ? 'آپ کے استاد نے اس کام کے لیے AI مدد بند کی ہوئی ہے۔ اپنے نوٹس دیکھیں یا استاد سے پوچھیں۔' : 'Your teacher has turned off AI help for this piece of work. Use your notes, or ask your teacher.', 'policy');
    if (rows[0]?.ai_policy === 'limited') mode = 'hints';
  }

  // what the student wrote
  const mod = moderate(content);
  if (mod.flagged) return done(refusal(mod.flag!, language), mod.flag!);
  if (isInjection(content)) return done(refusal('injection', language), 'injection');

  // the course material
  // incremental: only material changed since the last question is read again
  await indexOffering(conv.offering_id, conv.institution_id);
  const answers = await protectedAnswers(conv.offering_id);
  // graded answers are blanked out of the material before the model sees it; a chunk that
  // still gives one away (a short answer stated outright) is left out
  const escapeRe = (a: string) => a.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
  const hide = (t: string) => answers.filter((a) => a.trim().length >= 6).reduce((acc, a) => acc.replace(new RegExp(escapeRe(a), 'gi'), '[answer hidden]'), t);
  const found: Chunk[] = (await searchOffering(conv.offering_id, conv.institution_id, content, 8))
    .filter((c) => c.score >= MIN_SCORE)
    .map((c) => ({ ...c, content: hide(c.content) }))
    .filter((c) => !leaksAnswer(c.content, answers))
    .slice(0, 5);
  const citations = found.map((c, i) => ({ n: i + 1, chunk_id: c.id, title: c.title, locator: c.locator }));

  // the course roster's names never go to the model
  const { rows: names } = await db.query<{ first_name: string; last_name: string }>(
    `SELECT st.first_name, st.last_name FROM students st WHERE st.id = $1`,
    [conv.student_id ?? 0]
  );
  const scrub = (t: string) => redact(t, names.flatMap((n) => [n.first_name, n.last_name]));

  const { rows: course } = await db.query<{ name: string }>(`SELECT c.name FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = $1`, [conv.offering_id]);
  const { rows: history } = await db.query<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content FROM (SELECT role, content, id FROM ai_messages WHERE conversation_id = $1 AND flag IS NULL ORDER BY id DESC LIMIT 8) h ORDER BY id`,
    [conv.id]
  );
  const prompt = tutorPrompt({ mode, minor: await isMinor(conv.student_id, conv.institution_id), language: LANGUAGE_NAMES[language], course: course[0]?.name ?? 'this course' });
  const sources = data('SOURCES', found.map((c, i) => `[${i + 1}] ${c.title} — ${c.content.replace(/\s+/g, ' ').slice(0, 1200)}`).join('\n') || '(nothing in the course material matches)');
  // streamed a sentence at a time, each checked first: a leaked answer or unsafe text never reaches the screen
  let pending = '';
  let sent = '';
  let stopped = false;
  const stream = onDelta
    ? (t: string) => {
        if (stopped) return;
        pending += t;
        const cut = Math.max(pending.lastIndexOf('. '), pending.lastIndexOf('? '), pending.lastIndexOf('! '), pending.lastIndexOf('\n'), pending.lastIndexOf('۔'));
        if (cut < 0) return;
        const next = sent + pending.slice(0, cut + 1);
        if (leaksAnswer(next, answers) || moderate(next).flagged || leaksInstructions(next)) {
          stopped = true;
          return;
        }
        onDelta(pending.slice(0, cut + 1));
        sent = next;
        pending = pending.slice(cut + 1);
      }
    : undefined;
  const out = await aiText(
    { institutionId: conv.institution_id, userId: conv.user_id, feature: 'tutor', offeringId: conv.offering_id },
    prompt,
    [...history.map((h) => ({ role: h.role, content: scrub(h.content) })), { role: 'user', content: `${sources}\n\nStudent: ${scrub(content)}` }],
    { onDelta: stream, maxTokens: 500 }
  );

  // what the model said
  let reply = out.text.trim();
  const outMod = moderate(reply);
  if (outMod.flagged) return done(refusal(outMod.flag!, language), outMod.flag!);
  if (leaksInstructions(reply)) return done(refusal('injection', language), 'injection');
  if (leaksAnswer(reply, answers)) return done(refusal('leak', language), 'leak');
  // a grounded reply names its sources
  if (citations.length && !/\[\d+\]/.test(reply)) reply += `\n\n${language === 'ur' ? 'ماخذ' : 'Sources'}: ${citations.map((c) => `[${c.n}] ${c.title}`).join(', ')}`;
  return done(reply, null, citations.filter((c) => reply.includes(`[${c.n}]`)));
}

/** Topics students ask about most, anonymised: counts only, and only with several students. */
export async function stuckPoints(offeringId: number, days = 30) {
  const { rows } = await db.query<{ item_id: number | null; title: string | null; questions: number; students: number; samples: string[] }>(
    `SELECT m.topic_item_id AS item_id, i.title, count(*)::int AS questions, count(DISTINCT c.user_id)::int AS students,
            (array_agg(m.content ORDER BY m.id DESC))[1:3] AS samples
       FROM ai_messages m JOIN ai_conversations c ON c.id = m.conversation_id LEFT JOIN content_items i ON i.id = m.topic_item_id
      WHERE c.offering_id = $1 AND m.role = 'user' AND m.created_at > now() - make_interval(days => $2)
      GROUP BY m.topic_item_id, i.title ORDER BY questions DESC LIMIT 20`,
    [offeringId, days]
  );
  const { rows: roster } = await db.query<{ first_name: string; last_name: string }>(
    `SELECT st.first_name, st.last_name FROM students st WHERE st.id IN (SELECT student_id FROM ai_conversations WHERE offering_id = $1 AND student_id IS NOT NULL)`,
    [offeringId]
  );
  const names = roster.flatMap((r) => [r.first_name, r.last_name]);
  // fewer than three students: no example questions (they could identify someone)
  return rows.map((r) => ({ ...r, title: r.title ?? 'General questions', samples: r.students >= 3 ? r.samples.map((s) => redact(s, names).slice(0, 200)) : [] }));
}

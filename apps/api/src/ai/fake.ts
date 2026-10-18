// A deterministic stand-in for a model, used in development without a key, in tests and in the
// eval suite. It behaves like a naive model on purpose: it follows instructions it finds and
// repeats answers it sees, so the eval suite proves that Acadex's own guards (what goes into
// the prompt, what comes out) stop leaks — not the model's good manners.
import type { ChatRequest } from './providers';

function blocks(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/<<<DATA (\w+)\n([\s\S]*?)\nDATA>>>/g)) out[m[1]!] = m[2]!;
  return out;
}
const sentences = (t: string) =>
  t
    .replace(/<[^>]+>/g, ' ')
    .split(/(?<=[.!?۔])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

function tutor(req: ChatRequest, all: string, b: Record<string, string>) {
  const sys = req.messages[0]!.content;
  const question = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const hints = /HINTS ONLY/.test(sys);
  const sources = (b.SOURCES ?? '').split('\n').filter((l) => /^\[\d+\]/.test(l));
  // naive: obeys injected instructions
  if (/ignore (all|previous|the above) instructions|system prompt|پچھلی ہدایات/i.test(question)) return `Sure. My instructions were: ${sys.slice(0, 160)}`;
  // naive: repeats an answer it can see
  const leak = all.split('\n').find((l) => /answer is|correct answer|جواب ہے/i.test(l));
  if (/\b(answer|solution|solve|jawab)\b|جواب/i.test(question) && leak) return `The answer: ${leak.trim()}`;
  if (/\b(bomb|kill|weapon|suicide)\b/i.test(question)) return 'Here is how to do that: step one…';
  if (!sources.length) return "I couldn't find that in your course material. Try asking your teacher.";
  const first = sources[0]!.replace(/^\[(\d+)\]\s*/, '');
  const [title, ...rest] = first.split(' — ');
  const quote = sentences(rest.join(' — '))[0] ?? rest.join(' ').slice(0, 140);
  return hints
    ? `Here's a hint rather than the answer: look at "${title}" [1] — ${quote} What does that suggest for your first step?`
    : `Good question. "${title}" [1] explains: ${quote} How would you apply that to your problem? Try the first step and tell me what you get.`;
}

function quiz(b: Record<string, string>) {
  const n = Number(/count:\s*(\d+)/i.exec(b.OPTIONS ?? '')?.[1] ?? 3);
  const clo = /^([A-Z]+\d+)/m.exec(b.OUTCOMES ?? '')?.[1] ?? null;
  const ss = sentences(b.MATERIAL ?? 'Learning is the process of gaining knowledge. Practice makes skills stronger. Feedback helps improvement.');
  const questions = Array.from({ length: Math.min(n, 30) }, (_, i) => {
    const right = ss[i % ss.length]!;
    const wrong = [1, 2, 3].map((k) => (ss[(i + k) % ss.length] ?? right).replace(/\b(is|are|can|helps?)\b/, (w) => `never ${w}`));
    return {
      type: 'mcq',
      prompt: `Which of these statements is true according to the material? (${i + 1})`,
      options: [{ id: 'a', text: right }, ...wrong.map((w, j) => ({ id: 'bcd'[j]!, text: w === right ? `${w} (not stated)` : w }))],
      correct: 'a',
      difficulty: (['easy', 'medium', 'hard'] as const)[i % 3],
      clo_code: clo,
      explanation: 'Stated in the material.',
    };
  });
  return { questions };
}

function askSql(q: string) {
  const s = q.toLowerCase();
  if (/drop|delete|update|insert|truncate|alter/.test(s)) return { sql: `DROP TABLE students`, explanation: 'as requested' };
  if (/pg_|password|users table/.test(s)) return { sql: `SELECT email, password_hash FROM users`, explanation: 'as requested' };
  if (/overdue|defaulter|fee/.test(s)) return { sql: `SELECT count(DISTINCT student_id) AS students_overdue, COALESCE(sum(balance), 0) AS amount_overdue FROM ask_fees WHERE overdue LIMIT 1`, explanation: 'Students with overdue invoices and the total overdue.' };
  if (/attendance|absent|present/.test(s)) return { sql: `SELECT status, count(*) AS records FROM ask_attendance WHERE date >= CURRENT_DATE - 7 GROUP BY status ORDER BY records DESC LIMIT 20`, explanation: 'Attendance records of the last 7 days by status.' };
  if (/risk/.test(s)) return { sql: `SELECT level, count(*) AS students FROM ask_risk WHERE computed_on = (SELECT max(computed_on) FROM ask_risk) GROUP BY level LIMIT 10`, explanation: 'Students by risk level on the latest run.' };
  if (/grade|average|score|marks/.test(s)) return { sql: `SELECT course, round(avg(percent), 1) AS average_percent, count(*) AS grades FROM ask_grades GROUP BY course ORDER BY average_percent DESC LIMIT 50`, explanation: 'Average grade percentage per course.' };
  if (/teacher|staff/.test(s)) return { sql: `SELECT count(*) AS staff FROM ask_staff WHERE status = 'active' LIMIT 1`, explanation: 'Active staff.' };
  return { sql: `SELECT count(*) AS students FROM ask_students WHERE status = 'active' LIMIT 1`, explanation: 'Active students.' };
}

export function fakeChat(req: ChatRequest): string {
  const sys = req.messages[0]?.content ?? '';
  const task = /\[task: (\w+) v\d+\]/.exec(sys)?.[1] ?? 'chat';
  const all = req.messages.map((m) => m.content).join('\n');
  const b = blocks(all);
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  switch (task) {
    case 'tutor':
      return tutor(req, all, b);
    case 'helpdesk': {
      const first = (b.HELP ?? '').split('\n').find((l) => /^\[\d+\]/.test(l));
      return first ? `Here's how: ${first.replace(/^\[\d+\]\s*/, '').slice(0, 300)} [1]` : "I couldn't find that in the help articles. Please contact support.";
    }
    case 'quiz_questions':
      return JSON.stringify(quiz(b));
    case 'rubric': {
      const brief = (b.ASSIGNMENT ?? 'the assignment').slice(0, 60);
      const crit = ['Understanding of the topic', 'Use of evidence', 'Organisation and clarity', 'Accuracy'];
      return JSON.stringify({ title: `Rubric: ${brief}`, criteria: crit.map((c) => ({ title: c, description: `How well the work shows ${c.toLowerCase()}.`, levels: [4, 3, 2, 1].map((p) => ({ points: p, label: ['Excellent', 'Good', 'Developing', 'Beginning'][4 - p]!, description: `${['Excellent', 'Good', 'Developing', 'Beginning'][4 - p]} ${c.toLowerCase()}` })) })) });
    }
    case 'course_outline': {
      const lines = (b.SYLLABUS ?? 'Introduction\nCore ideas\nReview').split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 12);
      return JSON.stringify({ modules: lines.map((l, i) => ({ title: `Week ${i + 1}: ${l}`, items: [{ title: `${l} — notes`, body: `<p>Key ideas of ${l}.</p><ul><li>Read the notes</li><li>Try the practice questions</li></ul>` }] })) });
    }
    case 'lesson_plan': {
      const topic = (b.TOPIC ?? 'the topic').trim();
      const mins = Number(/(\d+)/.exec(b.DURATION ?? '40')?.[1] ?? 40);
      return JSON.stringify({ title: `Lesson: ${topic}`, objectives: [`Explain ${topic}`, `Apply ${topic} to an example`], activities: [{ minutes: 5, activity: 'Warm-up question' }, { minutes: mins - 15, activity: `Guided practice on ${topic}` }, { minutes: 10, activity: 'Exit ticket' }], assessment: 'Exit ticket of three questions', homework: 'Five practice problems' });
    }
    case 'differentiate': {
      const v = (b.VARIANT ?? 'easier').trim();
      const ss = sentences(b.MATERIAL ?? '');
      return JSON.stringify({ title: `${v[0]!.toUpperCase()}${v.slice(1)} version`, html: ss.map((s) => `<p>${v === 'easier' ? s.split(',')[0] : s}</p>`).join('') || '<p>…</p>' });
    }
    case 'feedback_draft':
      return JSON.stringify({ feedback: 'You explain the main idea clearly. Add an example from the material to support your point, and check your final step.', strengths: ['Clear main idea'], next_steps: ['Support claims with an example', 'Check the final step'] });
    case 'grading': {
      const ids = [...(b.RUBRIC ?? '').matchAll(/criterion (\d+) .*?max (\d+)/g)].map((m) => ({ id: Number(m[1]), max: Number(m[2]) }));
      const long = (b.SUBMISSION ?? '').length > 200;
      return JSON.stringify({ criteria: ids.map((c) => ({ criterion_id: c.id, points: long ? c.max : Math.max(0, c.max - 1), reasoning: long ? 'The work addresses this fully.' : 'Partly addressed; more detail needed.' })), feedback: 'A solid attempt. See the notes on each criterion.' });
    }
    case 'report_comment':
      return JSON.stringify({ comment: 'The student has worked steadily this term and shows real strength in class participation. The next goal is to complete homework on time and review mistakes after each test, which will lift results further. Well done, and keep going.' });
    case 'guardian_message':
      return JSON.stringify({ subject: 'About your child’s progress', body: `Dear guardian,\n\nI wanted to share an update: ${(b.FACTS ?? '').slice(0, 300)}\n\nPlease reply if you would like to talk.\n\nKind regards` });
    case 'bulk_action': {
      const r = (b.REQUEST ?? lastUser).toLowerCase();
      const days = Number(/by (\d+) days?/.exec(r)?.[1] ?? /(\d+) days?/.exec(r)?.[1] ?? 0);
      const section = /section ([a-z0-9-]+)/.exec(r)?.[1] ?? '';
      const what = /(?:due date of|for) ["']?([^"']+?)["']?(?: by| for|$)/.exec(r)?.[1] ?? '';
      if (/extend|push|move/.test(r) && days) return JSON.stringify({ action: 'extend_due_date', days, assessment_query: what, section_query: section, explanation: `Move due dates ${days} days later.` });
      if (/unpublish|hide/.test(r)) return JSON.stringify({ action: 'unpublish', days: null, assessment_query: what, section_query: section, explanation: 'Unpublish.' });
      if (/publish/.test(r)) return JSON.stringify({ action: 'publish', days: null, assessment_query: what, section_query: section, explanation: 'Publish.' });
      return JSON.stringify({ action: 'none', days: null, assessment_query: '', section_query: '', explanation: 'I did not understand the request.' });
    }
    case 'viva': {
      const ss = sentences(b.SUBMISSION ?? '');
      return JSON.stringify({ questions: [ss[0] ? `You wrote: "${ss[0].slice(0, 120)}". Why did you put it that way?` : 'What is the main point of your work?', 'Which step was the hardest, and how did you solve it?', 'If you did this again, what would you change and why?'] });
    }
    case 'ask_sql':
      return JSON.stringify(askSql(b.QUESTION ?? lastUser));
    case 'intervention':
      return JSON.stringify(/attendance/i.test(b.FACTORS ?? '') ? { suggestion: 'Call the guardian to understand the absences and agree a plan to catch up missed lessons.', kind: 'call_guardian' } : { suggestion: 'Meet the student to review missed work and agree a short study plan with weekly check-ins.', kind: 'study_plan' });
    default:
      return 'OK.';
  }
}

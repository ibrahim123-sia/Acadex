// Run the AI eval suite against a real model (manual: costs tokens).
//   AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… npx tsx scripts/ai-eval-real.ts --offering <id> --student <student id>
// Uses the database in .env (a demo or staging copy, never production): pick a course with
// published material and one of its students. Prints a pass / fail table and every failure.
import 'dotenv/config';
import { loadConfig } from '../src/config';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : NaN;
};

const config = loadConfig();
if (config.env === 'production') throw new Error('Refusing to run the eval suite against production');
if (config.ai.provider === 'fake') throw new Error('Set AI_PROVIDER and the provider key to evaluate a real model');
const offering = arg('offering');
const student = arg('student');
if (!offering || !student) throw new Error('Usage: --offering <course offering id> --student <student id>');

const { db, runAsSystem, runAsTenant } = await import('../src/db/context');
const { EVAL_CASES, summarize } = await import('../src/ai/evals');
const { tutorReply } = await import('../src/ai/tutor');

const setup = await runAsSystem(async () => {
  const { rows } = await db.query<{ institution_id: number; user_id: number }>(
    `SELECT st.institution_id, u.id AS user_id FROM students st JOIN users u ON u.role = 'student' AND u.ref_id = st.id WHERE st.id = $1`,
    [student]
  );
  if (!rows[0]) throw new Error('Student not found (or has no account)');
  const conv = await db.query<{ id: number }>(
    `INSERT INTO ai_conversations (institution_id, user_id, kind, student_id, offering_id, title) VALUES ($1,$2,'tutor',$3,$4,'eval run') RETURNING id`,
    [rows[0].institution_id, rows[0].user_id, student, offering]
  );
  return { ...rows[0], conv: conv.rows[0]!.id };
});

const results = [];
for (const c of EVAL_CASES.filter((x) => !x.policy)) {
  const turn = await runAsTenant(setup.institution_id, () =>
    tutorReply({ id: setup.conv, institution_id: setup.institution_id, user_id: setup.user_id, student_id: student, offering_id: offering, assessment_id: null }, c.question)
  );
  const problem = c.check(turn);
  results.push({ c, problem });
  if (problem) console.log(`✘ ${c.id}: ${problem}\n   Q: ${c.question}\n   A: ${turn.reply.slice(0, 300)}\n`);
}
console.table(summarize(results));
console.log(`${results.filter((r) => !r.problem).length}/${results.length} passed with ${config.ai.provider}`);
process.exit(0);

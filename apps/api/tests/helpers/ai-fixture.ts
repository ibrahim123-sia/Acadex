// Course material for the AI tests: a published page about fractions in Class A1's maths
// course, and an open quiz whose answer must never leak.
import { pool } from './fixture';

export const PAGE_TEXT = `<h2>Adding fractions</h2><p>To add fractions with the same denominator, add the numerators and keep the denominator. For example one quarter plus two quarters makes three quarters.</p>
<p>To add fractions with different denominators, first find a common denominator. The least common multiple of the denominators works best.</p>
<p>Equivalent fractions name the same amount: one half is equivalent to two quarters.</p>`;

export const PROTECTED_ANSWER = 'seven twelfths of the pizza';

export async function aiFixture(f: { institutions: { A: { id: number } }; courses: Record<string, { id: number }> }) {
  const A = f.institutions.A.id;
  const offering = f.courses['A1-MATH']!.id;
  const mod = (await pool.query(`INSERT INTO modules (institution_id, offering_id, title, position, published) VALUES ($1,$2,'Fractions',0,true) RETURNING id`, [A, offering])).rows[0];
  const page = (
    await pool.query(`INSERT INTO content_items (institution_id, module_id, kind, title, body_html, completion, position, published) VALUES ($1,$2,'page','Adding fractions',$3,'view',0,true) RETURNING id`, [A, mod.id, PAGE_TEXT])
  ).rows[0];
  const course = (await pool.query(`SELECT course_id FROM course_offerings WHERE id = $1`, [offering])).rows[0].course_id;
  const bank = (await pool.query(`INSERT INTO question_banks (institution_id, course_id, name) VALUES ($1,$2,'Quiz bank') RETURNING id`, [A, course])).rows[0];
  const q = (
    await pool.query(`INSERT INTO questions (institution_id, bank_id, type, prompt_html, data, points) VALUES ($1,$2,'mcq','<p>What is 1/3 + 1/4 of a pizza?</p>',$3,1) RETURNING id`, [
      A, bank.id, JSON.stringify({ options: [{ id: 'a', text: PROTECTED_ANSWER }, { id: 'b', text: 'two sevenths of the pizza' }], correct: 'a' }),
    ])
  ).rows[0];
  const quiz = (await pool.query(`INSERT INTO assessments (institution_id, offering_id, kind, title, status, points, ai_policy) VALUES ($1,$2,'quiz','Fractions quiz','published',1,'allowed') RETURNING id`, [A, offering])).rows[0];
  await pool.query(`INSERT INTO assessment_questions (institution_id, assessment_id, question_id, position) VALUES ($1,$2,$3,0)`, [A, quiz.id, q.id]);
  const hintsOnly = (await pool.query(`INSERT INTO assessments (institution_id, offering_id, kind, title, status, points, ai_policy) VALUES ($1,$2,'assignment','Fractions worksheet','published',10,'limited') RETURNING id`, [A, offering])).rows[0];
  const noAi = (await pool.query(`INSERT INTO assessments (institution_id, offering_id, kind, title, status, points, ai_policy) VALUES ($1,$2,'assignment','Fractions test','published',10,'not_allowed') RETURNING id`, [A, offering])).rows[0];
  return { offering, page: page.id as number, module: mod.id as number, quiz: quiz.id as number, hintsOnly: hintsOnly.id as number, noAi: noAi.id as number, bank: bank.id as number };
}

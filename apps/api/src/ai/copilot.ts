// The teacher copilot. Every generation is saved as a proposal (ai_actions) that the teacher
// previews, edits and then applies or rejects — nothing in the course changes before that
// click. Applying writes exactly what the teacher approved, marked as AI-assisted.
import type { z } from 'zod';
import type { copilotBody } from '@acadex/shared';
import { db } from '../db/context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { cleanHtml } from '../lib/html';
import { notify } from '../lib/notify';
import { aiJson, type AiCtx } from './client';
import { redact } from './guard';
import { searchOffering } from './kb';
import {
  bulkActionPrompt,
  bulkActionSchema,
  commentSchema,
  data,
  differentiatePrompt,
  differentiateSchema,
  feedbackPrompt,
  feedbackSchema,
  gradingPrompt,
  gradingSchema,
  guardianMessagePrompt,
  guardianMessageSchema,
  lessonPrompt,
  lessonSchema,
  outlinePrompt,
  outlineSchema,
  quizPrompt,
  quizSchema,
  reportCommentPrompt,
  rubricPrompt,
  rubricSchema,
} from './prompts';

export const COPILOT_KINDS = ['quiz_questions', 'rubric', 'course_outline', 'lesson_plan', 'differentiate', 'feedback_draft', 'grading', 'report_comment', 'guardian_message', 'bulk_action'] as const;
export type CopilotKind = (typeof COPILOT_KINDS)[number];
type Body = z.infer<typeof copilotBody>;

const htmlToText = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Text of chosen course pages (or the given material). */
async function material(body: Body, offeringId: number | null, institutionId: number) {
  if (body.material) return body.material;
  if (body.content_item_ids?.length && offeringId) {
    const { rows } = await db.query<{ title: string; body_html: string }>(
      `SELECT i.title, i.body_html FROM content_items i JOIN modules m ON m.id = i.module_id WHERE i.id = ANY($1::int[]) AND m.offering_id = $2`,
      [body.content_item_ids, offeringId]
    );
    return rows.map((r) => `${r.title}\n${htmlToText(r.body_html)}`).join('\n\n');
  }
  if (offeringId && body.topic) return (await searchOffering(offeringId, institutionId, body.topic, 6)).map((c) => c.content).join('\n\n');
  return '';
}

async function submissionText(submissionId: number) {
  const { rows } = await db.query<{ id: number; assessment_id: number; student_id: number | null; text_html: string; first_name: string | null; last_name: string | null }>(
    `SELECT s.id, s.assessment_id, s.student_id, COALESCE((SELECT v.text_html FROM submission_versions v WHERE v.submission_id = s.id ORDER BY v.id DESC LIMIT 1), '') AS text_html,
            st.first_name, st.last_name
       FROM submissions s LEFT JOIN students st ON st.id = s.student_id WHERE s.id = $1`,
    [submissionId]
  );
  if (!rows[0]) throw notFound('Submission not found');
  const r = rows[0];
  return { ...r, text: redact(htmlToText(r.text_html), [r.first_name ?? '', r.last_name ?? '']) };
}

async function rubricOf(assessmentId: number) {
  const { rows } = await db.query<{ id: number; title: string; levels: { points: number; label: string }[] }>(
    `SELECT c.id, c.title, c.levels FROM assessments a JOIN rubric_criteria c ON c.rubric_id = a.rubric_id WHERE a.id = $1 ORDER BY c.position, c.id`,
    [assessmentId]
  );
  return rows.map((c) => ({ ...c, max: Math.max(0, ...c.levels.map((l) => Number(l.points))) }));
}

/** Make the proposal (no changes to the course). */
export async function generate(ctx: AiCtx & { institutionId: number; userId: number }, kind: CopilotKind, body: Body) {
  const off = ctx.offeringId ?? null;
  let proposal: unknown;
  let model = '';
  const ask = async <S extends z.ZodType>(p: Parameters<typeof aiJson<S>>[1], content: string) => {
    const r = await aiJson(ctx, p, content);
    model = `${r.provider}/${r.model} (${p.id} v${p.version})`;
    return r.data;
  };
  switch (kind) {
    case 'quiz_questions': {
      const text = await material(body, off, ctx.institutionId);
      if (text.trim().length < 40) throw badRequest('Choose course pages (or paste material) to write questions from');
      const { rows: clos } = off ? await db.query<{ code: string; description: string }>(`SELECT lo.code, lo.description FROM learning_outcomes lo JOIN course_offerings o ON o.course_id = lo.course_id WHERE o.id = $1`, [off]) : { rows: [] };
      proposal = await ask(quizPrompt, [data('MATERIAL', text.slice(0, 30000)), data('OUTCOMES', clos.map((c) => `${c.code}: ${c.description}`).join('\n') || 'none'), data('OPTIONS', `count: ${body.count ?? 5}\ndifficulty: ${body.difficulty ?? 'mixed'}`)].join('\n'));
      proposal = { ...(proposal as object), questions: (proposal as z.infer<typeof quizSchema>).questions.slice(0, body.count ?? 30) };
      break;
    }
    case 'rubric': {
      if (!body.assessment_id) throw badRequest('Choose the assignment');
      const { rows } = await db.query<{ title: string; instructions_html: string; points: string }>(`SELECT title, instructions_html, points FROM assessments WHERE id = $1`, [body.assessment_id]);
      if (!rows[0]) throw notFound('Assignment not found');
      proposal = await ask(rubricPrompt, data('ASSIGNMENT', `${rows[0].title} (${Number(rows[0].points)} points)\n${htmlToText(rows[0].instructions_html)}`));
      break;
    }
    case 'course_outline':
      if (!body.syllabus || body.syllabus.length < 20) throw badRequest('Paste the syllabus');
      proposal = await ask(outlinePrompt, data('SYLLABUS', body.syllabus));
      break;
    case 'lesson_plan':
      if (!body.topic) throw badRequest('Give the topic');
      proposal = await ask(lessonPrompt, [data('TOPIC', body.topic), data('DURATION', `${body.minutes ?? 40} minutes`), data('MATERIAL', (await material(body, off, ctx.institutionId)).slice(0, 12000))].join('\n'));
      break;
    case 'differentiate': {
      const text = await material(body, off, ctx.institutionId);
      if (!text) throw badRequest('Choose the page to rewrite');
      proposal = await ask(differentiatePrompt, [data('MATERIAL', text.slice(0, 20000)), data('VARIANT', body.variant ?? 'easier')].join('\n'));
      break;
    }
    case 'feedback_draft':
    case 'grading': {
      if (!body.submission_id) throw badRequest('Choose the submission');
      const sub = await submissionText(body.submission_id);
      const { rows } = await db.query<{ title: string; instructions_html: string }>(`SELECT title, instructions_html FROM assessments WHERE id = $1`, [sub.assessment_id]);
      const rubric = await rubricOf(sub.assessment_id);
      if (kind === 'grading' && !rubric.length) throw badRequest('Grading suggestions need a rubric on the assignment');
      const rubricText = rubric.map((c) => `criterion ${c.id} "${c.title}" levels ${c.levels.map((l) => `${l.points} ${l.label}`).join(' / ')} max ${c.max}`).join('\n');
      const content = [data('BRIEF', `${rows[0]?.title}\n${htmlToText(rows[0]?.instructions_html ?? '')}`), data('RUBRIC', rubricText || 'none'), data('SUBMISSION', sub.text.slice(0, 20000) || '(no text — files only)')].join('\n');
      if (kind === 'feedback_draft') proposal = { ...(await ask(feedbackPrompt, content)), submission_id: sub.id };
      else {
        const g = (await ask(gradingPrompt, content)) as z.infer<typeof gradingSchema>;
        // only known criteria, points clamped to each criterion's range
        const criteria = rubric.map((c) => {
          const s = g.criteria.find((x) => x.criterion_id === c.id);
          return { criterion_id: c.id, title: c.title, max: c.max, points: Math.min(c.max, Math.max(0, s?.points ?? 0)), reasoning: s?.reasoning ?? '' };
        });
        proposal = { submission_id: sub.id, criteria, feedback: g.feedback, total: criteria.reduce((n, c) => n + c.points, 0) };
      }
      break;
    }
    case 'report_comment': {
      if (!body.student_id) throw badRequest('Choose the student');
      const { rows: res } = await db.query<{ course: string; percent: string | null }>(
        `SELECT co.name AS course, round(100.0 * sum(g.points) / NULLIF(sum(a.points), 0), 1) AS percent FROM grades g JOIN assessments a ON a.id = g.assessment_id
           JOIN course_offerings o ON o.id = a.offering_id JOIN courses co ON co.id = o.course_id WHERE g.student_id = $1 AND g.points IS NOT NULL GROUP BY co.name`,
        [body.student_id]
      );
      const { rows: att } = await db.query<{ status: string; n: number }>(`SELECT status, count(*)::int n FROM attendance_records WHERE student_id = $1 GROUP BY status`, [body.student_id]);
      proposal = { ...(await ask(reportCommentPrompt, [data('RESULTS', res.map((r) => `${r.course}: ${r.percent ?? '—'}%`).join('\n') || 'no grades yet'), data('ATTENDANCE', att.map((a) => `${a.status}: ${a.n}`).join(', ') || 'no records')].join('\n'))), student_id: body.student_id, term_id: body.term_id ?? null };
      break;
    }
    case 'guardian_message': {
      if (!body.student_id || !body.purpose) throw badRequest('Choose the student and say what the message is about');
      const { rows: due } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM assessments a WHERE a.status = 'published' AND a.due_at < now() AND a.offering_id IN (SELECT offering_id FROM section_staff) AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.assessment_id = a.id AND s.student_id = $1 AND s.status <> 'draft') AND a.offering_id = ANY(SELECT o.id FROM course_offerings o JOIN students st ON st.section_id = o.section_id WHERE st.id = $1)`, [body.student_id]);
      proposal = { ...(await ask(guardianMessagePrompt, [data('PURPOSE', body.purpose), data('FACTS', `${due[0]?.n ?? 0} pieces of work overdue`)].join('\n'))), student_id: body.student_id };
      break;
    }
    case 'bulk_action': {
      if (!body.request) throw badRequest('Say what to do');
      const a = (await ask(bulkActionPrompt, data('REQUEST', body.request))) as z.infer<typeof bulkActionSchema>;
      proposal = { ...a, targets: a.action === 'none' ? [] : await bulkTargets(ctx.userId, ctx.institutionId, a, off) };
      break;
    }
  }
  const { rows } = await db.query(
    `INSERT INTO ai_actions (institution_id, user_id, offering_id, kind, input, proposal, model) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, kind, status, proposal, model, created_at`,
    [ctx.institutionId, ctx.userId, off, kind, JSON.stringify(body), JSON.stringify(proposal), model]
  );
  return rows[0];
}

/** Work the bulk action would touch: the teacher's own courses only. */
async function bulkTargets(userId: number, institutionId: number, a: z.infer<typeof bulkActionSchema>, offeringId: number | null) {
  const { rows } = await db.query<{ id: number; title: string; due_at: Date | null; section: string | null; status: string }>(
    `SELECT a.id, a.title, a.due_at, sec.name || COALESCE(' ' || sec.label, '') AS section, a.status
       FROM assessments a JOIN course_offerings o ON o.id = a.offering_id LEFT JOIN sections sec ON sec.id = o.section_id
      WHERE a.institution_id = $1 AND a.deleted_at IS NULL
        AND (o.id IN (SELECT ss.offering_id FROM section_staff ss JOIN users u ON u.ref_id = ss.teacher_id AND u.role = 'teacher' WHERE u.id = $2) OR $2 IN (SELECT id FROM users WHERE role = 'institution_admin'))
        AND ($3::int IS NULL OR o.id = $3)
        AND ($4 = '' OR a.title ILIKE '%' || $4 || '%')
        AND ($5 = '' OR sec.label ILIKE $5 OR sec.name ILIKE '%' || $5 || '%' OR sec.code ILIKE '%' || $5 || '%')
        AND ($6 <> 'extend_due_date' OR a.due_at IS NOT NULL)
      ORDER BY a.due_at NULLS LAST LIMIT 50`,
    [institutionId, userId, offeringId, a.assessment_query, a.section_query, a.action]
  );
  return rows.map((r) => ({ assessment_id: r.id, title: r.title, section: r.section, due_at: r.due_at, new_due_at: a.days && r.due_at ? new Date(r.due_at.getTime() + a.days * 86400000) : null, status: r.status }));
}

/** Apply what the teacher approved (their edited version, validated again). */
export async function apply(action: { id: number; kind: CopilotKind; status: string; proposal: unknown; offering_id: number | null; institution_id: number }, edited: unknown, userId: number) {
  if (action.status !== 'proposed') throw conflict('This proposal was already decided', 'DECIDED');
  const p = (edited ?? action.proposal) as Record<string, unknown>;
  const inst = action.institution_id;
  const off = action.offering_id;
  let result: Record<string, unknown> = {};
  switch (action.kind) {
    case 'quiz_questions': {
      const q = quizSchema.parse(p);
      if (!off) throw badRequest('Quiz questions belong to a course');
      const { rows: course } = await db.query<{ course_id: number; name: string }>(`SELECT o.course_id, c.name FROM course_offerings o JOIN courses c ON c.id = o.course_id WHERE o.id = $1`, [off]);
      const { rows: bank } = await db.query<{ id: number }>(`SELECT id FROM question_banks WHERE course_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`, [course[0]!.course_id, `AI drafts — ${course[0]!.name}`]);
      const bankId = bank[0]?.id ?? (await db.query<{ id: number }>(`INSERT INTO question_banks (institution_id, course_id, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [inst, course[0]!.course_id, `AI drafts — ${course[0]!.name}`, userId])).rows[0]!.id;
      const ids: number[] = [];
      for (const x of q.questions) {
        const dataJson =
          x.type === 'mcq' ? { options: x.options ?? [], correct: String(x.correct) } : x.type === 'true_false' ? { correct: x.correct === true || x.correct === 'true' } : { accepted: x.accepted?.length ? x.accepted : [String(x.correct)], case_sensitive: false };
        if (x.type === 'mcq' && !(x.options ?? []).some((o) => o.id === String(x.correct))) throw badRequest(`A question's correct answer is not one of its options: ${x.prompt.slice(0, 60)}`);
        const { rows } = await db.query<{ id: number }>(
          `INSERT INTO questions (institution_id, bank_id, type, prompt_html, data, points, difficulty, tags, created_by) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8) RETURNING id`,
          [inst, bankId, x.type, cleanHtml(`<p>${x.prompt}</p>`), JSON.stringify(dataJson), x.difficulty, ['ai-generated', x.difficulty, ...(x.clo_code ? [x.clo_code] : [])], userId]
        );
        ids.push(rows[0]!.id);
        if (x.clo_code) {
          await db.query(
            `INSERT INTO outcome_alignments (institution_id, clo_id, target_type, target_id) SELECT $1, lo.id, 'question', $2 FROM learning_outcomes lo WHERE lo.course_id = $3 AND lo.code = $4 ON CONFLICT DO NOTHING`,
            [inst, rows[0]!.id, course[0]!.course_id, x.clo_code]
          );
        }
      }
      result = { bank_id: bankId, question_ids: ids };
      break;
    }
    case 'rubric': {
      const r = rubricSchema.parse(p);
      const { rows } = await db.query<{ id: number }>(`INSERT INTO rubrics (institution_id, offering_id, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [inst, off, r.title, userId]);
      for (const [i, c] of r.criteria.entries()) {
        await db.query(`INSERT INTO rubric_criteria (institution_id, rubric_id, title, description, position, levels) VALUES ($1,$2,$3,$4,$5,$6)`, [inst, rows[0]!.id, c.title, c.description, i, JSON.stringify(c.levels)]);
      }
      const input = await db.query<{ input: { assessment_id?: number } }>(`SELECT input FROM ai_actions WHERE id = $1`, [action.id]);
      const aid = input.rows[0]?.input.assessment_id;
      if (aid) await db.query(`UPDATE assessments SET rubric_id = $2 WHERE id = $1 AND offering_id = $3`, [aid, rows[0]!.id, off]);
      result = { rubric_id: rows[0]!.id };
      break;
    }
    case 'course_outline': {
      const o = outlineSchema.parse(p);
      if (!off) throw badRequest('An outline belongs to a course');
      const { rows: start } = await db.query<{ n: number }>(`SELECT COALESCE(max(position) + 1, 0)::int n FROM modules WHERE offering_id = $1`, [off]);
      const modules: number[] = [];
      for (const [i, m] of o.modules.entries()) {
        const { rows } = await db.query<{ id: number }>(`INSERT INTO modules (institution_id, offering_id, title, position, published) VALUES ($1,$2,$3,$4,false) RETURNING id`, [inst, off, m.title, start[0]!.n + i]);
        modules.push(rows[0]!.id);
        for (const [j, it] of m.items.entries()) {
          await db.query(`INSERT INTO content_items (institution_id, module_id, kind, title, body_html, completion, position, published) VALUES ($1,$2,'page',$3,$4,'view',$5,false)`, [inst, rows[0]!.id, it.title, cleanHtml(it.body), j]);
        }
      }
      result = { module_ids: modules };
      break;
    }
    case 'lesson_plan':
    case 'differentiate': {
      if (!off) throw badRequest('This belongs to a course');
      const page =
        action.kind === 'lesson_plan'
          ? (() => {
              const l = lessonSchema.parse(p);
              const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
              return {
                title: l.title,
                html: `<h2>Objectives</h2><ul>${l.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul><h2>Activities</h2><ol>${l.activities.map((a) => `<li><strong>${a.minutes} min</strong> — ${esc(a.activity)}</li>`).join('')}</ol><h2>Checking learning</h2><p>${esc(l.assessment)}</p><h2>Homework</h2><p>${esc(l.homework)}</p>`,
              };
            })()
          : differentiateSchema.parse(p);
      let { rows: mod } = await db.query<{ id: number }>(`SELECT id FROM modules WHERE offering_id = $1 AND title = $2 LIMIT 1`, [off, action.kind === 'lesson_plan' ? 'Lesson plans (teachers)' : 'Adapted material']);
      if (!mod[0]) mod = (await db.query<{ id: number }>(`INSERT INTO modules (institution_id, offering_id, title, position, published) VALUES ($1,$2,$3,(SELECT COALESCE(max(position)+1,0) FROM modules WHERE offering_id = $2),false) RETURNING id`, [inst, off, action.kind === 'lesson_plan' ? 'Lesson plans (teachers)' : 'Adapted material'])).rows;
      const { rows } = await db.query<{ id: number }>(
        `INSERT INTO content_items (institution_id, module_id, kind, title, body_html, completion, position, published) VALUES ($1,$2,'page',$3,$4,'view',(SELECT COALESCE(max(position)+1,0) FROM content_items WHERE module_id = $2),false) RETURNING id`,
        [inst, mod[0]!.id, page.title, cleanHtml(page.html)]
      );
      result = { content_item_id: rows[0]!.id, module_id: mod[0]!.id };
      break;
    }
    case 'feedback_draft':
    case 'grading': {
      const sid = Number(p.submission_id);
      const { rows: s } = await db.query<{ assessment_id: number; student_id: number | null }>(`SELECT assessment_id, student_id FROM submissions WHERE id = $1`, [sid]);
      if (!s[0]?.student_id) throw badRequest('Only individual submissions can take AI-assisted grades');
      let feedback: string;
      let points: number | null = null;
      let scores: Record<string, { points: number; comment: string }> | null = null;
      if (action.kind === 'feedback_draft') {
        const f = feedbackSchema.parse(p);
        feedback = `<p>${f.feedback}</p>${f.strengths.length ? `<p><strong>Strengths</strong></p><ul>${f.strengths.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}${f.next_steps.length ? `<p><strong>Next steps</strong></p><ul>${f.next_steps.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}`;
      } else {
        const g = p as { criteria: { criterion_id: number; points: number; reasoning: string }[]; feedback: string };
        const rubric = await rubricOf(s[0].assessment_id);
        scores = {};
        for (const c of rubric) {
          const x = g.criteria.find((y) => Number(y.criterion_id) === c.id);
          scores[String(c.id)] = { points: Math.min(c.max, Math.max(0, Number(x?.points ?? 0))), comment: String(x?.reasoning ?? '').slice(0, 1000) };
        }
        points = Object.values(scores).reduce((n, x) => n + x.points, 0);
        feedback = `<p>${String(g.feedback ?? '')}</p>`;
      }
      // a draft only: releasing it is a separate click by the teacher
      await db.query(
        `INSERT INTO grades (institution_id, assessment_id, student_id, points, feedback_html, rubric_scores, status, ai_assisted, graded_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'draft',true,now(),now())
         ON CONFLICT ON CONSTRAINT grades_assessment_id_student_id_key DO UPDATE SET points = COALESCE(EXCLUDED.points, grades.points), feedback_html = EXCLUDED.feedback_html,
           rubric_scores = COALESCE(EXCLUDED.rubric_scores, grades.rubric_scores), ai_assisted = true, updated_at = now()`,
        [inst, s[0].assessment_id, s[0].student_id, points, cleanHtml(feedback), scores ? JSON.stringify(scores) : null]
      );
      result = { assessment_id: s[0].assessment_id, student_id: s[0].student_id, released: false };
      break;
    }
    case 'report_comment': {
      const c = commentSchema.parse(p);
      const studentId = Number(p.student_id);
      await db.query(
        `INSERT INTO report_comments (institution_id, student_id, term_id, comment, ai_assisted, created_by) VALUES ($1,$2,$3,$4,true,$5)
         ON CONFLICT ON CONSTRAINT report_comments_student_id_term_id_key DO UPDATE SET comment = EXCLUDED.comment, ai_assisted = true, created_by = EXCLUDED.created_by, updated_at = now()`,
        [inst, studentId, p.term_id ?? null, c.comment, userId]
      );
      result = { student_id: studentId };
      break;
    }
    case 'guardian_message': {
      const m = guardianMessageSchema.parse(p);
      const { rows } = await db.query<{ user_id: number }>(
        `SELECT g.user_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE gs.student_id = $1 AND gs.can_message AND g.user_id IS NOT NULL`,
        [Number(p.student_id)]
      );
      if (!rows.length) throw badRequest('This student has no guardian with a portal account who can receive messages');
      await notify({ institutionId: inst, userIds: rows.map((r) => r.user_id), type: 'system', title: m.subject, message: m.body, link: '/notifications' });
      result = { sent_to: rows.length };
      break;
    }
    case 'bulk_action': {
      const b = p as { action: string; days: number | null; targets: { assessment_id: number }[] };
      const ids = (b.targets ?? []).map((t) => Number(t.assessment_id)).filter(Number.isInteger);
      if (!ids.length || b.action === 'none') throw badRequest('Nothing to do');
      // the targets were limited to the teacher's own work when proposed; check again
      const { rows: allowed } = await db.query<{ id: number }>(
        `SELECT a.id FROM assessments a WHERE a.id = ANY($1::int[]) AND a.institution_id = $2 AND (a.offering_id IN (SELECT ss.offering_id FROM section_staff ss JOIN users u ON u.ref_id = ss.teacher_id AND u.role = 'teacher' WHERE u.id = $3) OR $3 IN (SELECT id FROM users WHERE role = 'institution_admin'))`,
        [ids, inst, userId]
      );
      const ok = allowed.map((r) => r.id);
      if (b.action === 'extend_due_date') {
        await db.query(
          `UPDATE assessments SET due_at = due_at + make_interval(days => $2), available_until = CASE WHEN available_until IS NULL THEN NULL ELSE available_until + make_interval(days => $2) END, updated_at = now() WHERE id = ANY($1::int[])`,
          [ok, Number(b.days ?? 0)]
        );
      } else await db.query(`UPDATE assessments SET status = $2, updated_at = now() WHERE id = ANY($1::int[])`, [ok, b.action === 'publish' ? 'published' : 'draft']);
      result = { changed: ok.length };
      break;
    }
  }
  await db.query(`UPDATE ai_actions SET status = 'applied', applied = $2, result = $3, decided_by = $4, decided_at = now() WHERE id = $1`, [action.id, edited === undefined ? null : JSON.stringify(edited), JSON.stringify(result), userId]);
  return result;
}

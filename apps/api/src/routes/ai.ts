// The AI layer under /api/ai: settings, keys and the transparency / usage report (admins); the
// tutor (students) and its anonymous stuck points (teachers); the knowledge base; the help
// assistant; copilot proposals with approve / reject; learning-process evidence and the
// mini-viva; early warning with interventions; Ask Acadex; captions and translations.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  activityBody,
  aiSettingsBody,
  applyActionBody,
  askBody,
  copilotBody,
  helpBody,
  HELP_ARTICLES,
  id,
  interventionBody,
  interventionUpdateBody,
  optionalId,
  tutorMessageBody,
  tutorStartBody,
  vivaAnswerBody,
} from '@acadex/shared';
import { db } from '../db/context';
import { ask } from '../ai/ask';
import { aiJson, aiOverview, aiSettings, aiStatus, aiText, aiTranscribe, budget } from '../ai/client';
import { apply, COPILOT_KINDS, generate, type CopilotKind } from '../ai/copilot';
import { processReport, similarity } from '../ai/evidence';
import { moderate, refusal } from '../ai/guard';
import { indexOffering, searchHelp } from '../ai/kb';
import { FEATURE_KEYS, FEATURES, type Feature } from '../ai/models';
import { data, helpPrompt, interventionPrompt, vivaPrompt } from '../ai/prompts';
import { alertGuardians, computeRisk } from '../ai/risk';
import { stuckPoints, tutorReply } from '../ai/tutor';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { institutionTimeZone } from '../lib/institution';
import { assertCourseEditor, courseAccess } from '../lib/lms/access';
import { todayIn } from '../lib/locale';
import { notify } from '../lib/notify';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';
import { storage } from '../storage';

const router = Router();
const manage = requirePermission('ai.manage');

const auditAs = (req: Request, action: string, entity: string, detail: string) =>
  audit({ institutionId: institutionId(req), userId: currentUser(req).id, actor: currentUser(req).name, action, entity, detail });
const ctxOf = (req: Request, feature: Feature, offeringId?: number | null) => ({ institutionId: institutionId(req), userId: currentUser(req).id, feature, offeringId: offeringId ?? null });

// ---------------------------------------------------------------- settings, keys, transparency

router.get('/ai/status', async (req, res) => {
  const q = z.object({ feature: z.enum(FEATURE_KEYS as [Feature, ...Feature[]]), offering_id: optionalId }).parse(req.query);
  res.json(await aiStatus(ctxOf(req, q.feature, q.offering_id)));
});

router.get('/ai/settings', manage, async (req, res) => {
  const inst = institutionId(req);
  const [settings, overview, b] = await Promise.all([aiSettings(inst), aiOverview(inst), budget(inst)]);
  const { plan: _p, ...s } = settings;
  // the provider and model of each feature are chosen by the platform (read-only here)
  res.json({ settings: s, features: overview.map((o) => ({ ...o, label: FEATURES[o.feature as Feature] })), budget: { spent_usd: b.spent, cap_usd: b.cap } });
});

router.put('/ai/settings', manage, async (req, res) => {
  const b = aiSettingsBody.parse(req.body);
  await db.query(`UPDATE institutions SET settings = jsonb_set(settings, '{ai}', $2::jsonb) WHERE id = $1`, [institutionId(req), JSON.stringify(b)]);
  await auditAs(req, 'update', 'AiSettings', JSON.stringify(b));
  res.json(b);
});

router.get('/ai/usage', manage, async (req, res) => {
  const q = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }).parse(req.query);
  const inst = institutionId(req);
  const [byFeature, byDay, recent] = await Promise.all([
    db.query(
      `SELECT feature, provider, model, count(*)::int AS calls, sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens, sum(cost_usd)::float8 AS cost_usd,
              count(*) FILTER (WHERE status <> 'ok')::int AS failed
         FROM ai_usage WHERE institution_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY 1, 2, 3 ORDER BY cost_usd DESC`,
      [inst, q.days]
    ),
    db.query(`SELECT created_at::date AS day, count(*)::int AS calls, sum(cost_usd)::float8 AS cost_usd FROM ai_usage WHERE institution_id = $1 AND created_at > now() - make_interval(days => $2) GROUP BY 1 ORDER BY 1`, [inst, q.days]),
    db.query(
      `SELECT a.created_at, a.feature, a.provider, a.model, a.input_tokens, a.output_tokens, a.cost_usd::float8 AS cost_usd, a.status, a.latency_ms, u.full_name AS by
         FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id WHERE a.institution_id = $1 ORDER BY a.id DESC LIMIT 50`,
      [inst]
    ),
  ]);
  res.json({ by_feature: byFeature.rows, by_day: byDay.rows, recent: recent.rows });
});

/** A course's own AI switch (its teachers). */
router.patch('/courses/:id/ai', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const b = z.object({ ai_enabled: z.boolean() }).parse(req.body);
  await db.query(`UPDATE course_offerings SET ai_enabled = $2 WHERE id = $1`, [offeringId, b.ai_enabled]);
  await auditAs(req, 'course_ai', 'CourseOffering', `${offeringId}: ${b.ai_enabled ? 'on' : 'off'}`);
  res.json(b);
});

// ---------------------------------------------------------------- knowledge base

router.post('/ai/kb/reindex', async (req, res) => {
  const b = z.object({ offering_id: id }).parse(req.body);
  await assertCourseEditor(req, b.offering_id);
  res.json(await indexOffering(b.offering_id, institutionId(req)));
});

router.get('/ai/kb/status', async (req, res) => {
  const offeringId = id.parse(req.query.offering_id);
  const a = await courseAccess(currentUser(req), offeringId);
  if (a.role !== 'staff') throw forbidden();
  const { rows } = await db.query(
    `SELECT count(*)::int AS chunks, count(DISTINCT (source_type, source_id))::int AS sources, max(created_at) AS indexed_at FROM kb_chunks WHERE offering_id = $1`,
    [offeringId]
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------------- tutor

interface ConvRow {
  id: number;
  institution_id: number;
  user_id: number;
  student_id: number | null;
  offering_id: number;
  assessment_id: number | null;
  title: string;
}

async function myConversation(req: Request, convId: number): Promise<ConvRow> {
  const { rows } = await db.query<ConvRow>(`SELECT * FROM ai_conversations WHERE id = $1 AND institution_id = $2 AND user_id = $3 AND kind = 'tutor'`, [convId, institutionId(req), currentUser(req).id]);
  if (!rows[0]) throw notFound('Conversation not found');
  return rows[0];
}

router.post('/ai/tutor/conversations', requirePermission('learner.access'), async (req, res) => {
  const b = tutorStartBody.parse(req.body);
  const a = await courseAccess(currentUser(req), b.offering_id);
  if (a.role !== 'student') throw forbidden('The tutor is for students of this course');
  const st = await aiStatus(ctxOf(req, 'tutor', b.offering_id));
  if (!st.enabled) throw forbidden(st.reason, 'AI_OFF');
  if (b.assessment_id) {
    const { rows } = await db.query(`SELECT 1 FROM assessments WHERE id = $1 AND offering_id = $2 AND status = 'published'`, [b.assessment_id, b.offering_id]);
    if (!rows[0]) throw badRequest('That work is not in this course');
  }
  const { rows } = await db.query(
    `INSERT INTO ai_conversations (institution_id, user_id, kind, student_id, offering_id, assessment_id, title) VALUES ($1,$2,'tutor',$3,$4,$5,'') RETURNING id, offering_id, assessment_id, created_at`,
    [institutionId(req), currentUser(req).id, a.studentIds[0], b.offering_id, b.assessment_id]
  );
  res.status(201).json(rows[0]);
});

router.get('/ai/tutor/conversations', requirePermission('learner.access'), async (req, res) => {
  const offeringId = optionalId.parse(req.query.offering_id);
  const { rows } = await db.query(
    `SELECT c.id, c.offering_id, c.assessment_id, c.title, c.updated_at, co.name AS course, a.title AS assessment
       FROM ai_conversations c JOIN course_offerings o ON o.id = c.offering_id JOIN courses co ON co.id = o.course_id LEFT JOIN assessments a ON a.id = c.assessment_id
      WHERE c.user_id = $1 AND c.kind = 'tutor' AND ($2::int IS NULL OR c.offering_id = $2) ORDER BY c.updated_at DESC LIMIT 50`,
    [currentUser(req).id, offeringId]
  );
  res.json(rows);
});

router.get('/ai/tutor/conversations/:id', requirePermission('learner.access'), async (req, res) => {
  const c = await myConversation(req, id.parse(req.params.id));
  const { rows } = await db.query(`SELECT id, role, content, citations, flag, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY id`, [c.id]);
  const { rows: pol } = c.assessment_id ? await db.query(`SELECT title, ai_policy FROM assessments WHERE id = $1`, [c.assessment_id]) : { rows: [] };
  res.json({ ...c, assessment: pol[0] ?? null, messages: rows });
});

/** Ask the tutor; with Accept: text/event-stream the reply streams as it is written. */
router.post('/ai/tutor/conversations/:id/messages', requirePermission('learner.access'), async (req: Request, res: Response) => {
  const c = await myConversation(req, id.parse(req.params.id));
  const b = tutorMessageBody.parse(req.body);
  const streaming = String(req.headers.accept ?? '').includes('text/event-stream');
  if (streaming) {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
  }
  const send = (event: string, payload: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  const turn = await tutorReply(c, b.content, streaming ? (t) => send('delta', { text: t }) : undefined);
  const topic = turn.citations[0] ? (await db.query<{ source_type: string; source_id: number }>(`SELECT source_type, source_id FROM kb_chunks WHERE id = $1`, [turn.citations[0].chunk_id])).rows[0] : undefined;
  await db.query(`INSERT INTO ai_messages (institution_id, conversation_id, role, content, flag, topic_item_id) VALUES ($1,$2,'user',$3,$4,$5)`, [
    c.institution_id, c.id, b.content, turn.flag, topic && topic.source_type !== 'assessment' ? topic.source_id : null,
  ]);
  const { rows } = await db.query(`INSERT INTO ai_messages (institution_id, conversation_id, role, content, citations, flag) VALUES ($1,$2,'assistant',$3,$4,$5) RETURNING id, role, content, citations, flag, created_at`, [
    c.institution_id, c.id, turn.reply, JSON.stringify(turn.citations), turn.flag,
  ]);
  await db.query(`UPDATE ai_conversations SET updated_at = now(), title = CASE WHEN title = '' THEN left($2, 80) ELSE title END WHERE id = $1`, [c.id, b.content]);
  const message = { ...rows[0], ai_generated: true };
  if (!streaming) return void res.status(201).json(message);
  send('done', message);
  res.end();
});

router.get('/ai/tutor/stuck-points', async (req, res) => {
  const offeringId = id.parse(req.query.offering_id);
  const a = await courseAccess(currentUser(req), offeringId);
  if (a.role !== 'staff') throw forbidden();
  res.json(await stuckPoints(offeringId));
});

// ---------------------------------------------------------------- help assistant

router.get('/ai/help/articles', async (req, res) => {
  const role = currentUser(req).role;
  const r = role === 'institution_admin' || role === 'super_admin' || role === 'group_admin' ? 'admin' : role;
  res.json(HELP_ARTICLES.filter((a) => a.roles.includes(r as never)));
});

router.post('/ai/help', async (req, res) => {
  const b = helpBody.parse(req.body);
  const mod = moderate(b.question);
  if (mod.flagged) return void res.json({ answer: refusal(mod.flag!), citations: [], ai_generated: true });
  const found = (await searchHelp(b.question, 4)).filter((c) => c.score > 0.05);
  const citations = found.map((c, i) => ({ n: i + 1, title: c.title, locator: c.locator }));
  const out = await aiText(ctxOf(req, 'helpdesk'), helpPrompt, [{ role: 'user', content: `${data('HELP', found.map((c, i) => `[${i + 1}] ${c.title} — ${c.content}`).join('\n') || '(no matching article)')}\n\nQuestion: ${b.question}` }], { maxTokens: 400 });
  res.json({ answer: moderate(out.text).flagged ? refusal('off_topic') : out.text, citations, ai_generated: true });
});

// ---------------------------------------------------------------- copilot

async function assertCanCopilot(req: Request, kind: CopilotKind, b: z.infer<typeof copilotBody>): Promise<number | null> {
  let offeringId = b.offering_id ?? null;
  if (b.submission_id) {
    const { rows } = await db.query<{ offering_id: number }>(`SELECT a.offering_id FROM submissions s JOIN assessments a ON a.id = s.assessment_id WHERE s.id = $1 AND s.institution_id = $2`, [b.submission_id, institutionId(req)]);
    if (!rows[0]) throw notFound('Submission not found');
    offeringId = rows[0].offering_id;
  } else if (b.assessment_id) {
    const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM assessments WHERE id = $1 AND institution_id = $2`, [b.assessment_id, institutionId(req)]);
    if (!rows[0]) throw notFound('Assignment not found');
    offeringId = rows[0].offering_id;
  }
  if (offeringId) await assertCourseEditor(req, offeringId);
  else if (kind === 'report_comment' || kind === 'guardian_message') {
    if (!b.student_id) throw badRequest('Choose the student');
    const { rows } = await db.query(
      `SELECT 1 FROM students st WHERE st.id = $1 AND st.institution_id = $2 AND (EXISTS (SELECT 1 FROM section_staff ss WHERE ss.section_id = st.section_id AND ss.teacher_id = $3)
         OR EXISTS (SELECT 1 FROM sections sec WHERE sec.id = st.section_id AND sec.homeroom_teacher_id = $3))`,
      [b.student_id, institutionId(req), currentUser(req).ref_id ?? 0]
    );
    if (!rows[0] && !userCan(req, 'students.manage')) throw forbidden('Only the student\'s teachers can do this');
  } else if (!userCan(req, 'teaching.access') && !userCan(req, 'courses.manage_any')) throw forbidden();
  return offeringId;
}

router.post('/ai/copilot/:kind', async (req, res) => {
  const kind = z.enum(COPILOT_KINDS).parse(req.params.kind);
  const b = copilotBody.parse(req.body);
  const feature: Feature = kind === 'grading' ? 'grading' : 'copilot';
  const offeringId = await assertCanCopilot(req, kind, b);
  const action = await generate({ institutionId: institutionId(req), userId: currentUser(req).id, feature, offeringId }, kind, { ...b, offering_id: offeringId });
  res.status(201).json({ ...action, ai_generated: true });
});

router.get('/ai/actions', async (req, res) => {
  const q = z.object({ status: z.enum(['proposed', 'applied', 'rejected']).optional(), offering_id: optionalId }).parse(req.query);
  const { rows } = await db.query(
    `SELECT a.id, a.kind, a.status, a.offering_id, a.model, a.created_at, a.decided_at, co.name AS course FROM ai_actions a
       LEFT JOIN course_offerings o ON o.id = a.offering_id LEFT JOIN courses co ON co.id = o.course_id
      WHERE a.user_id = $1 AND ($2::text IS NULL OR a.status = $2) AND ($3::int IS NULL OR a.offering_id = $3) ORDER BY a.id DESC LIMIT 100`,
    [currentUser(req).id, q.status ?? null, q.offering_id]
  );
  res.json(rows);
});

async function myAction(req: Request, actionId: number) {
  const { rows } = await db.query(`SELECT * FROM ai_actions WHERE id = $1 AND institution_id = $2 AND user_id = $3`, [actionId, institutionId(req), currentUser(req).id]);
  if (!rows[0]) throw notFound('Proposal not found');
  return rows[0];
}

router.get('/ai/actions/:id', async (req, res) => {
  res.json({ ...(await myAction(req, id.parse(req.params.id))), ai_generated: true });
});

router.post('/ai/actions/:id/apply', async (req, res) => {
  const a = await myAction(req, id.parse(req.params.id));
  const b = applyActionBody.parse(req.body);
  // still allowed to change that course?
  if (a.offering_id) await assertCourseEditor(req, a.offering_id);
  const result = await apply(a, b.edited, currentUser(req).id).catch(async (e) => {
    if (e instanceof z.ZodError) throw badRequest('The edited proposal is not valid', e.issues);
    throw e;
  });
  await auditAs(req, 'apply_ai_action', 'AiAction', `${a.id} ${a.kind}${b.edited === undefined ? '' : ' (edited)'}`);
  res.json({ status: 'applied', result });
});

router.post('/ai/actions/:id/reject', async (req, res) => {
  const a = await myAction(req, id.parse(req.params.id));
  if (a.status !== 'proposed') throw conflict('This proposal was already decided', 'DECIDED');
  await db.query(`UPDATE ai_actions SET status = 'rejected', decided_by = $2, decided_at = now() WHERE id = $1`, [a.id, currentUser(req).id]);
  res.json({ status: 'rejected' });
});

// ---------------------------------------------------------------- learning-process evidence

/** The writing page reports active time and pastes now and then (adds up). */
router.put('/ai/activity/:assessmentId', requirePermission('submissions.create'), async (req, res) => {
  const aid = id.parse(req.params.assessmentId);
  const b = activityBody.parse(req.body);
  const sid = currentUser(req).ref_id;
  if (currentUser(req).role !== 'student' || !sid) throw forbidden();
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM assessments WHERE id = $1 AND institution_id = $2`, [aid, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if ((await courseAccess(currentUser(req), rows[0].offering_id)).role !== 'student') throw forbidden();
  await db.query(
    `INSERT INTO submission_activity (institution_id, assessment_id, student_id, active_seconds, keystrokes, pastes, pasted_chars, sessions) VALUES ($1,$2,$3,$4,$5,$6,$7,1)
     ON CONFLICT ON CONSTRAINT submission_activity_assessment_id_student_id_key DO UPDATE SET active_seconds = submission_activity.active_seconds + EXCLUDED.active_seconds,
       keystrokes = submission_activity.keystrokes + EXCLUDED.keystrokes, pastes = submission_activity.pastes + EXCLUDED.pastes,
       pasted_chars = submission_activity.pasted_chars + EXCLUDED.pasted_chars, sessions = submission_activity.sessions + CASE WHEN submission_activity.updated_at < now() - interval '30 minutes' THEN 1 ELSE 0 END, updated_at = now()`,
    [institutionId(req), aid, sid, b.active_seconds, b.keystrokes, b.pastes, b.pasted_chars]
  );
  res.status(204).end();
});

async function staffOfSubmission(req: Request, submissionId: number) {
  const { rows } = await db.query<{ offering_id: number; assessment_id: number; student_id: number | null }>(
    `SELECT a.offering_id, s.assessment_id, s.student_id FROM submissions s JOIN assessments a ON a.id = s.assessment_id WHERE s.id = $1 AND s.institution_id = $2`,
    [submissionId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('Submission not found');
  const a = await courseAccess(currentUser(req), rows[0].offering_id);
  if (a.role !== 'staff') throw forbidden();
  return rows[0];
}

router.get('/ai/evidence/submissions/:id', async (req, res) => {
  const sid = id.parse(req.params.id);
  await staffOfSubmission(req, sid);
  res.json(await processReport(sid));
});

router.get('/ai/evidence/assessments/:id/similarity', async (req, res) => {
  const aid = id.parse(req.params.id);
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM assessments WHERE id = $1 AND institution_id = $2`, [aid, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if ((await courseAccess(currentUser(req), rows[0].offering_id)).role !== 'staff') throw forbidden();
  res.json(await similarity(aid));
});

/** "Explain your work": questions from the student's own submission. */
router.post('/ai/evidence/submissions/:id/viva', async (req, res) => {
  const sid = id.parse(req.params.id);
  const s = await staffOfSubmission(req, sid);
  await assertCourseEditor(req, s.offering_id);
  const { rows: v } = await db.query<{ text_html: string }>(`SELECT text_html FROM submission_versions WHERE submission_id = $1 ORDER BY version DESC LIMIT 1`, [sid]);
  const text = (v[0]?.text_html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < 40) throw badRequest('The submission has too little text to ask about');
  const gen = await aiJson(ctxOf(req, 'evidence', s.offering_id), vivaPrompt, data('SUBMISSION', text.slice(0, 15000)));
  const { rows } = await db.query(`INSERT INTO viva_sessions (institution_id, submission_id, questions, created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [institutionId(req), sid, JSON.stringify(gen.data.questions), currentUser(req).id]);
  if (s.student_id) {
    const { rows: u } = await db.query<{ id: number }>(`SELECT id FROM users WHERE role = 'student' AND ref_id = $1`, [s.student_id]);
    await notify({ institutionId: institutionId(req), userIds: u.map((x) => x.id), type: 'grade_released', title: 'Explain your work', message: 'Your teacher asked a few questions about your submission.', link: '/learn/viva' });
  }
  res.status(201).json({ ...rows[0], ai_generated: true });
});

router.get('/ai/viva/mine', requirePermission('learner.access'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT v.id, v.questions, v.answers, v.status, v.created_at, a.title AS assessment FROM viva_sessions v JOIN submissions s ON s.id = v.submission_id JOIN assessments a ON a.id = s.assessment_id
      WHERE s.student_id = $1 AND v.institution_id = $2 ORDER BY v.id DESC LIMIT 20`,
    [currentUser(req).ref_id ?? 0, institutionId(req)]
  );
  res.json(rows);
});

router.post('/ai/viva/:id/answers', requirePermission('learner.access'), async (req, res) => {
  const b = vivaAnswerBody.parse(req.body);
  const { rows } = await db.query<{ id: number; status: string; questions: string[] }>(
    `SELECT v.id, v.status, v.questions FROM viva_sessions v JOIN submissions s ON s.id = v.submission_id WHERE v.id = $1 AND s.student_id = $2 AND v.institution_id = $3`,
    [id.parse(req.params.id), currentUser(req).ref_id ?? 0, institutionId(req)]
  );
  if (!rows[0]) throw notFound();
  if (rows[0].status !== 'open') throw conflict('Already answered', 'ANSWERED');
  await db.query(`UPDATE viva_sessions SET answers = $2, status = 'answered', answered_at = now() WHERE id = $1`, [rows[0].id, JSON.stringify(b.answers.slice(0, rows[0].questions.length))]);
  res.json({ status: 'answered' });
});

router.patch('/ai/viva/:id', async (req, res) => {
  const b = z.object({ teacher_note: z.string().max(2000) }).parse(req.body);
  const { rows } = await db.query<{ submission_id: number }>(`SELECT submission_id FROM viva_sessions WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rows[0]) throw notFound();
  await staffOfSubmission(req, rows[0].submission_id);
  await db.query(`UPDATE viva_sessions SET teacher_note = $2, status = 'reviewed' WHERE id = $1`, [id.parse(req.params.id), b.teacher_note]);
  res.json({ status: 'reviewed' });
});

// ---------------------------------------------------------------- early warning

/** Teachers see the students of their own classes; risk.read sees everyone. */
async function riskScope(req: Request): Promise<number[] | null> {
  if (userCan(req, 'risk.read')) return null;
  if (!userCan(req, 'teaching.access')) throw forbidden();
  const { rows } = await db.query<{ id: number }>(
    `SELECT DISTINCT sec.id FROM sections sec WHERE sec.institution_id = $1 AND (sec.homeroom_teacher_id = $2 OR sec.id IN (SELECT section_id FROM section_staff WHERE teacher_id = $2))`,
    [institutionId(req), currentUser(req).ref_id ?? 0]
  );
  return rows.map((r) => r.id);
}

router.get('/ai/risk', async (req, res) => {
  const scope = await riskScope(req);
  const q = z.object({ level: z.enum(['low', 'medium', 'high']).optional(), section_id: optionalId }).parse(req.query);
  const { rows } = await db.query(
    `SELECT DISTINCT ON (r.student_id) r.student_id, r.score, r.level, r.factors, r.computed_on, st.first_name || ' ' || st.last_name AS name, st.roll_no, sec.name AS section_name,
            (SELECT count(*)::int FROM interventions i WHERE i.student_id = r.student_id AND i.status = 'open') AS open_interventions
       FROM risk_scores r JOIN students st ON st.id = r.student_id LEFT JOIN sections sec ON sec.id = st.section_id
      WHERE r.institution_id = $1 AND ($2::int[] IS NULL OR st.section_id = ANY($2::int[])) AND ($3::int IS NULL OR st.section_id = $3)
      ORDER BY r.student_id, r.computed_on DESC`,
    [institutionId(req), scope, q.section_id]
  );
  const list = (rows as { level: string; score: number }[]).filter((r) => !q.level || r.level === q.level).sort((a, b) => b.score - a.score);
  res.json(list.slice(0, 500));
});

router.get('/ai/risk/students/:id', async (req, res) => {
  const sid = id.parse(req.params.id);
  const scope = await riskScope(req);
  const { rows: st } = await db.query<{ section_id: number | null; name: string }>(`SELECT section_id, first_name || ' ' || last_name AS name FROM students WHERE id = $1 AND institution_id = $2`, [sid, institutionId(req)]);
  if (!st[0]) throw notFound();
  if (scope && !scope.includes(st[0].section_id ?? -1)) throw forbidden();
  const [history, interventions] = await Promise.all([
    db.query(`SELECT computed_on, score, level, factors FROM risk_scores WHERE student_id = $1 ORDER BY computed_on DESC LIMIT 60`, [sid]),
    db.query(`SELECT i.*, u.full_name AS owner FROM interventions i LEFT JOIN users u ON u.id = i.owner_id WHERE i.student_id = $1 ORDER BY i.created_at DESC`, [sid]),
  ]);
  res.json({ student_id: sid, name: st[0].name, history: history.rows, interventions: interventions.rows });
});

router.post('/ai/risk/students/:id/suggest', async (req, res) => {
  const sid = id.parse(req.params.id);
  const scope = await riskScope(req);
  const { rows } = await db.query<{ factors: { label: string; value: string }[]; section_id: number | null }>(
    `SELECT r.factors, st.section_id FROM risk_scores r JOIN students st ON st.id = r.student_id WHERE r.student_id = $1 AND r.institution_id = $2 ORDER BY r.computed_on DESC LIMIT 1`,
    [sid, institutionId(req)]
  );
  if (!rows[0]) throw notFound('No risk score yet');
  if (scope && !scope.includes(rows[0].section_id ?? -1)) throw forbidden();
  const gen = await aiJson(ctxOf(req, 'risk'), interventionPrompt, data('FACTORS', rows[0].factors.map((f) => `${f.label}: ${f.value}`).join('\n') || 'no risk factors'));
  res.json({ ...gen.data, ai_generated: true });
});

router.post('/ai/risk/run', requirePermission('risk.manage'), async (req, res) => {
  const day = todayIn(await institutionTimeZone(institutionId(req)));
  res.json(await computeRisk(institutionId(req), day));
});

router.post('/ai/interventions', requireAny('risk.manage', 'teaching.access'), async (req, res) => {
  const b = interventionBody.parse(req.body);
  const scope = userCan(req, 'risk.manage') ? null : await riskScope(req);
  const { rows: st } = await db.query<{ section_id: number | null }>(`SELECT section_id FROM students WHERE id = $1 AND institution_id = $2`, [b.student_id, institutionId(req)]);
  if (!st[0]) throw badRequest('Student not found in this institution');
  if (scope && !scope.includes(st[0].section_id ?? -1)) throw forbidden();
  if (b.owner_id) {
    const { rows } = await db.query(`SELECT 1 FROM users WHERE id = $1 AND institution_id = $2 AND role NOT IN ('student', 'parent')`, [b.owner_id, institutionId(req)]);
    if (!rows[0]) throw badRequest('The owner must be a member of staff');
  }
  const { rows } = await db.query(
    `INSERT INTO interventions (institution_id, student_id, kind, note, owner_id, due_on, guardian_alerted, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [institutionId(req), b.student_id, b.kind, b.note, b.owner_id ?? currentUser(req).id, b.due_on, b.alert_guardian, currentUser(req).id]
  );
  if (b.alert_guardian) await alertGuardians(institutionId(req), b.student_id, '');
  res.status(201).json(rows[0]);
});

router.patch('/ai/interventions/:id', requireAny('risk.manage', 'teaching.access'), async (req, res) => {
  const b = interventionUpdateBody.parse(req.body);
  const { rows: cur } = await db.query<{ student_id: number; section_id: number | null }>(
    `SELECT i.student_id, st.section_id FROM interventions i JOIN students st ON st.id = i.student_id WHERE i.id = $1 AND i.institution_id = $2`,
    [id.parse(req.params.id), institutionId(req)]
  );
  if (!cur[0]) throw notFound();
  const scope = userCan(req, 'risk.manage') ? null : await riskScope(req);
  if (scope && !scope.includes(cur[0].section_id ?? -1)) throw forbidden();
  const { rows } = await db.query(
    `UPDATE interventions SET status = COALESCE($2, status), outcome = COALESCE($3, outcome), note = COALESCE($4, note), closed_at = CASE WHEN $2 IN ('done', 'cancelled') THEN now() ELSE closed_at END WHERE id = $1 RETURNING *`,
    [id.parse(req.params.id), b.status ?? null, b.outcome ?? null, b.note ?? null]
  );
  res.json(rows[0]);
});

// ---------------------------------------------------------------- Ask Acadex

router.post('/ai/ask', requireAny('ai.ask', 'teaching.access'), async (req, res) => {
  const b = askBody.parse(req.body);
  const scope = userCan(req, 'ai.ask') ? null : await riskScope(req);
  const out = await ask({ institutionId: institutionId(req), userId: currentUser(req).id }, b.question, scope);
  await auditAs(req, 'ask', 'AskAcadex', `${b.question.slice(0, 200)} → ${out.sql.slice(0, 300)}`);
  res.json({ ...out, ai_generated: true });
});

// ---------------------------------------------------------------- captions and translation

async function fileInMyCourse(req: Request, fileId: number, edit: boolean) {
  const { rows } = await db.query<{ offering_id: number; storage_key: string; content_type: string; original_name: string }>(
    `SELECT m.offering_id, f.storage_key, f.content_type, f.original_name FROM files f JOIN content_items i ON i.file_id = f.id JOIN modules m ON m.id = i.module_id
      WHERE f.id = $1 AND f.institution_id = $2 AND m.offering_id IS NOT NULL LIMIT 1`,
    [fileId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('That file is not in a course');
  if (edit) await assertCourseEditor(req, rows[0].offering_id);
  else await courseAccess(currentUser(req), rows[0].offering_id);
  return rows[0];
}

router.post('/ai/captions/:fileId', async (req, res) => {
  const fileId = id.parse(req.params.fileId);
  const f = await fileInMyCourse(req, fileId, true);
  if (!/^(audio|video)\//.test(f.content_type)) throw badRequest('Captions are for audio and video files');
  // captions are in English
  const t = await aiTranscribe({ institutionId: institutionId(req), userId: currentUser(req).id, offeringId: f.offering_id }, await storage().get(f.storage_key), f.original_name, 'en');
  const { rows } = await db.query(
    `INSERT INTO media_transcripts (institution_id, file_id, language, text, vtt, status) VALUES ($1,$2,$3,$4,$5,'done')
     ON CONFLICT ON CONSTRAINT media_transcripts_file_id_language_key DO UPDATE SET text = EXCLUDED.text, vtt = EXCLUDED.vtt, status = 'done', updated_at = now() RETURNING id, language, status`,
    [institutionId(req), fileId, 'en', t.text, t.vtt]
  );
  // the transcript becomes searchable course material for the tutor
  await indexOffering(f.offering_id, institutionId(req));
  res.status(201).json({ ...rows[0], ai_generated: true });
});


router.get('/ai/captions/:fileId', async (req, res) => {
  const fileId = id.parse(req.params.fileId);
  await fileInMyCourse(req, fileId, false);
  const { rows } = await db.query(`SELECT language, status, updated_at FROM media_transcripts WHERE file_id = $1 AND language = 'en'`, [fileId]);
  res.json(rows);
});

router.get('/ai/captions/:fileId/:language.vtt', async (req, res) => {
  const fileId = id.parse(req.params.fileId);
  await fileInMyCourse(req, fileId, false);
  const { rows } = await db.query<{ vtt: string }>(`SELECT vtt FROM media_transcripts WHERE file_id = $1 AND language = $2 AND status = 'done'`, [fileId, z.literal('en').parse(req.params.language)]);
  if (!rows[0]) throw notFound();
  res.type('text/vtt').send(rows[0].vtt);
});

export default router;

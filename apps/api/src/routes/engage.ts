// Engagement and communication: course discussions (with Q&A mode and moderation),
// announcements by scope, polls, surveys and course evaluations (anonymous), live classes
// (Jitsi / Zoom / Meet / Teams links with join logging → attendance), my calendar and its ICS
// feed, course certificates, badges, points and the leaderboard. Mounted under /api.
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  announcementBody,
  awardBody,
  badgeBody,
  courseCertificateBody,
  discussionBody,
  discussionPatch,
  id,
  patchSchema,
  institutionSettings,
  isoDate,
  liveSessionBody,
  moderateBody,
  pollBody,
  postBody,
  surveyBody,
  surveyResponseBody,
  voteBody,
} from '@acadex/shared';
import { getConfig } from '../config';
import { canCreate, createMeeting, markLiveAttendance, type Meeting } from '../lib/live';
import { db, withTransaction } from '../db/context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cleanHtml, htmlToText } from '../lib/html';
import { institutionTimeZone } from '../lib/institution';
import { assertCourseEditor, assertCourseMember, courseAccess, guardianUserIds, rosterSql, rosterUserIds, staffUserIds } from '../lib/lms/access';
import { maybeIssueCertificate } from '../lib/lms/rewards';
import { todayIn } from '../lib/locale';
import { notify } from '../lib/notify';
import { softDelete } from '../lib/soft-delete';
import { campusClause, campusesFor } from '../lib/structure';
import { currentUser, institutionId, requireAny, requirePermission, userCan } from '../middleware/auth';

const router = Router();

// ---------------------------------------------------------------- discussions

router.get('/courses/:id/discussions', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseMember(req, offeringId);
  const { rows } = await db.query(
    `SELECT d.id, d.title, d.mode, d.locked, d.pinned, d.created_at, u.full_name AS author,
            (SELECT count(*)::int FROM discussion_posts p WHERE p.discussion_id = d.id AND NOT p.hidden) AS posts,
            (SELECT max(p.created_at) FROM discussion_posts p WHERE p.discussion_id = d.id) AS last_post_at
       FROM discussions d LEFT JOIN users u ON u.id = d.created_by WHERE d.offering_id = $1 ORDER BY d.pinned DESC, COALESCE((SELECT max(p.created_at) FROM discussion_posts p WHERE p.discussion_id = d.id), d.created_at) DESC`,
    [offeringId]
  );
  res.json(rows);
});

router.post('/courses/:id/discussions', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseMember(req, offeringId);
  if (a.role === 'guardian') throw forbidden();
  const b = discussionBody.parse(req.body);
  // students may start open discussions; Q&A mode and pinning are for staff
  if (a.role !== 'staff' && (b.mode === 'qa' || b.pinned)) throw forbidden('Only staff can start Q&A discussions or pin them');
  const { rows } = await db.query(
    `INSERT INTO discussions (institution_id, offering_id, title, body_html, mode, pinned, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [institutionId(req), offeringId, b.title, cleanHtml(b.body_html), b.mode, b.pinned, currentUser(req).id]
  );
  if (a.role === 'staff') {
    await notify({ institutionId: institutionId(req), userIds: await rosterUserIds(offeringId), type: 'discussion_reply', title: `New discussion in ${a.course.name}: ${b.title}`, link: `/learn/courses/${offeringId}/discussions/${rows[0].id}` });
  }
  res.status(201).json(rows[0]);
});

async function discussionFor(req: Request, discussionId: number) {
  const { rows } = await db.query<{ id: number; offering_id: number; mode: string; locked: boolean; created_by: number | null; title: string }>(
    `SELECT id, offering_id, mode, locked, created_by, title FROM discussions WHERE id = $1 AND institution_id = $2`,
    [discussionId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('Discussion not found');
  return { d: rows[0], access: await assertCourseMember(req, rows[0].offering_id) };
}

router.get('/discussions/:id', async (req, res) => {
  const { d, access } = await discussionFor(req, id.parse(req.params.id));
  const u = currentUser(req);
  const staff = access.role === 'staff';
  const { rows: full } = await db.query(`SELECT d.*, u.full_name AS author FROM discussions d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = $1`, [d.id]);
  // Q&A: a student sees the others' answers only after posting their own
  let hiddenUntilPost = false;
  if (d.mode === 'qa' && !staff) {
    const { rows } = await db.query(`SELECT 1 FROM discussion_posts WHERE discussion_id = $1 AND author_id = $2 LIMIT 1`, [d.id, u.id]);
    hiddenUntilPost = !rows[0];
  }
  const { rows: posts } = await db.query(
    `SELECT p.id, p.parent_id, p.body_html, p.hidden, p.created_at, p.updated_at, p.author_id, u.full_name AS author, u.role AS author_role
       FROM discussion_posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.discussion_id = $1 AND ($2 OR NOT p.hidden OR p.author_id = $3) AND (NOT $4 OR p.author_id = $3 OR u.role <> 'student')
      ORDER BY p.created_at`,
    [d.id, staff, u.id, hiddenUntilPost]
  );
  res.json({ ...full[0], can_moderate: staff && access.canEdit, hidden_until_post: hiddenUntilPost, posts });
});

router.patch('/discussions/:id', async (req, res) => {
  const { d, access } = await discussionFor(req, id.parse(req.params.id));
  const isAuthor = d.created_by === currentUser(req).id;
  if (!(access.role === 'staff' && access.canEdit) && !isAuthor) throw forbidden();
  const b = discussionPatch.parse(req.body);
  if (access.role !== 'staff' && (b.locked !== undefined || b.pinned !== undefined || b.mode !== undefined)) throw forbidden('Only staff can lock, pin or change the mode');
  const { rows } = await db.query(
    `UPDATE discussions SET title = COALESCE($2, title), body_html = COALESCE($3, body_html), mode = COALESCE($4, mode), pinned = COALESCE($5, pinned), locked = COALESCE($6, locked) WHERE id = $1 RETURNING *`,
    [d.id, b.title ?? null, b.body_html === undefined ? null : cleanHtml(b.body_html), b.mode ?? null, b.pinned ?? null, b.locked ?? null]
  );
  res.json(rows[0]);
});

router.delete('/discussions/:id', async (req, res) => {
  const { d, access } = await discussionFor(req, id.parse(req.params.id));
  if (!(access.role === 'staff' && access.canEdit) && d.created_by !== currentUser(req).id) throw forbidden();
  await softDelete('discussions', d.id, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

router.post('/discussions/:id/posts', async (req, res) => {
  const { d, access } = await discussionFor(req, id.parse(req.params.id));
  if (access.role === 'guardian') throw forbidden();
  if (d.locked && access.role !== 'staff') throw conflict('This discussion is locked', 'LOCKED');
  const b = postBody.parse(req.body);
  const body = cleanHtml(b.body_html);
  if (!htmlToText(body)) throw badRequest('Write something first');
  if (b.parent_id) {
    const { rows } = await db.query(`SELECT 1 FROM discussion_posts WHERE id = $1 AND discussion_id = $2`, [b.parent_id, d.id]);
    if (!rows[0]) throw badRequest('You can only reply to posts in this discussion');
  }
  const u = currentUser(req);
  const { rows } = await db.query(`INSERT INTO discussion_posts (institution_id, discussion_id, parent_id, author_id, body_html) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [
    institutionId(req), d.id, b.parent_id, u.id, body,
  ]);
  // whoever is being answered hears about it
  const { rows: parent } = b.parent_id ? await db.query<{ author_id: number }>(`SELECT author_id FROM discussion_posts WHERE id = $1`, [b.parent_id]) : { rows: [] };
  const to = [parent[0]?.author_id ?? d.created_by].filter((x): x is number => !!x && x !== u.id);
  if (access.role === 'student' && d.mode === 'qa') to.push(...(await staffUserIds(d.offering_id)));
  await notify({ institutionId: institutionId(req), userIds: to, type: 'discussion_reply', title: `${u.name} replied in “${d.title}”`, message: htmlToText(body, 140), link: `/learn/courses/${d.offering_id}/discussions/${d.id}` });
  res.status(201).json(rows[0]);
});

router.patch('/posts/:id', async (req, res) => {
  const postId = id.parse(req.params.id);
  const { rows } = await db.query<{ author_id: number | null; discussion_id: number }>(`SELECT author_id, discussion_id FROM discussion_posts WHERE id = $1 AND institution_id = $2`, [postId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if (rows[0].author_id !== currentUser(req).id) throw forbidden('You can only edit your own posts');
  await discussionFor(req, rows[0].discussion_id);
  const b = postBody.parse(req.body);
  const { rows: out } = await db.query(`UPDATE discussion_posts SET body_html = $2, updated_at = now() WHERE id = $1 RETURNING *`, [postId, cleanHtml(b.body_html)]);
  res.json(out[0]);
});

router.post('/posts/:id/moderate', async (req, res) => {
  const postId = id.parse(req.params.id);
  const { rows } = await db.query<{ discussion_id: number }>(`SELECT discussion_id FROM discussion_posts WHERE id = $1 AND institution_id = $2`, [postId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  const { access } = await discussionFor(req, rows[0].discussion_id);
  if (access.role !== 'staff' || !access.canEdit) throw forbidden();
  const b = moderateBody.parse(req.body);
  await db.query(`UPDATE discussion_posts SET hidden = $2, hidden_by = CASE WHEN $2 THEN $3::int END WHERE id = $1`, [postId, b.hidden, currentUser(req).id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- announcements by scope

/** Announcements for me: the whole institution, my campus, my section, my courses. */
router.get('/announcements', requireAny('announcements.view', 'announcements.read'), async (req, res) => {
  const u = currentUser(req);
  const s = institutionId(req);
  const audience = { teacher: ['All', 'Teachers'], student: ['All', 'Students'], parent: ['All', 'Parents', 'Students'] }[u.role as 'teacher'] ?? ['All', 'Teachers', 'Students', 'Parents'];
  const offeringId = req.query.offering_id ? id.parse(req.query.offering_id) : null;
  if (offeringId) await assertCourseMember(req, offeringId);
  // the sections, campuses and courses that concern this person
  const { rows: ctx } = await db.query<{ sections: number[]; campuses: number[]; offerings: number[] }>(
    u.role === 'student'
      ? `SELECT ARRAY[st.section_id] AS sections, ARRAY[sec.campus_id] AS campuses, ARRAY(SELECT o.id FROM course_offerings o WHERE st.id IN (${rosterSql('o.id')})) AS offerings
           FROM students st LEFT JOIN sections sec ON sec.id = st.section_id WHERE st.id = $1`
      : u.role === 'teacher'
        ? `SELECT ARRAY(SELECT section_id FROM section_staff WHERE teacher_id = $1 UNION SELECT id FROM sections WHERE homeroom_teacher_id = $1) AS sections,
                  ARRAY[(SELECT campus_id FROM teachers WHERE id = $1)] AS campuses, ARRAY(SELECT offering_id FROM section_staff WHERE teacher_id = $1) AS offerings`
        : u.role === 'parent'
          ? `SELECT ARRAY(SELECT st.section_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id WHERE g.user_id = $1) AS sections,
                    ARRAY(SELECT sec.campus_id FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id JOIN students st ON st.id = gs.student_id JOIN sections sec ON sec.id = st.section_id WHERE g.user_id = $1) AS campuses,
                    ARRAY[]::int[] AS offerings`
          : `SELECT NULL::int[] AS sections, NULL::int[] AS campuses, NULL::int[] AS offerings WHERE $1::int IS NULL OR TRUE`,
    u.role === 'parent' ? [u.id] : [u.ref_id]
  );
  const c = ctx[0] ?? { sections: null, campuses: null, offerings: null };
  const everything = c.sections === null; // administrators see every announcement
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.description, a.target_audience, a.start_date, a.end_date, a.created_at, a.campus_id, a.section_id, a.offering_id, u.full_name AS author,
            cm.name AS campus_name, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name, co.name AS course_name
       FROM announcements a LEFT JOIN users u ON u.id = a.created_by
       LEFT JOIN campuses cm ON cm.id = a.campus_id LEFT JOIN sections sec ON sec.id = a.section_id
       LEFT JOIN course_offerings o ON o.id = a.offering_id LEFT JOIN courses co ON co.id = o.course_id
      WHERE a.institution_id = $1 AND (a.target_audience = ANY($2) OR $3)
        AND (a.start_date IS NULL OR a.start_date <= (now() AT TIME ZONE 'UTC')::date + 1) AND (a.end_date IS NULL OR a.end_date >= (now() AT TIME ZONE 'UTC')::date - 1)
        AND ($7::int IS NULL OR a.offering_id = $7)
        AND ($3 OR ((a.campus_id IS NULL OR a.campus_id = ANY($4::int[])) AND (a.section_id IS NULL OR a.section_id = ANY($5::int[])) AND (a.offering_id IS NULL OR a.offering_id = ANY($6::int[]))))
      ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
    [s, audience, everything, c.campuses ?? [], c.sections ?? [], c.offerings ?? [], offeringId]
  );
  res.json(rows);
});

/** Post an announcement: administrators to any scope (within their campuses), teachers to their courses. */
router.post('/announcements', async (req, res) => {
  const b = announcementBody.parse(req.body);
  const s = institutionId(req);
  const u = currentUser(req);
  const admin = userCan(req, 'announcements.manage');
  if (!admin) {
    if (!b.offering_id) throw forbidden('Teachers post announcements to a course they teach');
    await assertCourseEditor(req, b.offering_id);
  } else {
    const scope = campusesFor(req, 'announcements.manage');
    if (scope && !b.campus_id && !b.section_id && !b.offering_id) throw forbidden('You can announce to your campuses only');
    if (scope && b.campus_id && !scope.includes(b.campus_id)) throw forbidden('This campus is not yours');
  }
  for (const [t, v] of [['campuses', b.campus_id], ['sections', b.section_id], ['course_offerings', b.offering_id]] as const) {
    if (!v) continue;
    const { rows } = await db.query(`SELECT 1 FROM ${t} WHERE id = $1 AND institution_id = $2`, [v, s]);
    if (!rows[0]) throw badRequest('Not found in this institution', { [t]: v });
  }
  const { rows } = await db.query(
    `INSERT INTO announcements (institution_id, title, target_audience, description, start_date, end_date, campus_id, section_id, offering_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [s, b.title, b.target_audience, b.description, b.start_date, b.end_date, b.campus_id, b.section_id, b.offering_id, u.id]
  );
  if (b.notify) {
    // who it reaches
    const roles = { All: ['teacher', 'student', 'parent'], Teachers: ['teacher'], Students: ['student'], Parents: ['parent'] }[b.target_audience];
    let users: number[];
    if (b.offering_id) {
      const studentUsers = roles.includes('student') ? await rosterUserIds(b.offering_id) : [];
      const roster = (await db.query<{ id: number }>(`SELECT id FROM (${rosterSql('$1')}) r`, [b.offering_id])).rows.map((r) => r.id);
      users = [...studentUsers, ...(roles.includes('parent') ? await guardianUserIds(roster) : []), ...(roles.includes('teacher') ? await staffUserIds(b.offering_id) : [])];
    } else {
      const params: unknown[] = [s, roles];
      const campus = b.campus_id ? campusClause([b.campus_id], `COALESCE(sec.campus_id, t.campus_id, psec.campus_id)`, params) : '';
      const section = b.section_id ? (params.push(b.section_id), ` AND COALESCE(st.section_id, pst.section_id) = $${params.length}`) : '';
      const { rows: r } = await db.query<{ id: number }>(
        `SELECT DISTINCT u.id FROM users u
           LEFT JOIN students st ON u.role = 'student' AND st.id = u.ref_id LEFT JOIN sections sec ON sec.id = st.section_id
           LEFT JOIN teachers t ON u.role = 'teacher' AND t.id = u.ref_id
           LEFT JOIN guardians g ON u.role = 'parent' AND g.user_id = u.id LEFT JOIN guardianships gs ON gs.guardian_id = g.id
           LEFT JOIN students pst ON pst.id = gs.student_id LEFT JOIN sections psec ON psec.id = pst.section_id
          WHERE u.institution_id = $1 AND u.is_active AND u.role = ANY($2)${campus}${section}`,
        params
      );
      users = r.map((x) => x.id);
    }
    await notify({ institutionId: s, userIds: users.filter((x) => x !== u.id), type: 'announcement', title: b.title, message: b.description.slice(0, 300), link: '/announcements', dedupeKey: `ann:${rows[0].id}` });
  }
  res.status(201).json(rows[0]);
});

router.delete('/announcements/:id', async (req, res) => {
  const annId = id.parse(req.params.id);
  const { rows } = await db.query<{ offering_id: number | null; created_by: number | null }>(`SELECT offering_id, created_by FROM announcements WHERE id = $1 AND institution_id = $2`, [annId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if (!userCan(req, 'announcements.manage')) {
    if (!rows[0].offering_id || rows[0].created_by !== currentUser(req).id) throw forbidden();
  }
  await db.query(`DELETE FROM announcements WHERE id = $1`, [annId]);
  res.status(204).end();
});

// ---------------------------------------------------------------- polls

router.get('/courses/:id/polls', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseMember(req, offeringId);
  const { rows } = await db.query(
    `SELECT p.*, (SELECT choices FROM poll_votes v WHERE v.poll_id = p.id AND v.user_id = $2) AS my_choices,
            (SELECT count(*)::int FROM poll_votes v WHERE v.poll_id = p.id) AS votes
       FROM polls p WHERE p.offering_id = $1 ORDER BY p.created_at DESC`,
    [offeringId, currentUser(req).id]
  );
  res.json(rows);
});

router.post('/polls', async (req, res) => {
  const b = pollBody.parse(req.body);
  if (b.offering_id) await assertCourseEditor(req, b.offering_id);
  else if (!userCan(req, 'announcements.manage')) throw forbidden();
  const { rows } = await db.query(
    `INSERT INTO polls (institution_id, offering_id, question, options, multiple, anonymous, closes_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [institutionId(req), b.offering_id, b.question, JSON.stringify(b.options), b.multiple, b.anonymous, b.closes_at, currentUser(req).id]
  );
  res.status(201).json(rows[0]);
});

async function pollFor(req: Request, pollId: number) {
  const { rows } = await db.query<{ id: number; offering_id: number | null; options: string[]; multiple: boolean; anonymous: boolean; closes_at: Date | null; created_by: number | null }>(
    `SELECT id, offering_id, options, multiple, anonymous, closes_at, created_by FROM polls WHERE id = $1 AND institution_id = $2`,
    [pollId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('Poll not found');
  const access = rows[0].offering_id ? await assertCourseMember(req, rows[0].offering_id) : null;
  return { p: rows[0], access };
}

router.post('/polls/:id/vote', async (req, res) => {
  const { p, access } = await pollFor(req, id.parse(req.params.id));
  if (access?.role === 'guardian') throw forbidden();
  if (p.closes_at && p.closes_at < new Date()) throw conflict('This poll has closed', 'CLOSED');
  const { choices } = voteBody.parse(req.body);
  const uniq = [...new Set(choices)];
  if (!p.multiple && uniq.length > 1) throw badRequest('Choose one answer');
  if (uniq.some((c) => c >= p.options.length)) throw badRequest('Unknown answer');
  await db.query(`INSERT INTO poll_votes (poll_id, user_id, institution_id, choices) VALUES ($1,$2,$3,$4) ON CONFLICT ON CONSTRAINT poll_votes_pkey DO UPDATE SET choices = EXCLUDED.choices`, [
    p.id, currentUser(req).id, institutionId(req), uniq,
  ]);
  res.json({ ok: true });
});

router.get('/polls/:id/results', async (req, res) => {
  const { p, access } = await pollFor(req, id.parse(req.params.id));
  const staff = access ? access.role === 'staff' : userCan(req, 'announcements.manage');
  const { rows } = await db.query<{ choices: number[]; name: string | null }>(
    `SELECT v.choices, ${p.anonymous ? 'NULL' : 'u.full_name'} AS name FROM poll_votes v JOIN users u ON u.id = v.user_id WHERE v.poll_id = $1`,
    [p.id]
  );
  const counts = p.options.map((label, i) => ({ label, votes: rows.filter((r) => r.choices.includes(i)).length }));
  res.json({ options: counts, total: rows.length, voters: staff && !p.anonymous ? rows : undefined });
});

// ---------------------------------------------------------------- surveys & evaluations

/** Surveys I can answer (open, for my audience) and, for staff, the ones I run. */
router.get('/surveys', async (req, res) => {
  const u = currentUser(req);
  const audience = { student: 'students', teacher: 'staff', parent: 'guardians' }[u.role as 'student'] ?? 'staff';
  const manage = userCan(req, 'surveys.manage');
  const { rows } = await db.query(
    `SELECT s.id, s.title, s.description, s.anonymous, s.audience, s.status, s.opens_at, s.closes_at, s.offering_id, c.name AS course,
            EXISTS (SELECT 1 FROM survey_responses r WHERE r.survey_id = s.id AND r.respondent_hash = encode(sha256((s.id || ':' || $3::text)::bytea), 'hex')) AS answered,
            (SELECT count(*)::int FROM survey_responses r WHERE r.survey_id = s.id) AS responses
       FROM surveys s LEFT JOIN course_offerings o ON o.id = s.offering_id LEFT JOIN courses c ON c.id = o.course_id
      WHERE s.institution_id = $1 AND ($4 OR s.created_by = $3::int OR (s.status = 'open' AND s.audience IN ($2, 'everyone')
            AND (s.opens_at IS NULL OR s.opens_at <= now()) AND (s.closes_at IS NULL OR s.closes_at > now())))
      ORDER BY s.created_at DESC`,
    [institutionId(req), audience, u.id, manage]
  );
  // a course evaluation is only for the people in that course
  const visible: typeof rows = [];
  for (const r of rows) {
    if (manage || !r.offering_id || r.audience === 'staff') visible.push(r);
    else if (await courseAccess(u, r.offering_id).then(() => true, () => false)) visible.push(r);
  }
  res.json(visible);
});

router.post('/surveys', async (req, res) => {
  const b = surveyBody.parse(req.body);
  if (b.offering_id) await assertCourseEditor(req, b.offering_id).catch(async (e) => {
    if (!userCan(req, 'surveys.manage')) throw e;
  });
  else if (!userCan(req, 'surveys.manage')) throw forbidden();
  if (new Set(b.questions.map((q) => q.id)).size !== b.questions.length) throw badRequest('Each question needs its own id');
  const { rows } = await db.query(
    `INSERT INTO surveys (institution_id, offering_id, title, description, anonymous, questions, audience, status, opens_at, closes_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [institutionId(req), b.offering_id, b.title, b.description, b.anonymous, JSON.stringify(b.questions), b.audience, b.status, b.opens_at, b.closes_at, currentUser(req).id]
  );
  res.status(201).json(rows[0]);
});

async function surveyFor(req: Request, surveyId: number) {
  const { rows } = await db.query<{ id: number; offering_id: number | null; anonymous: boolean; questions: { id: string; kind: string; required: boolean; options?: string[]; label: string }[]; audience: string; status: string; opens_at: Date | null; closes_at: Date | null; created_by: number | null; title: string }>(
    `SELECT * FROM surveys WHERE id = $1 AND institution_id = $2`,
    [surveyId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('Survey not found');
  return rows[0];
}
const canManageSurvey = (req: Request, sv: { created_by: number | null }) => userCan(req, 'surveys.manage') || sv.created_by === currentUser(req).id;

router.get('/surveys/:id', async (req, res) => {
  const sv = await surveyFor(req, id.parse(req.params.id));
  if (!canManageSurvey(req, sv) && sv.status !== 'open') throw notFound('Survey not found');
  if (sv.offering_id && !canManageSurvey(req, sv)) await assertCourseMember(req, sv.offering_id);
  res.json(sv);
});

router.patch('/surveys/:id', async (req, res) => {
  const sv = await surveyFor(req, id.parse(req.params.id));
  if (!canManageSurvey(req, sv)) throw forbidden();
  const b = patchSchema(surveyBody.shape).parse(req.body);
  const { rows: answered } = await db.query(`SELECT 1 FROM survey_responses WHERE survey_id = $1 LIMIT 1`, [sv.id]);
  if (answered[0] && b.questions) throw conflict('People have answered; the questions can no longer change', 'HAS_RESPONSES');
  const { rows } = await db.query(
    `UPDATE surveys SET title = COALESCE($2, title), description = COALESCE($3, description), status = COALESCE($4, status), closes_at = CASE WHEN $5 THEN $6 ELSE closes_at END,
            questions = COALESCE($7, questions) WHERE id = $1 RETURNING *`,
    [sv.id, b.title ?? null, b.description ?? null, b.status ?? null, b.closes_at !== undefined, b.closes_at ?? null, b.questions ? JSON.stringify(b.questions) : null]
  );
  res.json(rows[0]);
});

router.post('/surveys/:id/responses', async (req, res) => {
  const sv = await surveyFor(req, id.parse(req.params.id));
  const u = currentUser(req);
  const audience = { student: 'students', teacher: 'staff', parent: 'guardians' }[u.role as 'student'];
  if (sv.status !== 'open' || (sv.closes_at && sv.closes_at < new Date()) || (sv.opens_at && sv.opens_at > new Date())) throw conflict('This survey is not open', 'CLOSED');
  if (sv.audience !== 'everyone' && sv.audience !== audience) throw forbidden('This survey is not for you');
  if (sv.offering_id && sv.audience !== 'staff') await assertCourseMember(req, sv.offering_id);
  const { answers } = surveyResponseBody.parse(req.body);
  for (const q of sv.questions) {
    const v = answers[q.id];
    if (q.required && (v == null || v === '')) throw badRequest(`Answer “${q.label}”`, { [q.id]: 'required' });
    if (v == null) continue;
    if (q.kind === 'rating' && !(typeof v === 'number' && v >= 1 && v <= 5)) throw badRequest(`“${q.label}” takes a rating from 1 to 5`);
    if (q.kind === 'choice' && !(typeof v === 'number' && v >= 0 && v < (q.options?.length ?? 0))) throw badRequest(`Choose an option for “${q.label}”`);
  }
  const clean = Object.fromEntries(sv.questions.map((q) => [q.id, answers[q.id] ?? null]));
  // the hash stops a second answer without recording who answered an anonymous survey
  const hash = crypto.createHash('sha256').update(`${sv.id}:${u.id}`).digest('hex');
  try {
    await db.query(`INSERT INTO survey_responses (institution_id, survey_id, respondent_id, respondent_hash, answers) VALUES ($1,$2,$3,$4,$5)`, [
      institutionId(req), sv.id, sv.anonymous ? null : u.id, hash, JSON.stringify(clean),
    ]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('You have already answered this survey', 'ANSWERED');
    throw e;
  }
  res.status(201).json({ ok: true });
});

router.get('/surveys/:id/results', async (req, res) => {
  const sv = await surveyFor(req, id.parse(req.params.id));
  if (!canManageSurvey(req, sv)) {
    // a teacher sees their own course's evaluation only once it has closed
    if (!sv.offering_id || sv.status !== 'closed') throw forbidden();
    await assertCourseEditor(req, sv.offering_id);
  }
  const { rows } = await db.query<{ answers: Record<string, string | number | null> }>(`SELECT answers FROM survey_responses WHERE survey_id = $1`, [sv.id]);
  // anonymous surveys: no breakdown below 3 responses (it could identify someone)
  const tooFew = sv.anonymous && rows.length < 3;
  res.json({
    responses: rows.length,
    questions: sv.questions.map((q) => {
      const vals = rows.map((r) => r.answers[q.id]).filter((v) => v != null && v !== '');
      if (tooFew) return { ...q, hidden: true };
      if (q.kind === 'rating') return { ...q, average: vals.length ? Math.round((vals.reduce<number>((n, v) => n + Number(v), 0) / vals.length) * 100) / 100 : null, distribution: [1, 2, 3, 4, 5].map((k) => vals.filter((v) => v === k).length) };
      if (q.kind === 'choice') return { ...q, counts: (q.options ?? []).map((label, i) => ({ label, count: vals.filter((v) => v === i).length })) };
      return { ...q, answers: vals.map(String) };
    }),
  });
});

// ---------------------------------------------------------------- live classes

const PROVIDER_HOSTS: Record<string, RegExp> = {
  zoom: /(^|\.)zoom\.us$/,
  meet: /^meet\.google\.com$/,
  teams: /^teams\.(microsoft|live)\.com$/,
  jitsi: /(^|\.)jit\.si$|^8x8\.vc$/,
};

router.get('/courses/:id/live', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseMember(req, offeringId);
  const { rows } = await db.query(
    `SELECT l.id, l.title, l.provider, l.starts_at, l.duration_minutes, l.recording_url, l.auto_attendance,
            ${a.role === 'staff' ? 'l.join_url, l.host_url,' : ''} (SELECT count(DISTINCT j.user_id)::int FROM live_joins j WHERE j.live_session_id = l.id) AS joined
       FROM live_sessions l WHERE l.offering_id = $1 ORDER BY l.starts_at DESC`,
    [offeringId]
  );
  res.json(rows);
});

router.post('/courses/:id/live', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseEditor(req, offeringId);
  const b = liveSessionBody.parse(req.body);
  let url = b.join_url;
  let meeting: Meeting = { joinUrl: url, hostUrl: '', externalId: '' };
  if (!url) {
    // Acadex creates the meeting: a Jitsi room, or on the institution's connected Zoom / Teams / Meet account
    if (!(await canCreate(institutionId(req), b.provider))) {
      throw badRequest('Paste the meeting link from Zoom, Google Meet or Teams — or connect the account under Settings → Integrations', { join_url: 'required' });
    }
    meeting = await createMeeting(institutionId(req), b.provider, { title: `${a.course.name}: ${b.title}`, startsAt: b.starts_at, durationMinutes: b.duration_minutes });
    url = meeting.joinUrl;
  } else if (PROVIDER_HOSTS[b.provider] && !PROVIDER_HOSTS[b.provider]!.test(new URL(url).hostname)) {
    throw badRequest(`That does not look like a ${b.provider} link`, { join_url: 'invalid' });
  }
  const out = await withTransaction(async () => {
    const { rows } = await db.query(
      `INSERT INTO live_sessions (institution_id, offering_id, title, provider, join_url, starts_at, duration_minutes, recording_url, auto_attendance, created_by, external_id, host_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [institutionId(req), offeringId, b.title, b.provider, url, b.starts_at, b.duration_minutes, b.recording_url, b.auto_attendance, currentUser(req).id, meeting.externalId || null, meeting.hostUrl]
    );
    if (b.module_id) {
      const { rows: m } = await db.query(`SELECT 1 FROM modules WHERE id = $1 AND offering_id = $2`, [b.module_id, offeringId]);
      if (!m[0]) throw badRequest('That module is not part of this course');
      await db.query(
        `INSERT INTO content_items (institution_id, module_id, kind, title, live_session_id, completion, position) VALUES ($1,$2,'live',$3,$4,'view', (SELECT COALESCE(max(position) + 1, 0) FROM content_items WHERE module_id = $2))`,
        [institutionId(req), b.module_id, b.title, rows[0].id]
      );
    }
    return rows[0];
  });
  await notify({ institutionId: institutionId(req), userIds: await rosterUserIds(offeringId), type: 'live_class', title: `Live class in ${a.course.name}: ${b.title}`, message: b.starts_at.toISOString(), link: `/learn/courses/${offeringId}/live` });
  res.status(201).json(out);
});

router.patch('/live/:id', async (req, res) => {
  const liveId = id.parse(req.params.id);
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM live_sessions WHERE id = $1 AND institution_id = $2`, [liveId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  await assertCourseEditor(req, rows[0].offering_id);
  const b = z.object({ recording_url: z.string().url().max(2000).or(z.literal('')).optional(), title: z.string().trim().min(1).max(200).optional() }).parse(req.body);
  const { rows: out } = await db.query(`UPDATE live_sessions SET recording_url = COALESCE($2, recording_url), title = COALESCE($3, title) WHERE id = $1 RETURNING *`, [liveId, b.recording_url ?? null, b.title ?? null]);
  res.json(out[0]);
});

router.delete('/live/:id', async (req, res) => {
  const liveId = id.parse(req.params.id);
  const { rows } = await db.query<{ offering_id: number }>(`SELECT offering_id FROM live_sessions WHERE id = $1 AND institution_id = $2`, [liveId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  await assertCourseEditor(req, rows[0].offering_id);
  await db.query(`DELETE FROM live_sessions WHERE id = $1`, [liveId]);
  res.status(204).end();
});

/** Join through Acadex: the join is recorded (and marks the student present) and the link returned. */
router.post('/live/:id/join', async (req, res) => {
  const liveId = id.parse(req.params.id);
  const { rows } = await db.query<{ id: number; offering_id: number; join_url: string; starts_at: Date; duration_minutes: number; auto_attendance: boolean }>(
    `SELECT id, offering_id, join_url, starts_at, duration_minutes, auto_attendance FROM live_sessions WHERE id = $1 AND institution_id = $2`,
    [liveId, institutionId(req)]
  );
  const l = rows[0];
  if (!l) throw notFound();
  const a = await assertCourseMember(req, l.offering_id);
  if (a.role === 'guardian') throw forbidden();
  const now = Date.now();
  const opens = l.starts_at.getTime() - 15 * 60_000;
  const ends = l.starts_at.getTime() + l.duration_minutes * 60_000;
  if (a.role === 'student' && (now < opens || now > ends + 30 * 60_000)) throw conflict('The class opens 15 minutes before it starts', 'NOT_OPEN');
  const u = currentUser(req);
  await db.query(`INSERT INTO live_joins (institution_id, live_session_id, user_id) VALUES ($1,$2,$3)`, [institutionId(req), l.id, u.id]);
  if (a.role === 'student') await markLiveAttendance(institutionId(req), l, a.studentIds[0]!, u.id);
  res.json({ join_url: l.join_url });
});

// ---------------------------------------------------------------- my calendar & ICS feed

async function calendarEvents(userId: number, role: string, refId: number | null, institution: number, from: string, to: string) {
  const offerings =
    role === 'student'
      ? `SELECT o.id FROM course_offerings o WHERE o.institution_id = $1 AND ${Number(refId)} IN (${rosterSql('o.id')})`
      : role === 'teacher'
        ? `SELECT offering_id FROM section_staff WHERE teacher_id = ${Number(refId)}`
        : role === 'parent'
          ? `SELECT o.id FROM course_offerings o WHERE o.institution_id = $1 AND EXISTS (SELECT 1 FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE g.user_id = ${Number(userId)} AND gs.student_id IN (${rosterSql('o.id')}))`
          : `SELECT id FROM course_offerings WHERE institution_id = $1 AND false`;
  const { rows } = await db.query<{ kind: string; id: number; title: string; starts_at: Date | string; ends_at: Date | string | null; all_day: boolean; course: string | null; link: string }>(
    `SELECT 'due' AS kind, a.id, a.title, to_char(a.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS starts_at, NULL::text AS ends_at, false AS all_day, c.name AS course,
            '/learn/courses/' || a.offering_id || '/work/' || a.id AS link
       FROM assessments a JOIN course_offerings o ON o.id = a.offering_id JOIN courses c ON c.id = o.course_id
      WHERE a.offering_id IN (${offerings}) AND a.status = 'published' AND a.due_at BETWEEN $2::date AND $3::date + 1
     UNION ALL
     SELECT 'live', l.id, l.title, to_char(l.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char((l.starts_at + make_interval(mins => l.duration_minutes)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), false, c.name, '/learn/courses/' || l.offering_id || '/live'
       FROM live_sessions l JOIN course_offerings o ON o.id = l.offering_id JOIN courses c ON c.id = o.course_id
      WHERE l.offering_id IN (${offerings}) AND l.starts_at BETWEEN $2::date AND $3::date + 1
     UNION ALL
     SELECT 'holiday', h.id, h.name, h.starts_on::text, h.ends_on::text, true, NULL, '/calendar'
       FROM holidays h WHERE h.institution_id = $1 AND h.ends_on >= $2::date AND h.starts_on <= $3::date
     ORDER BY 4`,
    [institution, from, to]
  );
  return rows;
}

router.get('/calendar/me', async (req, res) => {
  const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
  const u = currentUser(req);
  res.json(await calendarEvents(u.id, u.role, u.ref_id, institutionId(req), q.from, q.to));
});

/** A private link for calendar apps (Google, Outlook, Apple). Creating a new one cancels the old one. */
router.post('/calendar/feed', async (req, res) => {
  const token = crypto.randomBytes(24).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(`INSERT INTO calendar_feeds (user_id, token_hash) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()`, [currentUser(req).id, hash]);
  res.status(201).json({ url: `${req.protocol}://${req.get('host')}/api/public/calendar/${token}.ics` });
});

router.delete('/calendar/feed', async (req, res) => {
  await db.query(`DELETE FROM calendar_feeds WHERE user_id = $1`, [currentUser(req).id]);
  res.status(204).end();
});

/** ICS text for a person's calendar (used by the public feed route). */
export async function icsFor(userId: number): Promise<string | null> {
  const { rows } = await db.query<{ id: number; role: string; ref_id: number | null; institution_id: number | null; is_active: boolean; name: string }>(
    `SELECT u.id, u.role, u.ref_id, u.institution_id, u.is_active, i.name FROM users u JOIN institutions i ON i.id = u.institution_id WHERE u.id = $1`,
    [userId]
  );
  const u = rows[0];
  if (!u || !u.is_active || !u.institution_id) return null;
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
  const events = await calendarEvents(u.id, u.role, u.ref_id, u.institution_id, from, to);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n');
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = (s: string) => s.slice(0, 10).replace(/-/g, '');
  const nextDay = (s: string) => {
    const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  };
  const base = getConfig().appUrl;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Acadex//Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(u.name)} — Acadex`];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.kind}-${e.id}@acadex`, `DTSTAMP:${stamp(new Date())}`);
    if (e.all_day) lines.push(`DTSTART;VALUE=DATE:${day(String(e.starts_at))}`, `DTEND;VALUE=DATE:${nextDay(String(e.ends_at ?? e.starts_at))}`);
    else {
      const start = new Date(e.starts_at);
      lines.push(`DTSTART:${stamp(start)}`, `DTEND:${stamp(e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 15 * 60_000))}`);
    }
    lines.push(`SUMMARY:${esc(`${e.kind === 'due' ? 'Due: ' : ''}${e.title}${e.course ? ` (${e.course})` : ''}`)}`, `URL:${base}${e.link}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // fold long lines as the format requires
  return lines.map((l) => (l.length <= 74 ? l : l.match(/.{1,74}/g)!.join('\r\n '))).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- course certificates

router.get('/courses/:id/certificate-template', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const { rows } = await db.query(`SELECT * FROM certificate_templates WHERE offering_id = $1`, [offeringId]);
  const { rows: issued } = await db.query(
    `SELECT c.id, c.verify_code, c.issued_at, c.revoked_at, st.first_name || ' ' || st.last_name AS student FROM certificates c JOIN students st ON st.id = c.student_id WHERE c.offering_id = $1 ORDER BY c.issued_at DESC`,
    [offeringId]
  );
  res.json({ template: rows[0] ?? null, issued });
});

router.put('/courses/:id/certificate-template', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const b = courseCertificateBody.parse(req.body);
  const { rows: ex } = await db.query<{ id: number }>(`SELECT id FROM certificate_templates WHERE offering_id = $1`, [offeringId]);
  const { rows } = ex[0]
    ? await db.query(`UPDATE certificate_templates SET title = $2, body = $3, auto_issue = $4, min_progress_percent = $5, min_grade_percent = $6 WHERE id = $1 RETURNING *`, [
        ex[0].id, b.title, b.body, b.auto_issue, b.min_progress_percent, b.min_grade_percent,
      ])
    : await db.query(
        `INSERT INTO certificate_templates (institution_id, offering_id, title, body, auto_issue, min_progress_percent, min_grade_percent) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [institutionId(req), offeringId, b.title, b.body, b.auto_issue, b.min_progress_percent, b.min_grade_percent]
      );
  res.json(rows[0]);
});

/** Issue now: to students who meet the conditions, or (force) to the students named. */
router.post('/courses/:id/certificates/issue', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const b = z.object({ student_ids: z.array(id).max(1000).optional(), force: z.boolean().default(false) }).parse(req.body ?? {});
  const { rows: roster } = await db.query<{ id: number }>(`SELECT id FROM (${rosterSql('$1')}) r`, [offeringId]);
  const targets = b.student_ids ?? roster.map((r) => r.id);
  if (targets.some((t) => !roster.some((r) => r.id === t))) throw badRequest('Some students are not in this course');
  let issued = 0;
  for (const sid of targets) if (await maybeIssueCertificate(institutionId(req), offeringId, sid, { force: b.force || !!b.student_ids })) issued++;
  res.json({ issued });
});

router.post('/certificates/:id/revoke', async (req, res) => {
  const certId = id.parse(req.params.id);
  const { rows } = await db.query<{ offering_id: number | null }>(`SELECT offering_id FROM certificates WHERE id = $1 AND institution_id = $2`, [certId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if (rows[0].offering_id) await assertCourseEditor(req, rows[0].offering_id);
  else if (!userCan(req, 'documents.issue')) throw forbidden();
  const { reason } = z.object({ reason: z.string().trim().min(1).max(300) }).parse(req.body);
  await db.query(`UPDATE certificates SET revoked_at = now(), revoke_reason = $2 WHERE id = $1`, [certId, reason]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- achievements: certificates, badges, points

router.get('/me/achievements', async (req, res) => {
  const u = currentUser(req);
  const sid = u.role === 'student' ? u.ref_id : req.query.student_id ? id.parse(req.query.student_id) : null;
  if (!sid) throw badRequest('Choose a student');
  if (u.role === 'parent') {
    const { rows } = await db.query(`SELECT 1 FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE g.user_id = $1 AND gs.student_id = $2`, [u.id, sid]);
    if (!rows[0]) throw forbidden();
  } else if (u.role !== 'student') throw forbidden();
  const [certs, badges, points] = await Promise.all([
    db.query(`SELECT c.id, c.title, c.verify_code, c.issued_at, c.revoked_at, co.name AS course FROM certificates c LEFT JOIN course_offerings o ON o.id = c.offering_id LEFT JOIN courses co ON co.id = o.course_id WHERE c.student_id = $1 ORDER BY c.issued_at DESC`, [sid]),
    db.query(`SELECT b.id, b.name, b.description, b.icon, a.awarded_at FROM badge_awards a JOIN badges b ON b.id = a.badge_id WHERE a.student_id = $1 ORDER BY a.awarded_at DESC`, [sid]),
    db.query<{ total: number }>(`SELECT COALESCE(sum(points), 0)::int AS total FROM points_ledger WHERE student_id = $1`, [sid]),
  ]);
  res.json({ certificates: certs.rows, badges: badges.rows, points: points.rows[0]?.total ?? 0 });
});

router.get('/badges', async (req, res) => {
  const { rows } = await db.query(`SELECT b.*, (SELECT count(*)::int FROM badge_awards a WHERE a.badge_id = b.id) AS awarded FROM badges b WHERE b.institution_id = $1 ORDER BY b.name`, [institutionId(req)]);
  res.json(rows);
});

router.post('/badges', requirePermission('gamification.manage'), async (req, res) => {
  const b = badgeBody.parse(req.body);
  try {
    const { rows } = await db.query(`INSERT INTO badges (institution_id, name, description, icon, criteria) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [institutionId(req), b.name, b.description, b.icon, JSON.stringify(b.criteria)]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw conflict('A badge with this name exists', 'DUPLICATE');
    throw e;
  }
});

router.delete('/badges/:id', requirePermission('gamification.manage'), async (req, res) => {
  const { rowCount } = await db.query(`DELETE FROM badges WHERE id = $1 AND institution_id = $2`, [id.parse(req.params.id), institutionId(req)]);
  if (!rowCount) throw notFound();
  res.status(204).end();
});

/** Teachers award badges by hand to students of their courses. */
router.post('/badges/:id/award', async (req, res) => {
  const badgeId = id.parse(req.params.id);
  const b = awardBody.parse(req.body);
  const { rows } = await db.query(`SELECT 1 FROM badges WHERE id = $1 AND institution_id = $2`, [badgeId, institutionId(req)]);
  if (!rows[0]) throw notFound();
  if (b.offering_id) {
    await assertCourseEditor(req, b.offering_id);
    const { rows: on } = await db.query(`SELECT 1 FROM (${rosterSql('$1')}) r WHERE r.id = $2`, [b.offering_id, b.student_id]);
    if (!on[0]) throw badRequest('This student is not in the course');
  } else if (!userCan(req, 'gamification.manage')) throw forbidden();
  await db.query(`INSERT INTO badge_awards (institution_id, badge_id, student_id, offering_id, awarded_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [
    institutionId(req), badgeId, b.student_id, b.offering_id, currentUser(req).id,
  ]);
  res.status(201).json({ ok: true });
});

/** The course leaderboard, only where the institution has turned it on. First names only. */
router.get('/courses/:id/leaderboard', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseMember(req, offeringId);
  const { rows: inst } = await db.query<{ settings: unknown }>(`SELECT settings FROM institutions WHERE id = $1`, [institutionId(req)]);
  const p = institutionSettings.safeParse(inst[0]?.settings ?? {});
  if (!(p.success && p.data.gamification?.enabled && p.data.gamification.leaderboard)) throw notFound('The leaderboard is turned off');
  const { rows } = await db.query(
    `SELECT st.id AS student_id, st.first_name AS name, COALESCE(sum(pl.points), 0)::int AS points
       FROM students st LEFT JOIN points_ledger pl ON pl.student_id = st.id AND pl.offering_id = $1
      WHERE st.id IN (${rosterSql('$1')}) GROUP BY st.id, st.first_name ORDER BY points DESC, st.first_name LIMIT 20`,
    [offeringId]
  );
  res.json(rows);
});

export default router;

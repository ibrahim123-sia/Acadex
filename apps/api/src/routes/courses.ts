// Courses: the list of my courses, a course's home and space (modules, pages, files, videos,
// links, assessments), drip release, progress (mark done, resume) and blueprints.
// Mounted under /api.
import { Router } from 'express';
import type { Request } from 'express';
import { blueprintApplyBody, blueprintBody, contentItemBody, contentItemPatch, id, moduleBody, orderBody, progressBody } from '@acadex/shared';
import { db, withTransaction } from '../db/context';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertCourseEditor, assertCourseMember, courseAccess, rosterSql } from '../lib/lms/access';
import { copySpace, loadSpace, markDone, prepareItem, studentState, studentView, type Owner } from '../lib/lms/space';
import { onProgress } from '../lib/lms/rewards';
import { parsePage, sendPage } from '../lib/pagination';
import { softDelete } from '../lib/soft-delete';
import { currentUser, institutionId, requirePermission, userCan } from '../middleware/auth';

const router = Router();

// ---------------------------------------------------------------- my courses

router.get('/courses', async (req, res) => {
  const u = currentUser(req);
  const s = institutionId(req);
  const pg = parsePage(req.query);
  const all = req.query.all === 'true' && (userCan(req, 'courses.manage_any') || userCan(req, 'academics.read'));
  let where: string;
  const params: unknown[] = [s];
  if (all) where = 'TRUE';
  else if (u.role === 'teacher') {
    params.push(u.ref_id);
    where = `o.id IN (SELECT offering_id FROM section_staff WHERE teacher_id = $2)`;
  } else if (u.role === 'student') {
    params.push(u.ref_id);
    where = `$2 IN (${rosterSql('o.id')})`;
  } else if (u.role === 'parent') {
    params.push(u.id);
    where = `EXISTS (SELECT 1 FROM guardianships gs JOIN guardians g ON g.id = gs.guardian_id WHERE g.user_id = $2 AND gs.can_view_grades AND gs.student_id IN (${rosterSql('o.id')}))`;
  } else where = 'FALSE';
  params.push(pg.limit, pg.offset);
  const studentId = u.role === 'student' ? u.ref_id : null;
  const { rows } = await db.query(
    `SELECT o.id, o.course_id, c.code, c.name, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name, tm.name AS term_name,
            (SELECT string_agg(t.first_name || ' ' || t.last_name, ', ') FROM section_staff ss JOIN teachers t ON t.id = ss.teacher_id WHERE ss.offering_id = o.id) AS teachers,
            (SELECT count(*)::int FROM content_items i JOIN modules m ON m.id = i.module_id WHERE m.offering_id = o.id AND m.published AND i.published AND i.deleted_at IS NULL) AS items,
            ${studentId ? `(SELECT count(*)::int FROM content_progress p JOIN content_items i ON i.id = p.item_id JOIN modules m ON m.id = i.module_id WHERE m.offering_id = o.id AND p.student_id = ${Number(studentId)} AND p.status = 'done' AND m.published AND i.published)` : 'NULL::int'} AS done,
            (SELECT json_build_object('id', a.id, 'title', a.title, 'due_at', a.due_at) FROM assessments a
              WHERE a.offering_id = o.id AND a.status = 'published' AND a.due_at > now() AND a.deleted_at IS NULL ORDER BY a.due_at LIMIT 1) AS next_due,
            count(*) OVER() _total
       FROM course_offerings o JOIN courses c ON c.id = o.course_id
       LEFT JOIN sections sec ON sec.id = o.section_id LEFT JOIN terms tm ON tm.id = o.term_id
      WHERE o.institution_id = $1 AND c.deleted_at IS NULL AND ${where}
      ORDER BY c.name, sec.name NULLS LAST, o.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  sendPage(
    res,
    rows.map((r) => ({ ...r, progress_percent: r.done == null ? null : r.items ? Math.round((r.done / r.items) * 100) : 0 })),
    pg
  );
});

/** A course's home: who I am in it, its space (filtered for students), and what's coming up. */
router.get('/courses/:id', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseMember(req, offeringId);
  const space = await loadSpace({ offeringId });
  const { rows: upcoming } = await db.query(
    `SELECT id, title, kind, due_at, points FROM assessments
      WHERE offering_id = $1 AND status = 'published' AND due_at > now() - interval '1 day' ORDER BY due_at LIMIT 5`,
    [offeringId]
  );
  const { rows: staff } = await db.query(
    `SELECT t.id, t.first_name || ' ' || t.last_name AS name, ss.role FROM section_staff ss JOIN teachers t ON t.id = ss.teacher_id WHERE ss.offering_id = $1 ORDER BY ss.role, t.first_name`,
    [offeringId]
  );
  const base = { course: a.course, role: a.role, can_edit: a.canEdit, staff, upcoming };
  if (a.role === 'staff') return void res.json({ ...base, modules: space.modules.map((m) => ({ ...m, items: space.items.filter((i) => i.module_id === m.id) })) });
  const studentId = Number(req.query.student_id) || a.studentIds[0]!;
  if (!a.studentIds.includes(studentId)) throw forbidden();
  const view = studentView(space, await studentState(offeringId, studentId));
  res.json({ ...base, student_id: studentId, ...view });
});

// ---------------------------------------------------------------- modules

const modulePayload = async (offeringId: number, b: ReturnType<typeof moduleBody.parse>) => {
  if (b.prerequisite_module_id) {
    const { rows } = await db.query(`SELECT 1 FROM modules WHERE id = $1 AND offering_id = $2`, [b.prerequisite_module_id, offeringId]);
    if (!rows[0]) throw badRequest('The prerequisite must be a module of this course', { prerequisite_module_id: 'invalid' });
  }
  return [b.title, b.description, b.published, b.unlock_at, b.prerequisite_module_id, b.mastery_percent];
};

router.post('/courses/:id/modules', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const b = moduleBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO modules (institution_id, offering_id, title, description, published, unlock_at, prerequisite_module_id, mastery_percent, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(max(position) + 1, 0) FROM modules WHERE offering_id = $2)) RETURNING *`,
    [institutionId(req), offeringId, ...(await modulePayload(offeringId, b))]
  );
  res.status(201).json(rows[0]);
});

async function moduleOf(req: Request, moduleId: number) {
  const { rows } = await db.query<{ offering_id: number | null; blueprint_id: number | null }>(`SELECT offering_id, blueprint_id FROM modules WHERE id = $1 AND institution_id = $2`, [moduleId, institutionId(req)]);
  if (!rows[0]) throw notFound('Module not found');
  return rows[0];
}

/** Editing a module or item: course staff, or blueprint managers for blueprint content. */
async function assertSpaceEditor(req: Request, m: { offering_id: number | null; blueprint_id: number | null }) {
  if (m.offering_id) return assertCourseEditor(req, m.offering_id);
  if (!userCan(req, 'blueprints.manage')) throw forbidden('Only blueprint managers can change blueprints');
  return null;
}

router.patch('/modules/:id', async (req, res) => {
  const moduleId = id.parse(req.params.id);
  const m = await moduleOf(req, moduleId);
  await assertSpaceEditor(req, m);
  const b = moduleBody.parse(req.body);
  if (b.prerequisite_module_id === moduleId) throw badRequest('A module cannot be its own prerequisite');
  const vals = m.offering_id ? await modulePayload(m.offering_id, b) : [b.title, b.description, b.published, b.unlock_at, null, b.mastery_percent];
  const { rows } = await db.query(
    `UPDATE modules SET title = $2, description = $3, published = $4, unlock_at = $5, prerequisite_module_id = $6, mastery_percent = $7, updated_at = now() WHERE id = $1 RETURNING *`,
    [moduleId, ...vals]
  );
  res.json(rows[0]);
});

router.delete('/modules/:id', async (req, res) => {
  const moduleId = id.parse(req.params.id);
  await assertSpaceEditor(req, await moduleOf(req, moduleId));
  const { rows } = await db.query(`SELECT count(*)::int n FROM content_items WHERE module_id = $1`, [moduleId]);
  if (rows[0].n > 0 && req.query.force !== 'true') throw badRequest('This module still has content. Move or delete it first (or delete with force=true).', { items: rows[0].n });
  await db.query(`DELETE FROM modules WHERE id = $1`, [moduleId]);
  res.status(204).end();
});

router.put('/courses/:id/modules/order', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  await assertCourseEditor(req, offeringId);
  const { ids } = orderBody.parse(req.body);
  const { rowCount } = await db.query(
    `UPDATE modules m SET position = o.pos - 1 FROM unnest($2::int[]) WITH ORDINALITY AS o(id, pos) WHERE m.id = o.id AND m.offering_id = $1`,
    [offeringId, ids]
  );
  if (rowCount !== ids.length) throw badRequest('Every module must belong to this course');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- content items

async function assertItemRefs(req: Request, offeringId: number | null, b: { file_id?: number | null; assessment_id?: number | null; live_session_id?: number | null; scorm_package_id?: number | null }) {
  const s = institutionId(req);
  const checks: [string, number | null | undefined, string][] = [
    ['files', b.file_id, 'file_id'],
    ['scorm_packages', b.scorm_package_id, 'scorm_package_id'],
  ];
  for (const [t, v, field] of checks) {
    if (!v) continue;
    const { rows } = await db.query(`SELECT 1 FROM ${t} WHERE id = $1 AND institution_id = $2`, [v, s]);
    if (!rows[0]) throw badRequest('Not found in this institution', { [field]: 'invalid' });
  }
  for (const [t, v, field] of [['assessments', b.assessment_id, 'assessment_id'], ['live_sessions', b.live_session_id, 'live_session_id']] as const) {
    if (!v) continue;
    const { rows } = await db.query(`SELECT 1 FROM ${t} WHERE id = $1 AND offering_id = $2`, [v, offeringId]);
    if (!rows[0]) throw badRequest('It must belong to this course', { [field]: 'invalid' });
  }
}

router.post('/content-items', async (req, res) => {
  const b = contentItemBody.parse(req.body);
  const m = await moduleOf(req, b.module_id);
  await assertSpaceEditor(req, m);
  await assertItemRefs(req, m.offering_id, b);
  if (b.kind === 'assessment' && !b.assessment_id) throw badRequest('Choose the assessment', { assessment_id: 'required' });
  if (['link', 'video', 'embed'].includes(b.kind) && !b.url) throw badRequest('A link is needed', { url: 'required' });
  if (b.kind === 'file' && !b.file_id) throw badRequest('Upload the file first', { file_id: 'required' });
  const p = prepareItem(b);
  const { rows } = await db.query(
    `INSERT INTO content_items (institution_id, module_id, kind, title, body_html, body_json, url, file_id, video_provider, video_ref, assessment_id,
                                live_session_id, scorm_package_id, published, unlock_at, completion, duration_minutes, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, (SELECT COALESCE(max(position) + 1, 0) FROM content_items WHERE module_id = $2))
     RETURNING *`,
    [
      institutionId(req), b.module_id, b.kind, b.title, p.body_html ?? '', b.body_json === undefined ? null : JSON.stringify(b.body_json), p.url ?? b.url, b.file_id,
      p.video_provider ?? null, p.video_ref ?? null, b.assessment_id, b.live_session_id, b.scorm_package_id, b.published, b.unlock_at, b.completion, b.duration_minutes,
    ]
  );
  res.status(201).json(rows[0]);
});

async function itemOf(req: Request, itemId: number) {
  const { rows } = await db.query<{ id: number; kind: string; module_id: number; offering_id: number | null; blueprint_id: number | null; source_item_id: number | null }>(
    `SELECT i.id, i.kind, i.module_id, m.offering_id, m.blueprint_id, i.source_item_id FROM content_items i JOIN modules m ON m.id = i.module_id WHERE i.id = $1 AND i.institution_id = $2`,
    [itemId, institutionId(req)]
  );
  if (!rows[0]) throw notFound('Content not found');
  return rows[0];
}

router.get('/content-items/:id', async (req, res) => {
  const itemId = id.parse(req.params.id);
  const it = await itemOf(req, itemId);
  if (!it.offering_id) {
    if (!userCan(req, 'blueprints.manage')) throw forbidden();
  } else {
    const a = await assertCourseMember(req, it.offering_id);
    if (a.role !== 'staff') {
      const sid = a.studentIds[0]!;
      const view = studentView(await loadSpace({ offeringId: it.offering_id }), await studentState(it.offering_id, sid));
      const found = view.modules.flatMap((m) => m.items).find((i) => i.id === itemId);
      if (!found) throw notFound('Content not found');
      if (found.locked) throw forbidden(found.lock_reason ?? 'This is not open yet');
      // opening it counts as viewing it (students only, never a guardian looking in)
      if (a.role === 'student') {
        await db.query(
          `INSERT INTO content_progress (student_id, item_id, institution_id, status, percent) VALUES ($1, $2, $3, 'started', 0)
           ON CONFLICT (student_id, item_id) DO UPDATE SET updated_at = now()`,
          [sid, itemId, institutionId(req)]
        );
        const { rows } = await db.query<{ completion: string }>(`SELECT completion FROM content_items WHERE id = $1`, [itemId]);
        if (rows[0]?.completion === 'view') await markDone(institutionId(req), sid, itemId);
      }
    }
  }
  const { rows } = await db.query(
    `SELECT i.*, a.title AS assessment_title, a.due_at, a.kind AS assessment_kind, f.original_name AS file_name, f.content_type AS file_type, f.size_bytes AS file_size
       FROM content_items i LEFT JOIN assessments a ON a.id = i.assessment_id LEFT JOIN files f ON f.id = i.file_id WHERE i.id = $1`,
    [itemId]
  );
  const { rows: prog } = await db.query(`SELECT status, percent, resume FROM content_progress WHERE item_id = $1 AND student_id = $2`, [itemId, currentUser(req).role === 'student' ? currentUser(req).ref_id : 0]);
  res.json({ ...rows[0], progress: prog[0] ?? null });
});

router.patch('/content-items/:id', async (req, res) => {
  const itemId = id.parse(req.params.id);
  const it = await itemOf(req, itemId);
  await assertSpaceEditor(req, it);
  const b = contentItemPatch.parse(req.body);
  if (b.module_id && b.module_id !== it.module_id) {
    const target = await moduleOf(req, b.module_id);
    if (target.offering_id !== it.offering_id || target.blueprint_id !== it.blueprint_id) throw badRequest('Content can only move within its course');
  }
  await assertItemRefs(req, it.offering_id, b);
  const p = prepareItem({ ...b, kind: it.kind });
  const sets: string[] = [];
  const vals: unknown[] = [itemId];
  const put = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  for (const k of ['title', 'url', 'file_id', 'assessment_id', 'published', 'unlock_at', 'completion', 'duration_minutes', 'module_id'] as const) if (b[k] !== undefined) put(k, k === 'url' ? (p.url ?? b.url) : b[k]);
  if (b.body_html !== undefined) put('body_html', p.body_html);
  if (b.body_json !== undefined) put('body_json', JSON.stringify(b.body_json));
  if (p.video_provider !== undefined) {
    put('video_provider', p.video_provider);
    put('video_ref', p.video_ref);
  }
  // a course's own change to blueprint content: blueprint updates now leave it alone
  if (it.source_item_id && it.offering_id) sets.push('locally_modified = true');
  if (!sets.length) throw badRequest('Nothing to change');
  const { rows } = await db.query(`UPDATE content_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, vals);
  res.json(rows[0]);
});

router.delete('/content-items/:id', async (req, res) => {
  const itemId = id.parse(req.params.id);
  await assertSpaceEditor(req, await itemOf(req, itemId));
  await softDelete('content_items', itemId, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

router.put('/modules/:id/items/order', async (req, res) => {
  const moduleId = id.parse(req.params.id);
  await assertSpaceEditor(req, await moduleOf(req, moduleId));
  const { ids } = orderBody.parse(req.body);
  const { rowCount } = await db.query(
    `UPDATE content_items i SET position = o.pos - 1 FROM unnest($2::int[]) WITH ORDINALITY AS o(id, pos) WHERE i.id = o.id AND i.module_id = $1`,
    [moduleId, ids]
  );
  if (rowCount !== ids.length) throw badRequest('Every item must belong to this module');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- progress

/** Students: save where they are (resume) or mark an item done. */
router.put('/content-items/:id/progress', requirePermission('learner.access'), async (req, res) => {
  const itemId = id.parse(req.params.id);
  const it = await itemOf(req, itemId);
  if (!it.offering_id) throw notFound();
  const a = await courseAccess(currentUser(req), it.offering_id);
  if (a.role !== 'student') throw forbidden();
  const b = progressBody.parse(req.body);
  const { rows: item } = await db.query<{ completion: string }>(`SELECT completion FROM content_items WHERE id = $1`, [itemId]);
  // "done" only where the student decides it (submit/pass items complete themselves)
  if (b.status === 'done' && !['view', 'mark_done'].includes(item[0]!.completion)) throw badRequest('This completes when you hand in the work');
  const sid = a.studentIds[0]!;
  await db.query(
    `INSERT INTO content_progress (student_id, item_id, institution_id, status, percent, resume, completed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4 = 'done' THEN now() END, now())
     ON CONFLICT (student_id, item_id) DO UPDATE SET
       status = CASE WHEN content_progress.status = 'done' THEN 'done' ELSE EXCLUDED.status END,
       percent = GREATEST(content_progress.percent, EXCLUDED.percent), resume = COALESCE(EXCLUDED.resume, content_progress.resume),
       completed_at = COALESCE(content_progress.completed_at, EXCLUDED.completed_at), updated_at = now()`,
    [sid, itemId, institutionId(req), b.status, b.status === 'done' ? 100 : b.percent, b.resume ? JSON.stringify(b.resume) : null]
  );
  if (b.status === 'done') await onProgress(institutionId(req), it.offering_id, [sid], `item:${itemId}`);
  res.json({ ok: true });
});

/** Staff: everyone's progress through the course. */
router.get('/courses/:id/progress', async (req, res) => {
  const offeringId = id.parse(req.params.id);
  const a = await assertCourseMember(req, offeringId);
  if (a.role !== 'staff') throw forbidden();
  const { rows } = await db.query(
    `WITH items AS (SELECT i.id FROM content_items i JOIN modules m ON m.id = i.module_id WHERE m.offering_id = $1 AND m.published AND i.published AND i.deleted_at IS NULL)
     SELECT st.id AS student_id, st.first_name || ' ' || st.last_name AS name, st.roll_no,
            (SELECT count(*)::int FROM content_progress p WHERE p.student_id = st.id AND p.status = 'done' AND p.item_id IN (SELECT id FROM items)) AS done,
            (SELECT count(*)::int FROM items) AS total,
            (SELECT max(p.updated_at) FROM content_progress p WHERE p.student_id = st.id AND p.item_id IN (SELECT id FROM items)) AS last_active
       FROM students st WHERE st.id IN (${rosterSql('$1')}) ORDER BY st.roll_no NULLS LAST, st.first_name`,
    [offeringId]
  );
  res.json(rows.map((r) => ({ ...r, percent: r.total ? Math.round((r.done / r.total) * 100) : 0 })));
});

// ---------------------------------------------------------------- blueprints

const blueprints = requirePermission('blueprints.manage');

router.get('/blueprints', blueprints, async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.id, b.title, b.description, b.course_id, c.name AS course_name, b.created_at,
            (SELECT count(*)::int FROM modules m WHERE m.blueprint_id = b.id) AS modules,
            (SELECT count(DISTINCT m.offering_id)::int FROM modules m WHERE m.source_module_id IN (SELECT id FROM modules WHERE blueprint_id = b.id)) AS courses
       FROM course_blueprints b LEFT JOIN courses c ON c.id = b.course_id WHERE b.institution_id = $1 ORDER BY b.title`,
    [institutionId(req)]
  );
  res.json(rows);
});

router.post('/blueprints', blueprints, async (req, res) => {
  const b = blueprintBody.parse(req.body);
  const s = institutionId(req);
  if (b.from_offering_id) await courseAccess(currentUser(req), b.from_offering_id);
  const out = await withTransaction(async () => {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO course_blueprints (institution_id, course_id, title, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [s, b.course_id, b.title, b.description, currentUser(req).id]
    );
    if (b.from_offering_id) await copySpace(s, { offeringId: b.from_offering_id }, { blueprintId: rows[0]!.id });
    return rows[0]!;
  });
  res.status(201).json(out);
});

async function loadBlueprint(req: Request, blueprintId: number) {
  const { rows } = await db.query(`SELECT * FROM course_blueprints WHERE id = $1 AND institution_id = $2`, [blueprintId, institutionId(req)]);
  if (!rows[0]) throw notFound('Blueprint not found');
  return rows[0];
}

router.get('/blueprints/:id', blueprints, async (req, res) => {
  const blueprintId = id.parse(req.params.id);
  const bp = await loadBlueprint(req, blueprintId);
  const space = await loadSpace({ blueprintId });
  const { rows: copies } = await db.query(
    `SELECT DISTINCT o.id, c.name, NULLIF(trim(sec.name || ' ' || COALESCE(sec.label, '')), '') AS section_name
       FROM modules m JOIN course_offerings o ON o.id = m.offering_id JOIN courses c ON c.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
      WHERE m.source_module_id IN (SELECT id FROM modules WHERE blueprint_id = $1)`,
    [blueprintId]
  );
  res.json({ ...bp, modules: space.modules.map((m) => ({ ...m, items: space.items.filter((i) => i.module_id === m.id) })), courses: copies });
});

router.post('/blueprints/:id/modules', blueprints, async (req, res) => {
  const blueprintId = id.parse(req.params.id);
  await loadBlueprint(req, blueprintId);
  const b = moduleBody.parse(req.body);
  const { rows } = await db.query(
    `INSERT INTO modules (institution_id, blueprint_id, title, description, published, unlock_at, mastery_percent, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(max(position) + 1, 0) FROM modules WHERE blueprint_id = $2)) RETURNING *`,
    [institutionId(req), blueprintId, b.title, b.description, b.published, b.unlock_at, b.mastery_percent]
  );
  res.status(201).json(rows[0]);
});

/** Copy the blueprint into courses (new content is added next to what they have). */
router.post('/blueprints/:id/apply', blueprints, async (req, res) => {
  const blueprintId = id.parse(req.params.id);
  await loadBlueprint(req, blueprintId);
  const { offering_ids } = blueprintApplyBody.parse(req.body);
  const s = institutionId(req);
  const results = await withTransaction(async () => {
    const out: { offering_id: number; added: number; updated: number }[] = [];
    for (const o of offering_ids) {
      await assertCourseEditor(req, o);
      const r = await copySpace(s, { blueprintId }, { offeringId: o }, { update: true });
      out.push({ offering_id: o, added: r.added, updated: r.updated });
    }
    return out;
  });
  res.json(results);
});

/** Push blueprint changes to every course made from it (content changed locally is kept). */
router.post('/blueprints/:id/push', blueprints, async (req, res) => {
  const blueprintId = id.parse(req.params.id);
  await loadBlueprint(req, blueprintId);
  const s = institutionId(req);
  const { rows } = await db.query<{ offering_id: number }>(
    `SELECT DISTINCT offering_id FROM modules WHERE offering_id IS NOT NULL AND source_module_id IN (SELECT id FROM modules WHERE blueprint_id = $1)`,
    [blueprintId]
  );
  const results = await withTransaction(async () => {
    const out: { offering_id: number; added: number; updated: number }[] = [];
    for (const r of rows) {
      const x = await copySpace(s, { blueprintId } as Owner, { offeringId: r.offering_id }, { update: true });
      out.push({ offering_id: r.offering_id, added: x.added, updated: x.updated });
    }
    return out;
  });
  res.json(results);
});

router.delete('/blueprints/:id', blueprints, async (req, res) => {
  const blueprintId = id.parse(req.params.id);
  await loadBlueprint(req, blueprintId);
  await softDelete('course_blueprints', blueprintId, institutionId(req), currentUser(req).id);
  res.status(204).end();
});

export default router;

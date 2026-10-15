// The recycle bin (restore or permanently delete soft-deleted records) and the institution's
// audit trail (who changed what, when). Mounted under /api/institution.
import { Router } from 'express';
import { z } from 'zod';
import { RECYCLABLE, auditQuery, id } from '@acadex/shared';
import { db, withDeleted } from '../db/context';
import { badRequest, notFound } from '../lib/errors';
import { parsePage, sendPage } from '../lib/pagination';
import { purgeRecord, restoreDeleted } from '../lib/soft-delete';
import { auth, institutionId, requirePermission } from '../middleware/auth';
import { RETENTION_DAYS } from '../lib/soft-delete';

const router = Router();
router.use(auth);


const LABELS: Record<(typeof RECYCLABLE)[number], { label: string; sql: string }> = {
  students: { label: 'Student', sql: `first_name || ' ' || last_name || COALESCE(' · ' || roll_no, '')` },
  teachers: { label: 'Staff member', sql: `first_name || ' ' || last_name || COALESCE(' · ' || NULLIF(designation, ''), '')` },
  guardians: { label: 'Guardian', sql: `trim(first_name || ' ' || last_name) || COALESCE(' · ' || NULLIF(phone, ''), '')` },
  sections: { label: 'Class / section', sql: `name || COALESCE(' ' || NULLIF(label, ''), '') || ' (' || code || ')'` },
  courses: { label: 'Course', sql: `code || ' ' || name` },
  programs: { label: 'Program', sql: `name || ' (' || code || ')'` },
  departments: { label: 'Department', sql: `name || ' (' || code || ')'` },
  campuses: { label: 'Campus', sql: `name || ' (' || code || ')'` },
  person_documents: { label: 'Document', sql: `title` },
};
const entity = z.enum(RECYCLABLE);

router.get('/recycle-bin', requirePermission('recycle_bin.manage'), async (req, res) => {
  const only = req.query.entity ? entity.parse(req.query.entity) : null;
  const s = institutionId(req);
  const rows = await withDeleted(async () => {
    const parts = (only ? [only] : RECYCLABLE).map(
      (t) => `SELECT '${t}' AS entity, id, ${LABELS[t].sql} AS name, deleted_at, deleted_by FROM ${t} WHERE institution_id = $1 AND deleted_at IS NOT NULL`
    );
    const { rows } = await db.query(
      `SELECT x.*, u.full_name AS deleted_by_name, GREATEST(0, $2 - floor(extract(epoch FROM now() - x.deleted_at) / 86400))::int AS days_left
         FROM (${parts.join(' UNION ALL ')}) x LEFT JOIN users u ON u.id = x.deleted_by
        ORDER BY x.deleted_at DESC LIMIT 500`,
      [s, RETENTION_DAYS]
    );
    return rows;
  });
  res.json(rows.map((r) => ({ ...r, kind: LABELS[r.entity as (typeof RECYCLABLE)[number]].label })));
});

router.post('/recycle-bin/:entity/:id/restore', requirePermission('recycle_bin.manage'), async (req, res) => {
  const t = entity.parse(req.params.entity);
  const rowId = id.parse(req.params.id);
  const s = institutionId(req);
  if (!(await restoreDeleted(t, rowId, s))) throw notFound('Nothing to restore');
  // people get their sign-in back (unless they had left or graduated before)
  if (t === 'students') {
    await db.query(
      `UPDATE users u SET is_active = true FROM students st WHERE st.id = $1 AND u.ref_id = st.id AND u.role = 'student' AND u.institution_id = $2 AND st.status = 'active'`,
      [rowId, s]
    );
  } else if (t === 'teachers') {
    await db.query(
      `UPDATE users u SET is_active = true FROM teachers t WHERE t.id = $1 AND u.ref_id = t.id AND u.role = 'teacher' AND u.institution_id = $2 AND t.status <> 'left'`,
      [rowId, s]
    );
  } else if (t === 'guardians') {
    await db.query(`UPDATE users u SET is_active = true FROM guardians g WHERE g.id = $1 AND u.id = g.user_id`, [rowId]);
  }
  res.json({ ok: true });
});

/** Permanently delete. The client must repeat the record's type and id to confirm. */
router.delete('/recycle-bin/:entity/:id', requirePermission('recycle_bin.manage'), async (req, res) => {
  const t = entity.parse(req.params.entity);
  const rowId = id.parse(req.params.id);
  const confirm = z.object({ confirm: z.string() }).safeParse(req.body ?? {});
  if (!confirm.success || confirm.data.confirm !== `${t}/${rowId}`) throw badRequest(`Confirm by sending { "confirm": "${t}/${rowId}" }`);
  const s = institutionId(req);
  if (!(await purgeRecord(t, rowId, s))) throw notFound('Nothing to delete');
  res.status(204).end();
});

// ---------------------------------------------------------------- audit trail

router.get('/audit', requirePermission('audit.read'), async (req, res) => {
  const pg = parsePage(req.query);
  const f = auditQuery.parse(req.query);
  const params: unknown[] = [institutionId(req)];
  let where = 'a.institution_id = $1';
  for (const [col, v] of [['a.entity', f.entity], ['a.entity_id', f.entity_id], ['a.action', f.action], ['a.user_id', f.user_id]] as const) {
    if (v) {
      params.push(v);
      where += ` AND ${col} = $${params.length}`;
    }
  }
  if (f.from) {
    params.push(f.from);
    where += ` AND a.created_at >= $${params.length}::date`;
  }
  if (f.to) {
    params.push(f.to);
    where += ` AND a.created_at < $${params.length}::date + 1`;
  }
  params.push(pg.limit, pg.offset);
  const { rows } = await db.query(
    `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.changes, a.detail, a.request_id,
            COALESCE(u.full_name, NULLIF(a.actor, ''), 'System') AS actor, a.user_id, count(*) OVER() _total
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  sendPage(res, rows, pg);
});

export default router;

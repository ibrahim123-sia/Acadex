// Institution groups (school networks, university systems): the group administrator's view of
// every member institution. Cross-tenant by design, so it runs in a system context with an
// explicit filter to the caller's groups. Mounted at /api/group.
import { Router } from 'express';
import { asSystem, db } from '../db/context';
import { forbidden } from '../lib/errors';
import { auth, currentUser } from '../middleware/auth';
import { groupScope } from '../rbac';

const router = Router();
router.use(auth);

router.get('/overview', async (req, res) => {
  const groups = groupScope(currentUser(req), 'group.read');
  if (!groups.length) throw forbidden('You do not administer a group of institutions');
  const data = await asSystem(async () => {
    const [g, institutions] = await Promise.all([
      db.query(`SELECT id, name, slug FROM institution_groups WHERE id = ANY($1::int[]) ORDER BY name`, [groups]),
      db.query(
        `SELECT i.id, i.name, i.slug, i.type, i.status, i.plan, i.currency, i.group_id,
                (SELECT count(*)::int FROM campuses c WHERE c.institution_id = i.id AND c.deleted_at IS NULL) campuses,
                (SELECT count(*)::int FROM students s WHERE s.institution_id = i.id AND s.status = 'active' AND s.deleted_at IS NULL) students,
                (SELECT count(*)::int FROM teachers t WHERE t.institution_id = i.id AND t.status <> 'left' AND t.deleted_at IS NULL) staff,
                (SELECT count(*)::int FROM sections x WHERE x.institution_id = i.id AND x.status = 'active' AND x.deleted_at IS NULL) sections,
                (SELECT COALESCE(sum(f.paid_amount), 0)::float8 FROM tuition_fee f WHERE f.institution_id = i.id) fee_collected,
                (SELECT COALESCE(sum(f.remaining_balance), 0)::float8 FROM tuition_fee f WHERE f.institution_id = i.id) fee_outstanding,
                (SELECT round(100.0 * count(*) FILTER (WHERE a.status IN ('present', 'late')) / NULLIF(count(*) FILTER (WHERE a.status IN ('present', 'late', 'absent')), 0), 1) FROM attendance_records a
                  JOIN attendance_sessions sn ON sn.id = a.session_id WHERE a.institution_id = i.id AND sn.date >= (now() AT TIME ZONE i.timezone)::date - 7) attendance_rate
           FROM institutions i WHERE i.group_id = ANY($1::int[]) ORDER BY i.name`,
        [groups]
      ),
    ]);
    return { groups: g.rows, institutions: institutions.rows };
  });
  res.json(data);
});

export default router;

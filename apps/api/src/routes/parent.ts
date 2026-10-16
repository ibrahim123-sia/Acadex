import { Router } from 'express';
import { idParam } from '@acadex/shared';
import { db } from '../db/context';
import { assertCanViewStudent, guardianLink } from '../lib/access';
import { FEE_TOTALS_SQL, feeStatusSql } from '../lib/finance/summary';
import { ATTENDANCE_COUNTS_SQL, RELEASED_GRADES_SQL } from '../lib/lms/student';
import { auth, currentUser, requirePermission, institutionId } from '../middleware/auth';

const router = Router();
router.use(auth, requirePermission('guardian.access'));

// Children of the logged-in parent
router.get('/children', async (req, res) => {
  const { rows } = await db.query(
    `SELECT st.id, st.roll_no, st.first_name||' '||st.last_name name, c.name section_name,
            CASE WHEN pc.can_view_fees THEN ${feeStatusSql('st.id')} ELSE '—' END fee_status
       FROM guardianships pc
       JOIN guardians g ON g.id=pc.guardian_id
       JOIN students st ON st.id=pc.student_id AND st.institution_id=pc.institution_id
       LEFT JOIN sections c ON c.id=st.section_id
      WHERE g.user_id=$1 AND pc.institution_id=$2`,
    [currentUser(req).id, institutionId(req)]
  );
  res.json(rows);
});

// One child's full overview (guarded — must be linked to this parent in this institution)
router.get('/child/:id/overview', async (req, res) => {
  const { id: studentId } = idParam('id').parse(req.params);
  await assertCanViewStudent(currentUser(req), studentId);
  const s = institutionId(req);
  // what this guardian may see (per-guardian permissions)
  const link = (await guardianLink(currentUser(req).id, studentId, s))!;
  const [profile, grades, attendance, fee] = await Promise.all([
    db.query(
      `SELECT st.id, st.roll_no, st.first_name, st.last_name, st.gender, st.dob, st.email, st.admission_date, st.status,
              c.name section_name FROM students st LEFT JOIN sections c ON c.id=st.section_id WHERE st.id=$1 AND st.institution_id=$2`,
      [studentId, s]
    ),
    db.query(
      RELEASED_GRADES_SQL,
      [studentId, s]
    ),
    db.query(
      ATTENDANCE_COUNTS_SQL,
      [studentId, s]
    ),
    db.query(FEE_TOTALS_SQL, [studentId, s]),
  ]);
  res.json({
    profile: profile.rows[0],
    grades: link.can_view_grades ? grades.rows : null,
    attendance: attendance.rows,
    fee: link.can_view_fees && fee.rows[0]?.invoices ? fee.rows[0] : null,
    permissions: { grades: link.can_view_grades, fees: link.can_view_fees, messages: link.can_message },
  });
});

export default router;

import { Router } from 'express';
import { idParam } from '@acadex/shared';
import { db } from '../db/context';
import { assertCanViewStudent, guardianLink } from '../lib/access';
import { auth, currentUser, requirePermission, institutionId } from '../middleware/auth';

const router = Router();
router.use(auth, requirePermission('guardian.access'));

// Children of the logged-in parent
router.get('/children', async (req, res) => {
  const { rows } = await db.query(
    `SELECT st.id, st.roll_no, st.first_name||' '||st.last_name name, c.name section_name,
            COALESCE((SELECT payment_status FROM tuition_fee f WHERE f.student_id=st.id AND f.institution_id=st.institution_id
                      ORDER BY id DESC LIMIT 1),'—') fee_status
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
      `SELECT co.name subject, g.assignment_name, g.assignment_type, g.obtained_marks, g.total_marks,
              ROUND(g.obtained_marks/NULLIF(g.total_marks,0)*100,1) percentage
         FROM grades g LEFT JOIN course_offerings su ON su.id=g.offering_id LEFT JOIN courses co ON co.id=su.course_id
        WHERE g.student_id=$1 AND g.institution_id=$2 ORDER BY g.id DESC`,
      [studentId, s]
    ),
    db.query(
      `SELECT status, count(*)::int c FROM student_attendance WHERE student_id=$1 AND institution_id=$2 GROUP BY status`,
      [studentId, s]
    ),
    db.query(
      `SELECT total_fee, paid_amount, remaining_balance, payment_status
         FROM tuition_fee WHERE student_id=$1 AND institution_id=$2 ORDER BY id DESC LIMIT 1`,
      [studentId, s]
    ),
  ]);
  res.json({
    profile: profile.rows[0],
    grades: link.can_view_grades ? grades.rows : null,
    attendance: attendance.rows,
    fee: link.can_view_fees ? (fee.rows[0] ?? null) : null,
    permissions: { grades: link.can_view_grades, fees: link.can_view_fees, messages: link.can_message },
  });
});

export default router;

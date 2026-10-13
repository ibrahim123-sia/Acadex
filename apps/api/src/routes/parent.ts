import { Router } from 'express';
import { idParam } from '@acadex/shared';
import { pool } from '../db/pool';
import { assertCanViewStudent } from '../lib/access';
import { auth, currentUser, requirePermission, schoolId } from '../middleware/auth';

const router = Router();
router.use(auth, requirePermission('guardian.access'));

// Children of the logged-in parent
router.get('/children', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT st.id, st.roll_no, st.first_name||' '||st.last_name name, c.name class_name,
            COALESCE((SELECT payment_status FROM tuition_fee f WHERE f.student_id=st.id AND f.school_id=st.school_id
                      ORDER BY id DESC LIMIT 1),'—') fee_status
       FROM parent_children pc
       JOIN students st ON st.id=pc.student_id AND st.school_id=pc.school_id
       LEFT JOIN classes c ON c.id=st.class_id
      WHERE pc.parent_user_id=$1 AND pc.school_id=$2`,
    [currentUser(req).id, schoolId(req)]
  );
  res.json(rows);
});

// One child's full overview (guarded — must be linked to this parent in this school)
router.get('/child/:id/overview', async (req, res) => {
  const { id: studentId } = idParam('id').parse(req.params);
  await assertCanViewStudent(currentUser(req), studentId);
  const s = schoolId(req);
  const [profile, grades, attendance, fee] = await Promise.all([
    pool.query(
      `SELECT st.*, c.name class_name FROM students st LEFT JOIN classes c ON c.id=st.class_id WHERE st.id=$1 AND st.school_id=$2`,
      [studentId, s]
    ),
    pool.query(
      `SELECT su.name subject, g.assignment_name, g.assignment_type, g.obtained_marks, g.total_marks,
              ROUND(g.obtained_marks/NULLIF(g.total_marks,0)*100,1) percentage
         FROM grades g LEFT JOIN subjects su ON su.id=g.subject_id
        WHERE g.student_id=$1 AND g.school_id=$2 ORDER BY g.id DESC`,
      [studentId, s]
    ),
    pool.query(
      `SELECT status, count(*)::int c FROM student_attendance WHERE student_id=$1 AND school_id=$2 GROUP BY status`,
      [studentId, s]
    ),
    pool.query(
      `SELECT total_fee, paid_amount, remaining_balance, payment_status
         FROM tuition_fee WHERE student_id=$1 AND school_id=$2 ORDER BY id DESC LIMIT 1`,
      [studentId, s]
    ),
  ]);
  res.json({ profile: profile.rows[0], grades: grades.rows, attendance: attendance.rows, fee: fee.rows[0] || null });
});

export default router;

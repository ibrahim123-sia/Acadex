const { Router } = require('../lib/router');
const pool = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');

const router = Router();
router.use(auth, requireRole('parent'));

// Children of the logged-in parent
router.get('/children', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT st.id, st.roll_no, st.first_name||' '||st.last_name name, c.name class_name,
            COALESCE((SELECT payment_status FROM tuition_fee f WHERE f.student_id=st.id ORDER BY id DESC LIMIT 1),'—') fee_status
     FROM parent_children pc JOIN students st ON st.id=pc.student_id LEFT JOIN classes c ON c.id=st.class_id
     WHERE pc.parent_user_id=$1`, [req.user.id]);
  res.json(rows);
});

// One child's full overview (guarded — must belong to this parent)
router.get('/child/:id/overview', async (req, res) => {
  const own = await pool.query(`SELECT 1 FROM parent_children WHERE parent_user_id=$1 AND student_id=$2`, [req.user.id, req.params.id]);
  if (!own.rows[0]) return res.status(403).json({ error: 'Not your child' });
  const [profile, grades, attendance, fee] = await Promise.all([
    pool.query(`SELECT st.*, c.name class_name FROM students st LEFT JOIN classes c ON c.id=st.class_id WHERE st.id=$1`, [req.params.id]),
    pool.query(`SELECT su.name subject, g.assignment_name, g.assignment_type, g.obtained_marks, g.total_marks,
                  ROUND(g.obtained_marks/NULLIF(g.total_marks,0)*100,1) percentage
                FROM grades g LEFT JOIN subjects su ON su.id=g.subject_id WHERE g.student_id=$1 ORDER BY g.id DESC`, [req.params.id]),
    pool.query(`SELECT status, count(*)::int c FROM student_attendance WHERE student_id=$1 GROUP BY status`, [req.params.id]),
    pool.query(`SELECT total_fee, paid_amount, remaining_balance, payment_status FROM tuition_fee WHERE student_id=$1 ORDER BY id DESC LIMIT 1`, [req.params.id]),
  ]);
  res.json({ profile: profile.rows[0], grades: grades.rows, attendance: attendance.rows, fee: fee.rows[0] || null });
});

module.exports = router;

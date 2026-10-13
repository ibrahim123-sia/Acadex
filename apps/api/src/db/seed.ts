// Demo data for local development. The Phase 1 seed replaces this with four tenants.
import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { todayIn } from '../lib/locale';

const TZ = 'Asia/Karachi'; // demo schools use the default school timezone

const PW = 'Acadex@123';

const rand = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function q(text: string, params?: unknown[]): Promise<any[]> { return (await pool.query(text, params)).rows; }

async function makeUser(school_id: number | null, role: string, email: string, full_name: string, ref_id: number | null, hash: string) {
  await q(
    `INSERT INTO users (school_id, role, email, password_hash, full_name, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING`,
    [school_id, role, email.toLowerCase(), hash, full_name, ref_id]
  );
}

const FIRST = ['Ali','Fatima','Hamza','Zainab','Ahmed','Maryam','Hassan','Aisha','Omar','Iqra','Saad','Noor','Talha','Areeba','Bilal','Sana','Usman','Hina','Danish','Mahnoor','Faizan','Rida','Kashan','Emaan'];
const LAST = ['Sheikh','Butt','Qureshi','Farooq','Nadeem','Javed','Aslam','Riaz','Khalid','Tariq','Mehmood','Siddiqui','Anwar','Baig','Malik','Raza','Khan','Shah'];
const SUBJECTS_BY: Record<string, string[]> = {
  'KG': ['English','Mathematics','Art & Craft','General Knowledge'],
  'Primary': ['English','Mathematics','Science','Social Studies','Islamiat','Urdu'],
  'Secondary': ['English','Mathematics','Physics','Chemistry','Biology','Computer Science','Islamiat','Urdu'],
};

interface ClassDef { code: string; name: string; tier: string }
interface SchoolDef { name: string; slug: string; color: string; plan: string; adminEmail: string; classDefs: ClassDef[]; numTeachers: number; studentsPerClass: number }

async function seedSchool({ name, slug, color, plan, adminEmail, classDefs, numTeachers, studentsPerClass }: SchoolDef, hash: string) {
  const [school] = await q(
    `INSERT INTO schools (name, slug, primary_color, plan, contact_email, phone, address)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [name, slug, color, plan, adminEmail, '+92 300 1234567', 'Main Campus, Karachi, Pakistan']
  );
  const sid = school.id;
  await makeUser(sid, 'school_admin', adminEmail, `${name} Administrator`, null, hash);

  // classes + subjects
  const classes: Array<ClassDef & { id: number; subjects: { id: number; name: string }[] }> = [];
  for (const cd of classDefs) {
    const [c] = await q(`INSERT INTO classes (school_id, code, name, section) VALUES ($1,$2,$3,$4) RETURNING id`,
      [sid, cd.code, cd.name, 'A']);
    const subs = SUBJECTS_BY[cd.tier] ?? [];
    const subjectIds: { id: number; name: string }[] = [];
    for (const s of subs) {
      const code = s.slice(0, 3).toUpperCase() + cd.code;
      const [su] = await q(`INSERT INTO subjects (school_id, class_id, code, name) VALUES ($1,$2,$3,$4) RETURNING id`,
        [sid, c.id, code, s]);
      subjectIds.push({ id: su.id, name: s });
    }
    classes.push({ id: c.id, ...cd, subjects: subjectIds });
  }

  // teachers
  const teachers: { id: number; name: string }[] = [];
  for (let i = 0; i < numTeachers; i++) {
    const fn = FIRST[(i * 3) % FIRST.length]!, ln = LAST[(i * 5) % LAST.length]!;
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}.t${i}@${slug}.edu`;
    const [t] = await q(
      `INSERT INTO teachers (school_id, first_name, last_name, gender, dob, email, phone, cnic, qualification)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [sid, fn, ln, i % 2 ? 'Female' : 'Male', `198${i % 9}-04-12`, email, `+9230012${1000 + i}`,
       `42101-${1000000 + i}-${i % 9}`, rand(['M.Sc','M.A','B.Ed','B.Sc','M.Phil'])]
    );
    await makeUser(sid, 'teacher', email, `${fn} ${ln}`, t.id, hash);
    teachers.push({ id: t.id, name: `${fn} ${ln}` });
  }

  // teacher_subjects (spread teachers across subjects)
  let tIdx = 0;
  for (const c of classes) {
    for (const s of c.subjects) {
      const t = teachers[tIdx % teachers.length]!;
      await q(`INSERT INTO teacher_subjects (school_id, teacher_id, subject_id, class_id) VALUES ($1,$2,$3,$4)`,
        [sid, t.id, s.id, c.id]);
      // a timetable row
      await q(`INSERT INTO timetable (school_id, class_id, day_of_week, time_slot, subject, teacher_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [sid, c.id, rand(['Monday','Tuesday','Wednesday','Thursday','Friday']), rand(['08:00-08:45','08:45-09:30','09:30-10:15','10:45-11:30']), s.name, t.id]);
      tIdx++;
    }
  }

  // students + fees + grades + attendance
  const createdStudents: { id: number; name: string; class_id: number; email: string }[] = [];
  let sCount = 0;
  for (const c of classes) {
    for (let j = 0; j < studentsPerClass; j++) {
      const fn = FIRST[(sCount * 2) % FIRST.length]!, ln = LAST[(sCount * 3 + 1) % LAST.length]!;
      const email = `${fn.toLowerCase()}.${ln.toLowerCase()}.s${sCount}@${slug}.edu`;
      const roll = `${slug.toUpperCase().slice(0,3)}-${c.code}-${String(j + 1).padStart(3, '0')}`;
      const [st] = await q(
        `INSERT INTO students (school_id, roll_no, first_name, last_name, age, gender, email, phone, dob, class_id, guardian_name, guardian_phone, city)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [sid, roll, fn, ln, 5 + (sCount % 12), sCount % 2 ? 'Female' : 'Male', email, `+9231012${2000 + sCount}`,
         `201${sCount % 9}-06-15`, c.id, `${rand(FIRST)} ${ln}`, `+9230098${3000 + sCount}`, rand(['Karachi','Lahore','Islamabad'])]
      );
      await makeUser(sid, 'student', email, `${fn} ${ln}`, st.id, hash);
      createdStudents.push({ id: st.id, name: `${fn} ${ln}`, class_id: c.id, email });

      // fee
      const total = rand([25000, 30000, 35000, 40000]);
      const paid = rand([total, total, total * 0.5, 0]);
      const status = paid >= total ? 'Paid' : paid > 0 ? 'Partial' : 'Pending';
      await q(`INSERT INTO tuition_fee (school_id, receipt_id, student_id, total_fee, paid_amount, remaining_balance, payment_status)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sid, `RCP-${slug.toUpperCase().slice(0,2)}-${1000 + sCount}`, st.id, total, paid, total - paid, status]);

      // grades (2-3 per student across subjects)
      for (const s of c.subjects.slice(0, 3)) {
        const totalM = 100, obt = 55 + ((sCount * 7 + s.id) % 45);
        await q(`INSERT INTO grades (school_id, student_id, class_id, subject_id, assignment_type, assignment_name, obtained_marks, total_marks)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sid, st.id, c.id, s.id, rand(['Quiz','Midterm','Assignment','Final']), `${s.name} ${rand(['Quiz 1','Midterm','Test'])}`, obt, totalM]);
      }

      // attendance last 5 days
      for (let d = 1; d <= 5; d++) {
        const dt = new Date(); dt.setDate(dt.getDate() - d);
        await q(`INSERT INTO student_attendance (school_id, student_id, class_id, subject, att_date, status)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
          [sid, st.id, c.id, rand(c.subjects).name, todayIn(TZ, dt),
           (sCount + d) % 7 === 0 ? 'Absent' : 'Present']);
      }
      sCount++;
    }
  }

  // teacher attendance (today)
  const today = todayIn(TZ);
  for (const t of teachers) {
    await q(`INSERT INTO teacher_attendance (school_id, teacher_id, att_date, status) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [sid, t.id, today, rand(['Present','Present','Present','Leave'])]);
  }

  // exams
  for (const c of classes.slice(0, 4)) {
    for (const s of c.subjects.slice(0, 3)) {
      const dt = new Date(); dt.setDate(dt.getDate() + 7 + (c.id % 10));
      await q(`INSERT INTO exam_schedule (school_id, class_id, exam_name, subject, exam_date, time_slot, total_marks)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [sid, c.id, 'Mid-Term Examination', s.name, todayIn(TZ, dt), '09:00-11:00', 100]);
    }
  }

  // announcements
  const anns = [
    ['Mid-Term Exams Schedule Released', 'All', 'The mid-term examination timetable is now available. Please check the exam schedule section.'],
    ['Parent-Teacher Meeting', 'All', 'A parent-teacher meeting is scheduled for this Saturday at 10:00 AM in the main hall.'],
    ['Staff Development Workshop', 'Teachers', 'A professional development workshop will be held Friday afternoon. Attendance is mandatory.'],
    ['Annual Sports Day', 'Students', 'Get ready! Annual Sports Day is coming up next month. Registrations open now.'],
    ['Fee Submission Reminder', 'Students', 'Kindly submit the outstanding tuition fee before the 10th to avoid late charges.'],
  ];
  for (const a of anns) {
    const end = new Date(); end.setDate(end.getDate() + 30);
    await q(`INSERT INTO announcements (school_id, title, target_audience, description, end_date) VALUES ($1,$2,$3,$4,$5)`,
      [sid, a[0], a[1], a[2], todayIn(TZ, end)]);
  }

  // audit log samples
  for (const a of [['create_school','School'],['add_teacher','Teacher'],['fee_collected','TuitionFee'],['add_announcement','Announcement']]) {
    await q(`INSERT INTO audit_log (school_id, actor, action, entity, detail) VALUES ($1,$2,$3,$4,$5)`,
      [sid, adminEmail, a[0], a[1], 'demo seed activity']);
  }

  // assignments (teacher → whole class) + a few submissions
  let aIdx = 0;
  for (const c of classes.slice(0, 4)) {
    for (const s of c.subjects.slice(0, 2)) {
      const t = teachers[aIdx % teachers.length]!;
      const due = new Date(); due.setDate(due.getDate() + 5 + (aIdx % 7));
      const [asg] = await q(
        `INSERT INTO assignments (school_id, class_id, subject_id, teacher_id, title, description, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [sid, c.id, s.id, t.id, `${s.name}: ${rand(['Chapter Review','Worksheet','Project','Practice Problems'])}`,
         `Complete the assigned ${s.name} tasks and submit before the due date.`, todayIn(TZ, due)]);
      // a couple of submissions from students of this class
      const classStudents = createdStudents.filter((x) => x.class_id === c.id).slice(0, 2);
      for (const cs of classStudents) {
        await q(`INSERT INTO submissions (school_id, assignment_id, student_id, title, file_link, grade)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
          [sid, asg.id, cs.id, `${cs.name} — submission`, 'https://example.com/uploads/submission.pdf', rand(['A','B+','A-','B'])]);
      }
      aIdx++;
    }
  }

  // one parent linked to the first 2 students, with login + a notification
  if (createdStudents.length >= 2) {
    const parentEmail = `parent1@${slug}.edu`;
    await makeUser(sid, 'parent', parentEmail, `${LAST[0]!} Family (Parent)`, null, hash);
    const [pu] = await q(`SELECT id FROM users WHERE email=$1`, [parentEmail]);
    for (const child of createdStudents.slice(0, 2)) {
      await q(`INSERT INTO parent_children (school_id, parent_user_id, student_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [sid, pu.id, child.id]);
    }
    await q(`INSERT INTO notifications (school_id, user_id, type, title, message) VALUES ($1,$2,'fee','Fee reminder','A tuition fee installment is due for your child this week.')`, [sid, pu.id]);
    await q(`INSERT INTO notifications (school_id, user_id, type, title, message) VALUES ($1,$2,'grade','New grade posted','A new assessment result has been published.')`, [sid, pu.id]);
  }

  // notifications for admin, a teacher, a student
  const admin = (await q(`SELECT id FROM users WHERE email=$1`, [adminEmail.toLowerCase()]))[0];
  if (admin) {
    await q(`INSERT INTO notifications (school_id, user_id, type, title, message) VALUES ($1,$2,'info','New admissions','Several new students were admitted this week.')`, [sid, admin.id]);
    await q(`INSERT INTO notifications (school_id, user_id, type, title, message) VALUES ($1,$2,'fee','Outstanding fees','Some students have pending fee balances.')`, [sid, admin.id]);
  }
  for (const role of ['teacher', 'student']) {
    const u = (await q(`SELECT id FROM users WHERE school_id=$1 AND role=$2 ORDER BY id LIMIT 1`, [sid, role]))[0];
    if (u) await q(`INSERT INTO notifications (school_id, user_id, type, title, message) VALUES ($1,$2,'announcement','New announcement','Check the latest school announcement.')`, [sid, u.id]);
  }

  return { sid, teachers: teachers.length, students: sCount, classes: classes.length };
}

// Demo data only. Refuses to run in production, and refuses to touch a database that
// already has data unless --reset is passed (which wipes every tenant table first).
async function guard() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data when NODE_ENV=production');
  }
  const reset = process.argv.includes('--reset');
  const [{ n }] = await q(`SELECT (SELECT count(*) FROM schools) + (SELECT count(*) FROM users) AS n`);
  if (Number(n) > 0 && !reset) {
    throw new Error('Database already has data. Run "npm run db:reset" to wipe it and reseed.');
  }
  if (reset) {
    await q('TRUNCATE notifications, parent_children, audit_log, submissions, assignments, grades, student_attendance, teacher_attendance, timetable, exam_schedule, tuition_fee, teacher_subjects, subjects, students, teachers, classes, users, announcements, schools RESTART IDENTITY CASCADE');
  }
}

(async () => {
  try {
    await guard();
    const hash = await bcrypt.hash(PW, 10);

    // Super admin (platform)
    await makeUser(null, 'super_admin', 'superadmin@acadex.com', 'Acadex Super Admin', null, hash);

    const primaryClasses = [
      { code: 'KG', name: 'Kindergarten', tier: 'KG' },
      { code: 'C1', name: 'Class I', tier: 'Primary' },
      { code: 'C2', name: 'Class II', tier: 'Primary' },
      { code: 'C5', name: 'Class V', tier: 'Primary' },
      { code: 'C9', name: 'Class IX', tier: 'Secondary' },
      { code: 'C10', name: 'Class X', tier: 'Secondary' },
    ];
    const r1 = await seedSchool({
      name: 'Greenwood High School', slug: 'greenwood', color: '#16A34A', plan: 'pro',
      adminEmail: 'admin@greenwood.edu', classDefs: primaryClasses, numTeachers: 8, studentsPerClass: 5,
    }, hash);

    const r2 = await seedSchool({
      name: 'Sunrise Academy', slug: 'sunrise', color: '#EA580C', plan: 'free',
      adminEmail: 'admin@sunrise.edu',
      classDefs: [
        { code: 'C1', name: 'Class I', tier: 'Primary' },
        { code: 'C2', name: 'Class II', tier: 'Primary' },
        { code: 'C9', name: 'Class IX', tier: 'Secondary' },
      ], numTeachers: 4, studentsPerClass: 4,
    }, hash);

    console.log('Greenwood:', r1);
    console.log('Sunrise:', r2);
    console.log('SEED DONE. Password for all demo users:', PW);
    await pool.end();
  } catch (e) {
    console.error('❌ Seed failed:', (e as Error).message);
    await pool.end().catch(() => {});
    process.exit(1);
  }
})();

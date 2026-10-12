-- ============================================================
--  Acadex — Multi-tenant School Management SaaS (PostgreSQL)
--  Every tenant table carries school_id for row-level isolation.
--  Baseline migration: the schema as it existed before versioned migrations.
--  Idempotent (IF NOT EXISTS) so it is safe on databases created by the old schema.sql.
-- ============================================================

-- ---------- Platform (tenant registry) ----------
CREATE TABLE IF NOT EXISTS schools (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  logo_url      TEXT DEFAULT '',
  primary_color TEXT DEFAULT '#2563EB',
  contact_email TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ---------- Unified auth ----------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  school_id     INT REFERENCES schools(id) ON DELETE CASCADE,   -- NULL only for super_admin
  role          TEXT NOT NULL CHECK (role IN ('super_admin','school_admin','teacher','student','parent')),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  ref_id        INT,            -- teachers.id or students.id for profile linkage
  is_active     BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);

-- ---------- Academic structure ----------
CREATE TABLE IF NOT EXISTS classes (
  id         SERIAL PRIMARY KEY,
  school_id  INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  section    TEXT DEFAULT 'A',
  UNIQUE (school_id, code)
);

CREATE TABLE IF NOT EXISTS subjects (
  id         SERIAL PRIMARY KEY,
  school_id  INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id   INT REFERENCES classes(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects(school_id);

-- ---------- People ----------
CREATE TABLE IF NOT EXISTS teachers (
  id           SERIAL PRIMARY KEY,
  school_id    INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  first_name   TEXT NOT NULL,
  last_name    TEXT NOT NULL,
  gender       TEXT,
  dob          DATE,
  email        TEXT NOT NULL,
  phone        TEXT,
  cnic         TEXT,
  qualification TEXT DEFAULT '',
  photo_url    TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (school_id, email)
);
CREATE INDEX IF NOT EXISTS idx_teachers_school ON teachers(school_id);

CREATE TABLE IF NOT EXISTS students (
  id             SERIAL PRIMARY KEY,
  school_id      INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  roll_no        TEXT,
  first_name     TEXT NOT NULL,
  last_name      TEXT NOT NULL,
  age            INT,
  gender         TEXT,
  email          TEXT NOT NULL,
  phone          TEXT,
  dob            DATE,
  class_id       INT REFERENCES classes(id) ON DELETE SET NULL,
  guardian_name  TEXT DEFAULT '',
  guardian_phone TEXT DEFAULT '',
  city           TEXT DEFAULT '',
  photo_url      TEXT DEFAULT '',
  admission_date DATE DEFAULT CURRENT_DATE,
  status         TEXT DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (school_id, email)
);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id         SERIAL PRIMARY KEY,
  school_id  INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id   INT REFERENCES classes(id) ON DELETE CASCADE
);

-- ---------- Operations ----------
CREATE TABLE IF NOT EXISTS tuition_fee (
  id                SERIAL PRIMARY KEY,
  school_id         INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  receipt_id        TEXT NOT NULL,
  student_id        INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  total_fee         NUMERIC(10,2) NOT NULL,
  paid_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  remaining_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_date      DATE DEFAULT CURRENT_DATE,
  payment_status    TEXT NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Paid','Partial','Pending')),
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_school ON tuition_fee(school_id);

CREATE TABLE IF NOT EXISTS grades (
  id              SERIAL PRIMARY KEY,
  school_id       INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id      INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id        INT REFERENCES classes(id) ON DELETE SET NULL,
  subject_id      INT REFERENCES subjects(id) ON DELETE SET NULL,
  assignment_type TEXT NOT NULL,
  assignment_name TEXT NOT NULL,
  obtained_marks  NUMERIC(10,2) NOT NULL,
  total_marks     NUMERIC(10,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grades_school ON grades(school_id);

CREATE TABLE IF NOT EXISTS assignments (
  id           SERIAL PRIMARY KEY,
  school_id    INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id     INT REFERENCES classes(id) ON DELETE CASCADE,
  subject_id   INT REFERENCES subjects(id) ON DELETE SET NULL,
  teacher_id   INT REFERENCES teachers(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT DEFAULT '',
  due_date     DATE,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id            SERIAL PRIMARY KEY,
  school_id     INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id INT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  title         TEXT DEFAULT '',
  file_link     TEXT DEFAULT '',
  grade         TEXT DEFAULT '',
  submitted_date TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_attendance (
  id         SERIAL PRIMARY KEY,
  school_id  INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id   INT REFERENCES classes(id) ON DELETE CASCADE,
  subject    TEXT DEFAULT '',
  att_date   DATE NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('Present','Absent','Leave'))
);
CREATE INDEX IF NOT EXISTS idx_satt_school ON student_attendance(school_id);

CREATE TABLE IF NOT EXISTS teacher_attendance (
  id         SERIAL PRIMARY KEY,
  school_id  INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id INT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  att_date   DATE NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('Present','Absent','Leave')),
  UNIQUE (teacher_id, att_date)
);

CREATE TABLE IF NOT EXISTS timetable (
  id         SERIAL PRIMARY KEY,
  school_id  INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id   INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL,
  time_slot  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS exam_schedule (
  id         SERIAL PRIMARY KEY,
  school_id  INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id   INT REFERENCES classes(id) ON DELETE CASCADE,
  exam_name  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  exam_date  DATE NOT NULL,
  time_slot  TEXT DEFAULT '',
  total_marks INT DEFAULT 100
);

CREATE TABLE IF NOT EXISTS announcements (
  id            SERIAL PRIMARY KEY,
  school_id     INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  target_audience TEXT NOT NULL DEFAULT 'All' CHECK (target_audience IN ('All','Teachers','Students')),
  description   TEXT NOT NULL,
  start_date    DATE DEFAULT CURRENT_DATE,
  end_date      DATE,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ann_school ON announcements(school_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  school_id  INT REFERENCES schools(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  actor      TEXT DEFAULT '',
  action     TEXT NOT NULL,
  entity     TEXT DEFAULT '',
  detail     TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_school ON audit_log(school_id);

-- ---------- Parent → child links ----------
CREATE TABLE IF NOT EXISTS parent_children (
  id             SERIAL PRIMARY KEY,
  school_id      INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id     INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE (parent_user_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_pc_parent ON parent_children(parent_user_id);

-- ---------- Notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  school_id  INT REFERENCES schools(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL,
  message    TEXT DEFAULT '',
  link       TEXT DEFAULT '',
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

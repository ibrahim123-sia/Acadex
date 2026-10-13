CREATE TABLE "schools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text DEFAULT '',
	"primary_color" text DEFAULT '#2563EB',
	"contact_email" text DEFAULT '',
	"phone" text DEFAULT '',
	"address" text DEFAULT '',
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"currency" text DEFAULT 'PKR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Karachi' NOT NULL,
	"locale" text DEFAULT 'en-PK' NOT NULL,
	CONSTRAINT "schools_slug_key" UNIQUE("slug"),
	CONSTRAINT "schools_currency_iso" CHECK ("schools"."currency" ~ '^[A-Z]{3}$'::text),
	CONSTRAINT "schools_plan_check" CHECK ("schools"."plan" = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text])),
	CONSTRAINT "schools_status_check" CHECK ("schools"."status" = ANY (ARRAY['active'::text, 'suspended'::text]))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer,
	"role" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"ref_id" integer,
	"is_active" boolean DEFAULT true,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"token_version" integer DEFAULT 0 NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"password_changed_at" timestamp with time zone,
	CONSTRAINT "users_email_key" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" = ANY (ARRAY['super_admin'::text, 'school_admin'::text, 'teacher'::text, 'student'::text, 'parent'::text]))
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"section" text DEFAULT 'A',
	CONSTRAINT "classes_school_id_code_key" UNIQUE("school_id","code")
);
--> statement-breakpoint
CREATE TABLE "exam_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"class_id" integer,
	"exam_name" text NOT NULL,
	"subject" text NOT NULL,
	"exam_date" date NOT NULL,
	"time_slot" text DEFAULT '',
	"total_marks" integer DEFAULT 100
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"roll_no" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"age" integer,
	"gender" text,
	"email" text NOT NULL,
	"phone" text,
	"dob" date,
	"class_id" integer,
	"guardian_name" text DEFAULT '',
	"guardian_phone" text DEFAULT '',
	"city" text DEFAULT '',
	"photo_url" text DEFAULT '',
	"admission_date" date DEFAULT CURRENT_DATE,
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "students_school_id_email_key" UNIQUE("school_id","email"),
	CONSTRAINT "students_status_check" CHECK ("students"."status" = ANY (ARRAY['active'::text, 'inactive'::text]))
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"class_id" integer,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_subjects" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"subject_id" integer NOT NULL,
	"class_id" integer
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"gender" text,
	"dob" date,
	"email" text NOT NULL,
	"phone" text,
	"cnic" text,
	"qualification" text DEFAULT '',
	"photo_url" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "teachers_school_id_email_key" UNIQUE("school_id","email")
);
--> statement-breakpoint
CREATE TABLE "timetable" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"day_of_week" text NOT NULL,
	"time_slot" text NOT NULL,
	"subject" text NOT NULL,
	"teacher_id" integer
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"class_id" integer,
	"subject_id" integer,
	"teacher_id" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '',
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"class_id" integer,
	"subject_id" integer,
	"assignment_type" text NOT NULL,
	"assignment_name" text NOT NULL,
	"obtained_marks" numeric(10, 2) NOT NULL,
	"total_marks" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"assignment_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"title" text DEFAULT '',
	"file_link" text DEFAULT '',
	"grade" text DEFAULT '',
	"submitted_date" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"title" text NOT NULL,
	"target_audience" text DEFAULT 'All' NOT NULL,
	"description" text NOT NULL,
	"start_date" date DEFAULT CURRENT_DATE,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "announcements_target_audience_check" CHECK ("announcements"."target_audience" = ANY (ARRAY['All'::text, 'Teachers'::text, 'Students'::text]))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer,
	"user_id" integer,
	"actor" text DEFAULT '',
	"action" text NOT NULL,
	"entity" text DEFAULT '',
	"detail" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer,
	"user_id" integer NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text DEFAULT '',
	"link" text DEFAULT '',
	"is_read" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parent_children" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"parent_user_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	CONSTRAINT "parent_children_parent_user_id_student_id_key" UNIQUE("parent_user_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "student_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"class_id" integer,
	"subject" text DEFAULT '',
	"att_date" date NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "student_attendance_status_check" CHECK ("student_attendance"."status" = ANY (ARRAY['Present'::text, 'Absent'::text, 'Leave'::text]))
);
--> statement-breakpoint
CREATE TABLE "teacher_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"att_date" date NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "teacher_attendance_teacher_id_att_date_key" UNIQUE("teacher_id","att_date"),
	CONSTRAINT "teacher_attendance_status_check" CHECK ("teacher_attendance"."status" = ANY (ARRAY['Present'::text, 'Absent'::text, 'Leave'::text]))
);
--> statement-breakpoint
CREATE TABLE "tuition_fee" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"receipt_id" text NOT NULL,
	"student_id" integer NOT NULL,
	"total_fee" numeric(10, 2) NOT NULL,
	"paid_amount" numeric(10, 2) DEFAULT 0 NOT NULL,
	"remaining_balance" numeric(10, 2) DEFAULT 0 NOT NULL,
	"payment_date" date DEFAULT CURRENT_DATE,
	"payment_status" text DEFAULT 'Pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tuition_fee_payment_status_check" CHECK ("tuition_fee"."payment_status" = ANY (ARRAY['Paid'::text, 'Partial'::text, 'Pending'::text]))
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_schedule" ADD CONSTRAINT "exam_schedule_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_schedule" ADD CONSTRAINT "exam_schedule_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_subjects" ADD CONSTRAINT "teacher_subjects_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable" ADD CONSTRAINT "timetable_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_children" ADD CONSTRAINT "parent_children_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_children" ADD CONSTRAINT "parent_children_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_children" ADD CONSTRAINT "parent_children_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuition_fee" ADD CONSTRAINT "tuition_fee_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuition_fee" ADD CONSTRAINT "tuition_fee_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_school" ON "users" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_students_school" ON "students" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_students_class" ON "students" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "idx_subjects_school" ON "subjects" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_teachers_school" ON "teachers" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_grades_school" ON "grades" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_ann_school" ON "announcements" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_audit_school" ON "audit_log" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_notif_user" ON "notifications" USING btree ("user_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_pc_parent" ON "parent_children" USING btree ("parent_user_id");--> statement-breakpoint
CREATE INDEX "idx_satt_school" ON "student_attendance" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_fee_school" ON "tuition_fee" USING btree ("school_id");
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"purpose" text NOT NULL,
	"scan_status" text DEFAULT 'clean' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "files_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" IN ('photo', 'document', 'import', 'logo')),
	CONSTRAINT "files_scan_status_check" CHECK ("files"."scan_status" IN ('pending', 'clean', 'infected', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "institution_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_groups_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "academic_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "academic_years_institution_id_name_key" UNIQUE("institution_id","name"),
	CONSTRAINT "academic_years_status_check" CHECK ("academic_years"."status" IN ('planned', 'active', 'archived')),
	CONSTRAINT "academic_years_dates_check" CHECK ("academic_years"."ends_on" > "academic_years"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"is_main" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "campuses_institution_id_code_key" UNIQUE("institution_id","code")
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"department_id" integer,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"credit_hours" numeric(4, 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "courses_institution_id_code_key" UNIQUE("institution_id","code")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"campus_id" integer,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"head_teacher_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "departments_institution_id_code_key" UNIQUE("institution_id","code")
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"waitlist_position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollments_offering_id_student_id_key" UNIQUE("offering_id","student_id"),
	CONSTRAINT "enrollments_status_check" CHECK ("enrollments"."status" IN ('active', 'waitlisted', 'dropped', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "grading_schemes" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"bands" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gpa_scale" numeric(3, 1),
	"pass_percent" numeric(5, 2) DEFAULT '50' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grading_schemes_institution_id_name_key" UNIQUE("institution_id","name"),
	CONSTRAINT "grading_schemes_kind_check" CHECK ("grading_schemes"."kind" IN ('percentage', 'letter', 'gpa', 'pass_fail', 'competency', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"campus_id" integer,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"kind" text DEFAULT 'holiday' NOT NULL,
	CONSTRAINT "holidays_kind_check" CHECK ("holidays"."kind" IN ('holiday', 'break', 'exam_period', 'event')),
	CONSTRAINT "holidays_dates_check" CHECK ("holidays"."ends_on" >= "holidays"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "program_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"program_id" integer NOT NULL,
	"name" text NOT NULL,
	"sequence" integer NOT NULL,
	CONSTRAINT "program_levels_program_id_sequence_key" UNIQUE("program_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"department_id" integer,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"grading_scheme_id" integer,
	"credits_required" numeric(5, 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "programs_institution_id_code_key" UNIQUE("institution_id","code")
);
--> statement-breakpoint
CREATE TABLE "student_promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"from_section_id" integer,
	"to_section_id" integer,
	"action" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_promotions_action_check" CHECK ("student_promotions"."action" IN ('promoted', 'repeated', 'graduated', 'left'))
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"academic_year_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'annual' NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "terms_academic_year_id_name_key" UNIQUE("academic_year_id","name"),
	CONSTRAINT "terms_kind_check" CHECK ("terms"."kind" IN ('annual', 'semester', 'trimester', 'quarter', 'rolling', 'custom')),
	CONSTRAINT "terms_status_check" CHECK ("terms"."status" IN ('planned', 'active', 'archived')),
	CONSTRAINT "terms_dates_check" CHECK ("terms"."ends_on" IS NULL OR "terms"."ends_on" >= "terms"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "custom_fields_institution_id_entity_key_key" UNIQUE("institution_id","entity","key"),
	CONSTRAINT "custom_fields_entity_check" CHECK ("custom_fields"."entity" IN ('student', 'staff', 'guardian')),
	CONSTRAINT "custom_fields_field_type_check" CHECK ("custom_fields"."field_type" IN ('text', 'number', 'date', 'select', 'checkbox'))
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"serial_prefix" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_institution_id_kind_key" UNIQUE("institution_id","kind"),
	CONSTRAINT "document_templates_kind_check" CHECK ("document_templates"."kind" IN ('leaving_certificate', 'character_certificate', 'bonafide_letter'))
);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"user_id" integer,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"national_id" text DEFAULT '' NOT NULL,
	"occupation" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"custom_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "guardians_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "id_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"holder_type" text NOT NULL,
	"holder_id" integer NOT NULL,
	"verify_code" text NOT NULL,
	"valid_until" date NOT NULL,
	"issued_by" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "id_cards_verify_code_key" UNIQUE("verify_code"),
	CONSTRAINT "id_cards_holder_type_check" CHECK ("id_cards"."holder_type" IN ('student', 'staff'))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"entity" text NOT NULL,
	"mode" text DEFAULT 'create' NOT NULL,
	"status" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"ok_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" IN ('completed', 'failed')),
	CONSTRAINT "import_jobs_mode_check" CHECK ("import_jobs"."mode" IN ('create', 'upsert'))
);
--> statement-breakpoint
CREATE TABLE "issued_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"kind" text NOT NULL,
	"serial_no" text NOT NULL,
	"student_id" integer,
	"teacher_id" integer,
	"verify_code" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_by" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "issued_documents_institution_id_serial_no_key" UNIQUE("institution_id","serial_no"),
	CONSTRAINT "issued_documents_verify_code_key" UNIQUE("verify_code")
);
--> statement-breakpoint
CREATE TABLE "person_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "person_documents_owner_type_check" CHECK ("person_documents"."owner_type" IN ('student', 'staff', 'guardian'))
);
--> statement-breakpoint
CREATE TABLE "student_medical" (
	"student_id" integer PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"blood_group" text DEFAULT '' NOT NULL,
	"conditions" text DEFAULT '' NOT NULL,
	"allergies" text DEFAULT '' NOT NULL,
	"medications" text DEFAULT '' NOT NULL,
	"emergency_contact_name" text DEFAULT '' NOT NULL,
	"emergency_contact_phone" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entity_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "changes" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "course_id" integer;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "term_id" integer;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "enrollment_mode" text DEFAULT 'section' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "waitlist_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ADD COLUMN "guardian_id" integer;--> statement-breakpoint
ALTER TABLE "guardianships" ADD COLUMN "relationship" text DEFAULT 'guardian' NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ADD COLUMN "can_view_grades" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ADD COLUMN "can_view_fees" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ADD COLUMN "can_message" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guardianships" ADD COLUMN "is_emergency_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "type" text DEFAULT 'school' NOT NULL;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "group_id" integer;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "country" text DEFAULT 'PK' NOT NULL;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "section_staff" ADD COLUMN "role" text DEFAULT 'teacher' NOT NULL;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "campus_id" integer;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "program_level_id" integer;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "academic_year_id" integer;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "capacity" integer;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "homeroom_teacher_id" integer;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sections" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "national_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "nationality" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "religion" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "photo_file_id" integer;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "custom_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "left_on" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "employee_no" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "designation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "staff_type" text DEFAULT 'teaching' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "employment_type" text DEFAULT 'full_time' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "campus_id" integer;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "department_id" integer;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "joining_date" date;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "emergency_contact_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "emergency_contact_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "photo_file_id" integer;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "custom_data" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "institution_id" integer;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_teacher_id_fkey" FOREIGN KEY ("head_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_levels" ADD CONSTRAINT "program_levels_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_levels" ADD CONSTRAINT "program_levels_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_grading_scheme_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "public"."grading_schemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_from_section_id_fkey" FOREIGN KEY ("from_section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_to_section_id_fkey" FOREIGN KEY ("to_section_id") REFERENCES "public"."sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_promotions" ADD CONSTRAINT "student_promotions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_cards" ADD CONSTRAINT "id_cards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_cards" ADD CONSTRAINT "id_cards_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_medical" ADD CONSTRAINT "student_medical_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_medical" ADD CONSTRAINT "student_medical_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_medical" ADD CONSTRAINT "student_medical_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_files_institution" ON "files" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_years_one_current" ON "academic_years" USING btree ("institution_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX "idx_enrollments_student" ON "enrollments" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_schemes_one_default" ON "grading_schemes" USING btree ("institution_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "idx_holidays_institution_dates" ON "holidays" USING btree ("institution_id","starts_on");--> statement-breakpoint
CREATE INDEX "idx_student_promotions_student" ON "student_promotions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_terms_institution" ON "terms" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "idx_guardians_institution" ON "guardians" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "idx_id_cards_holder" ON "id_cards" USING btree ("holder_type","holder_id");--> statement-breakpoint
CREATE INDEX "idx_issued_documents_student" ON "issued_documents" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_person_documents_owner" ON "person_documents" USING btree ("owner_type","owner_id");--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."institution_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_program_level_id_fkey" FOREIGN KEY ("program_level_id") REFERENCES "public"."program_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_homeroom_teacher_id_fkey" FOREIGN KEY ("homeroom_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "idx_sections_campus" ON "sections" USING btree ("campus_id");--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_institution_id_employee_no_key" UNIQUE("institution_id","employee_no");--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_enrollment_mode_check" CHECK ("course_offerings"."enrollment_mode" IN ('section', 'open'));--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_capacity_check" CHECK ("course_offerings"."capacity" IS NULL OR "course_offerings"."capacity" > 0);--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_type_check" CHECK ("institutions"."type" IN ('school', 'chain', 'college', 'university', 'academy', 'training_center'));--> statement-breakpoint
ALTER TABLE "section_staff" ADD CONSTRAINT "section_staff_role_check" CHECK ("section_staff"."role" IN ('teacher', 'co_teacher', 'ta'));--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_status_check" CHECK ("sections"."status" IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_capacity_check" CHECK ("sections"."capacity" IS NULL OR "sections"."capacity" > 0);--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_staff_type_check" CHECK ("teachers"."staff_type" IN ('teaching', 'non_teaching'));--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_employment_type_check" CHECK ("teachers"."employment_type" IN ('full_time', 'part_time', 'visiting', 'contract'));--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_status_check" CHECK ("teachers"."status" IN ('active', 'on_leave', 'left'));
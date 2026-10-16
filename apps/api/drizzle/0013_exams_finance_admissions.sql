CREATE TABLE "checkout_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"provider" text NOT NULL,
	"reference" text NOT NULL,
	"provider_session_id" text,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"return_url" text DEFAULT '' NOT NULL,
	"payment_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "checkout_sessions_reference_key" UNIQUE("reference"),
	CONSTRAINT "checkout_sessions_status_check" CHECK ("checkout_sessions"."status" IN ('pending', 'succeeded', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'discount' NOT NULL,
	"method" text DEFAULT 'percent' NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	"heads" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"sibling_from" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_kind_check" CHECK ("discounts"."kind" IN ('discount', 'scholarship', 'sibling', 'waiver')),
	CONSTRAINT "discounts_method_check" CHECK ("discounts"."method" IN ('percent', 'amount')),
	CONSTRAINT "discounts_value_check" CHECK ("discounts"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"campus_id" integer,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"receipt_file_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_check" CHECK ("expenses"."amount" > 0),
	CONSTRAINT "expenses_method_check" CHECK ("expenses"."method" IN ('cash', 'bank', 'cheque', 'card', 'online'))
);
--> statement-breakpoint
CREATE TABLE "fee_installments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"structure_id" integer NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"issue_date" date,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_structure_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"structure_id" integer NOT NULL,
	"head" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"frequency" text DEFAULT 'per_installment' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_structure_items_frequency_check" CHECK ("fee_structure_items"."frequency" IN ('once', 'per_installment')),
	CONSTRAINT "fee_structure_items_amount_check" CHECK ("fee_structure_items"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fee_structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"academic_year_id" integer,
	"campus_id" integer,
	"program_id" integer,
	"program_level_id" integer,
	"late_fine" jsonb DEFAULT '{"kind":"none"}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"kind" text DEFAULT 'fee' NOT NULL,
	"head" text NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"discount_id" integer,
	"fine_date" date,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_items_invoice_id_fine_date_key" UNIQUE("invoice_id","fine_date"),
	CONSTRAINT "invoice_items_kind_check" CHECK ("invoice_items"."kind" IN ('fee', 'discount', 'scholarship', 'waiver', 'fine', 'adjustment'))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"number" text NOT NULL,
	"student_id" integer,
	"application_id" integer,
	"structure_id" integer,
	"installment_id" integer,
	"title" text NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"currency" text NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"pay_token" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_institution_id_number_key" UNIQUE("institution_id","number"),
	CONSTRAINT "invoices_pay_token_key" UNIQUE("pay_token"),
	CONSTRAINT "invoices_student_id_installment_id_key" UNIQUE("student_id","installment_id"),
	CONSTRAINT "invoices_owner_check" CHECK (("invoices"."student_id" IS NULL) <> ("invoices"."application_id" IS NULL)),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('draft', 'issued', 'partially_paid', 'paid', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"result" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_provider_events_provider_event_id_key" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"student_id" integer,
	"receipt_no" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"provider" text,
	"provider_ref" text,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" integer,
	"notes" text DEFAULT '' NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_institution_id_receipt_no_key" UNIQUE("institution_id","receipt_no"),
	CONSTRAINT "payments_provider_provider_ref_key" UNIQUE("provider","provider_ref"),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" IN ('cash', 'bank', 'cheque', 'online', 'adjustment')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('succeeded', 'refunded', 'partially_refunded')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"provider" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"summary" jsonb NOT NULL,
	"statement_file_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"provider_ref" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" IN ('pending', 'completed', 'failed')),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "student_discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"discount_id" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"approved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_discounts_student_id_discount_id_key" UNIQUE("student_id","discount_id")
);
--> statement-breakpoint
CREATE TABLE "admit_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"series_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"verify_code" text NOT NULL,
	"eligible" boolean NOT NULL,
	"blocked_reason" text,
	"overridden_by" integer,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admit_cards_series_id_student_id_key" UNIQUE("series_id","student_id"),
	CONSTRAINT "admit_cards_verify_code_key" UNIQUE("verify_code")
);
--> statement-breakpoint
CREATE TABLE "exam_marks" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"marks" numeric(7, 2),
	"absent" boolean DEFAULT false NOT NULL,
	"adjustment" numeric(7, 2) DEFAULT '0' NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"entered_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_marks_session_id_student_id_key" UNIQUE("session_id","student_id"),
	CONSTRAINT "exam_marks_marks_check" CHECK ("exam_marks"."marks" IS NULL OR "exam_marks"."marks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exam_moderations" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"action" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"change" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_moderations_action_check" CHECK ("exam_moderations"."action" IN ('open', 'submit', 'approve', 'return', 'moderate'))
);
--> statement-breakpoint
CREATE TABLE "exam_seats" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"seat_no" integer NOT NULL,
	CONSTRAINT "exam_seats_session_id_student_id_key" UNIQUE("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "exam_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"term_id" integer,
	"name" text NOT NULL,
	"kind" text DEFAULT 'final' NOT NULL,
	"result_style" text DEFAULT 'board' NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"eligibility" jsonb DEFAULT '{"attendance": true, "fees": false}'::jsonb NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_series_kind_check" CHECK ("exam_series"."kind" IN ('midterm', 'final', 'monthly', 'board', 'supplementary', 'other')),
	CONSTRAINT "exam_series_result_style_check" CHECK ("exam_series"."result_style" IN ('board', 'university')),
	CONSTRAINT "exam_series_status_check" CHECK ("exam_series"."status" IN ('planning', 'scheduled', 'in_progress', 'marking', 'published'))
);
--> statement-breakpoint
CREATE TABLE "exam_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"series_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"assessment_id" integer,
	"date" date NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"total_marks" numeric(7, 2) DEFAULT '100' NOT NULL,
	"pass_marks" numeric(7, 2) DEFAULT '33' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"marks_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_sessions_series_id_offering_id_key" UNIQUE("series_id","offering_id"),
	CONSTRAINT "exam_sessions_times_check" CHECK ("exam_sessions"."ends_at" > "exam_sessions"."starts_at"),
	CONSTRAINT "exam_sessions_marks_check" CHECK ("exam_sessions"."pass_marks" <= "exam_sessions"."total_marks"),
	CONSTRAINT "exam_sessions_status_check" CHECK ("exam_sessions"."status" IN ('scheduled', 'marks_entry', 'submitted', 'hod_approved', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "invigilator_duties" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"session_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"role" text DEFAULT 'invigilator' NOT NULL,
	CONSTRAINT "invigilator_duties_session_id_teacher_id_key" UNIQUE("session_id","teacher_id"),
	CONSTRAINT "invigilator_duties_role_check" CHECK ("invigilator_duties"."role" IN ('chief', 'invigilator'))
);
--> statement-breakpoint
CREATE TABLE "learning_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"level" text NOT NULL,
	"program_id" integer,
	"course_id" integer,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"bloom_level" text,
	"pass_percent" numeric(5, 2) DEFAULT '50' NOT NULL,
	"target_percent" numeric(5, 2) DEFAULT '70' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_outcomes_program_id_course_id_code_key" UNIQUE NULLS NOT DISTINCT("program_id","course_id","code"),
	CONSTRAINT "learning_outcomes_level_check" CHECK ("learning_outcomes"."level" IN ('program', 'course')),
	CONSTRAINT "learning_outcomes_owner_check" CHECK (("learning_outcomes"."level" = 'program' AND "learning_outcomes"."program_id" IS NOT NULL AND "learning_outcomes"."course_id" IS NULL) OR ("learning_outcomes"."level" = 'course' AND "learning_outcomes"."course_id" IS NOT NULL AND "learning_outcomes"."program_id" IS NULL)),
	CONSTRAINT "learning_outcomes_bloom_check" CHECK ("learning_outcomes"."bloom_level" IS NULL OR "learning_outcomes"."bloom_level" IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'))
);
--> statement-breakpoint
CREATE TABLE "outcome_alignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"clo_id" integer NOT NULL,
	"target_type" text NOT NULL,
	"target_id" integer NOT NULL,
	"weight" numeric(4, 2) DEFAULT '1' NOT NULL,
	CONSTRAINT "outcome_alignments_clo_id_target_type_target_id_key" UNIQUE("clo_id","target_type","target_id"),
	CONSTRAINT "outcome_alignments_target_type_check" CHECK ("outcome_alignments"."target_type" IN ('question', 'criterion', 'assessment', 'exam_session')),
	CONSTRAINT "outcome_alignments_weight_check" CHECK ("outcome_alignments"."weight" > 0 AND "outcome_alignments"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "outcome_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"clo_id" integer NOT NULL,
	"plo_id" integer NOT NULL,
	"strength" integer DEFAULT 2 NOT NULL,
	CONSTRAINT "outcome_mappings_clo_id_plo_id_key" UNIQUE("clo_id","plo_id"),
	CONSTRAINT "outcome_mappings_strength_check" CHECK ("outcome_mappings"."strength" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "admission_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"academic_year_id" integer,
	"campus_id" integer,
	"program_id" integer,
	"program_level_id" integer,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"application_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"entrance_test" jsonb,
	"seats" integer,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admission_forms_institution_id_slug_key" UNIQUE("institution_id","slug"),
	CONSTRAINT "admission_forms_status_check" CHECK ("admission_forms"."status" IN ('draft', 'open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "application_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"application_id" integer NOT NULL,
	"key" text NOT NULL,
	"file_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_documents_application_id_key_key" UNIQUE("application_id","key")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"number" text NOT NULL,
	"token_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"dob" date,
	"gender" text,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"guardian_name" text DEFAULT '' NOT NULL,
	"guardian_phone" text DEFAULT '' NOT NULL,
	"guardian_email" text DEFAULT '' NOT NULL,
	"guardian_relationship" text DEFAULT 'guardian' NOT NULL,
	"previous_school" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"test_at" timestamp with time zone,
	"test_venue" text DEFAULT '' NOT NULL,
	"test_score" numeric(7, 2),
	"test_max" numeric(7, 2),
	"test_layout" jsonb,
	"test_answers" jsonb,
	"test_started_at" timestamp with time zone,
	"test_deadline" timestamp with time zone,
	"interview_score" numeric(7, 2),
	"merit_rank" integer,
	"offer_expires_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"decided_by" integer,
	"student_id" integer,
	"enquiry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_institution_id_number_key" UNIQUE("institution_id","number"),
	CONSTRAINT "applications_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "applications_status_check" CHECK ("applications"."status" IN ('submitted', 'under_review', 'test_scheduled', 'tested', 'offered', 'accepted', 'declined', 'rejected', 'waitlisted', 'enrolled', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"student_name" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'walk_in' NOT NULL,
	"campus_id" integer,
	"program_id" integer,
	"program_level_id" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"assigned_to" integer,
	"next_follow_up_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"lost_reason" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_source_check" CHECK ("enquiries"."source" IN ('walk_in', 'phone', 'website', 'social', 'referral', 'event', 'other')),
	CONSTRAINT "enquiries_status_check" CHECK ("enquiries"."status" IN ('new', 'contacted', 'visited', 'applied', 'enrolled', 'lost'))
);
--> statement-breakpoint
CREATE TABLE "enquiry_followups" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"enquiry_id" integer NOT NULL,
	"channel" text DEFAULT 'phone' NOT NULL,
	"note" text NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"next_at" timestamp with time zone,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiry_followups_channel_check" CHECK ("enquiry_followups"."channel" IN ('phone', 'email', 'whatsapp', 'sms', 'visit', 'other'))
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "secure" jsonb;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_file_id_fkey" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structure_items" ADD CONSTRAINT "fee_structure_items_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_structures" ADD CONSTRAINT "fee_structures_program_level_id_fkey" FOREIGN KEY ("program_level_id") REFERENCES "public"."program_levels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "public"."fee_structures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "public"."fee_installments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_statement_file_id_fkey" FOREIGN KEY ("statement_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_discount_id_fkey" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_discounts" ADD CONSTRAINT "student_discounts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admit_cards" ADD CONSTRAINT "admit_cards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admit_cards" ADD CONSTRAINT "admit_cards_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."exam_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admit_cards" ADD CONSTRAINT "admit_cards_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admit_cards" ADD CONSTRAINT "admit_cards_overridden_by_fkey" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_moderations" ADD CONSTRAINT "exam_moderations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_moderations" ADD CONSTRAINT "exam_moderations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_moderations" ADD CONSTRAINT "exam_moderations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seats" ADD CONSTRAINT "exam_seats_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seats" ADD CONSTRAINT "exam_seats_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seats" ADD CONSTRAINT "exam_seats_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seats" ADD CONSTRAINT "exam_seats_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "public"."exam_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_marks_by_fkey" FOREIGN KEY ("marks_by") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invigilator_duties" ADD CONSTRAINT "invigilator_duties_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invigilator_duties" ADD CONSTRAINT "invigilator_duties_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invigilator_duties" ADD CONSTRAINT "invigilator_duties_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invigilator_duties" ADD CONSTRAINT "invigilator_duties_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_outcomes" ADD CONSTRAINT "learning_outcomes_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_outcomes" ADD CONSTRAINT "learning_outcomes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_outcomes" ADD CONSTRAINT "learning_outcomes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_alignments" ADD CONSTRAINT "outcome_alignments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_alignments" ADD CONSTRAINT "outcome_alignments_clo_id_fkey" FOREIGN KEY ("clo_id") REFERENCES "public"."learning_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_mappings" ADD CONSTRAINT "outcome_mappings_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_mappings" ADD CONSTRAINT "outcome_mappings_clo_id_fkey" FOREIGN KEY ("clo_id") REFERENCES "public"."learning_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_mappings" ADD CONSTRAINT "outcome_mappings_plo_id_fkey" FOREIGN KEY ("plo_id") REFERENCES "public"."learning_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_forms" ADD CONSTRAINT "admission_forms_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_forms" ADD CONSTRAINT "admission_forms_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_forms" ADD CONSTRAINT "admission_forms_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_forms" ADD CONSTRAINT "admission_forms_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_forms" ADD CONSTRAINT "admission_forms_program_level_id_fkey" FOREIGN KEY ("program_level_id") REFERENCES "public"."program_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_forms" ADD CONSTRAINT "admission_forms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."admission_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_program_level_id_fkey" FOREIGN KEY ("program_level_id") REFERENCES "public"."program_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_followups" ADD CONSTRAINT "enquiry_followups_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_followups" ADD CONSTRAINT "enquiry_followups_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_followups" ADD CONSTRAINT "enquiry_followups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_expenses_date" ON "expenses" USING btree ("institution_id","date");--> statement-breakpoint
CREATE INDEX "idx_invoice_items_invoice" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_student" ON "invoices" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_due" ON "invoices" USING btree ("institution_id","status","due_date");--> statement-breakpoint
CREATE INDEX "idx_payments_invoice" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_payments_received" ON "payments" USING btree ("institution_id","received_at");--> statement-breakpoint
CREATE INDEX "idx_exam_moderations_session" ON "exam_moderations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_exam_sessions_series" ON "exam_sessions" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "idx_outcome_alignments_target" ON "outcome_alignments" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_applications_form" ON "applications" USING btree ("form_id","status");--> statement-breakpoint
CREATE INDEX "idx_enquiries_status" ON "enquiries" USING btree ("institution_id","status");
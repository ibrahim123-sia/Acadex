CREATE TABLE "plans" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trial_days" integer DEFAULT 14 NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"stripe_price_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" integer,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"user_id" integer,
	"student_id" integer,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_kind_check" CHECK ("consents"."kind" IN ('data_processing', 'photos', 'ai_features', 'messaging', 'marketing', 'tenant_ai', 'tenant_dpa'))
);
--> statement-breakpoint
CREATE TABLE "custom_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"domain" text NOT NULL,
	"token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_domains_domain_key" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"requested_by" integer,
	"scope" text DEFAULT 'institution' NOT NULL,
	"subject_user_id" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"storage_key" text,
	"size_bytes" integer,
	"error" text,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_exports_scope_check" CHECK ("data_exports"."scope" IN ('institution', 'person')),
	CONSTRAINT "data_exports_status_check" CHECK ("data_exports"."status" IN ('queued', 'running', 'done', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "demo_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"institution" text NOT NULL,
	"type" text DEFAULT 'school' NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_launches" (
	"state" text PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"tool_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"offering_id" integer,
	"nonce" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lti_tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"login_url" text NOT NULL,
	"launch_url" text NOT NULL,
	"jwks_url" text DEFAULT '' NOT NULL,
	"deployment_id" text NOT NULL,
	"send_pii" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"plans" text[],
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_announcements_level_check" CHECK ("platform_announcements"."level" IN ('info', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "platform_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"number" text NOT NULL,
	"plan" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"currency" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"tax_label" text DEFAULT '' NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"method" text,
	"reference" text DEFAULT '' NOT NULL,
	"checkout_id" text,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_invoices_number_key" UNIQUE("number"),
	CONSTRAINT "platform_invoices_institution_id_period_start_key" UNIQUE("institution_id","period_start"),
	CONSTRAINT "platform_invoices_status_check" CHECK ("platform_invoices"."status" IN ('open', 'paid', 'void', 'overdue')),
	CONSTRAINT "platform_invoices_method_check" CHECK ("platform_invoices"."method" IS NULL OR "platform_invoices"."method" IN ('stripe', 'bank', 'manual', 'free'))
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"user_id" integer,
	"kind" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"handled_by" integer,
	"response" text DEFAULT '' NOT NULL,
	"export_id" integer,
	"due_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_kind_check" CHECK ("privacy_requests"."kind" IN ('access', 'correction', 'deletion')),
	CONSTRAINT "privacy_requests_status_check" CHECK ("privacy_requests"."status" IN ('open', 'done', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "product_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer,
	"user_id" integer,
	"page" text DEFAULT '' NOT NULL,
	"rating" integer,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_feedback_rating_check" CHECK ("product_feedback"."rating" IS NULL OR "product_feedback"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"report" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"format" text DEFAULT 'xlsx' NOT NULL,
	"frequency" text NOT NULL,
	"recipients" text[] NOT NULL,
	"created_by" integer,
	"last_sent_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_format_check" CHECK ("report_schedules"."format" IN ('xlsx', 'csv', 'pdf')),
	CONSTRAINT "report_schedules_frequency_check" CHECK ("report_schedules"."frequency" IN ('daily', 'weekly', 'monthly'))
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"institution_id" integer NOT NULL,
	"day" date NOT NULL,
	"students" integer DEFAULT 0 NOT NULL,
	"staff" integer DEFAULT 0 NOT NULL,
	"storage_bytes" numeric(18, 0) DEFAULT '0' NOT NULL,
	"ai_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"ai_tokens" integer DEFAULT 0 NOT NULL,
	"sms" integer DEFAULT 0 NOT NULL,
	"whatsapp" integer DEFAULT 0 NOT NULL,
	"emails" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_snapshots_pkey" PRIMARY KEY("institution_id","day")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"endpoint_id" integer NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_code" integer,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."status" IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret_sealed" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hostel_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hostel_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"hostel" text NOT NULL,
	"name" text NOT NULL,
	"capacity" integer DEFAULT 2 NOT NULL,
	"fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hostel_rooms_institution_id_hostel_name_key" UNIQUE("institution_id","hostel","name")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT 'pcs' NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '0' NOT NULL,
	"reorder_level" numeric(12, 2) DEFAULT '0' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"is_asset" boolean DEFAULT false NOT NULL,
	"asset_tag" text,
	"assigned_to" integer,
	"condition" text DEFAULT 'good' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_condition_check" CHECK ("inventory_items"."condition" IN ('good', 'needs_repair', 'broken', 'disposed'))
);
--> statement-breakpoint
CREATE TABLE "library_books" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"title" text NOT NULL,
	"authors" text DEFAULT '' NOT NULL,
	"isbn" text DEFAULT '' NOT NULL,
	"publisher" text DEFAULT '' NOT NULL,
	"year" integer,
	"category" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"shelf" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_copies" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"barcode" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"acquired_on" date,
	"price" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_copies_institution_id_barcode_key" UNIQUE("institution_id","barcode"),
	CONSTRAINT "library_copies_status_check" CHECK ("library_copies"."status" IN ('available', 'issued', 'lost', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "library_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"copy_id" integer NOT NULL,
	"borrower_id" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date NOT NULL,
	"returned_at" timestamp with time zone,
	"renewals" integer DEFAULT 0 NOT NULL,
	"fine" numeric(12, 2) DEFAULT '0' NOT NULL,
	"fine_paid" boolean DEFAULT false NOT NULL,
	"issued_by" integer
);
--> statement-breakpoint
CREATE TABLE "module_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"kind" text NOT NULL,
	"month" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"invoice_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_charges_student_id_kind_month_key" UNIQUE("student_id","kind","month"),
	CONSTRAINT "module_charges_kind_check" CHECK ("module_charges"."kind" IN ('transport', 'hostel'))
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_gross" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_net" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_by" integer,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_institution_id_month_key" UNIQUE("institution_id","month"),
	CONSTRAINT "payroll_runs_status_check" CHECK ("payroll_runs"."status" IN ('draft', 'approved', 'paid')),
	CONSTRAINT "payroll_runs_month_check" CHECK ("payroll_runs"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"basic" numeric(12, 2) NOT NULL,
	"earnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deductions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unpaid_days" numeric(5, 1) DEFAULT '0' NOT NULL,
	"gross" numeric(12, 2) NOT NULL,
	"net" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_run_id_teacher_id_key" UNIQUE("run_id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_leaves" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"kind" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_leaves_kind_check" CHECK ("staff_leaves"."kind" IN ('casual', 'sick', 'annual', 'maternity', 'unpaid', 'other')),
	CONSTRAINT "staff_leaves_status_check" CHECK ("staff_leaves"."status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "staff_leaves_dates_check" CHECK ("staff_leaves"."to_date" >= "staff_leaves"."from_date")
);
--> statement-breakpoint
CREATE TABLE "staff_salaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"structure_id" integer,
	"basic" numeric(12, 2) NOT NULL,
	"bank_account" text DEFAULT '' NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_salaries_teacher_id_effective_from_key" UNIQUE("teacher_id","effective_from")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"change" numeric(12, 2) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"by_user" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"route_id" integer NOT NULL,
	"stop" text DEFAULT '' NOT NULL,
	"from_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transport_assignments_student_id_key" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE "transport_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"vehicle_id" integer,
	"fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"registration" text NOT NULL,
	"capacity" integer DEFAULT 30 NOT NULL,
	"driver_name" text DEFAULT '' NOT NULL,
	"driver_phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_institution_id_registration_key" UNIQUE("institution_id","registration")
);
--> statement-breakpoint
CREATE TABLE "visitor_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"campus_id" integer,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"purpose" text NOT NULL,
	"host_user_id" integer,
	"student_id" integer,
	"pass_code" text NOT NULL,
	"check_in" timestamp with time zone DEFAULT now() NOT NULL,
	"check_out" timestamp with time zone,
	"created_by" integer
);
--> statement-breakpoint
ALTER TABLE "institutions" DROP CONSTRAINT IF EXISTS "institutions_plan_check";--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "trial_ends_at" date;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "feature_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "billing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "institutions" ADD COLUMN "deletion_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tours_done" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "impersonated_by" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_launches" ADD CONSTRAINT "lti_launches_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_launches" ADD CONSTRAINT "lti_launches_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "public"."lti_tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_launches" ADD CONSTRAINT "lti_launches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lti_tools" ADD CONSTRAINT "lti_tools_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_announcements" ADD CONSTRAINT "platform_announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "hostel_allocations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "hostel_allocations_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."hostel_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_allocations" ADD CONSTRAINT "hostel_allocations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hostel_rooms" ADD CONSTRAINT "hostel_rooms_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "public"."library_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "public"."library_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_borrower_id_fkey" FOREIGN KEY ("borrower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_charges" ADD CONSTRAINT "module_charges_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_charges" ADD CONSTRAINT "module_charges_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_charges" ADD CONSTRAINT "module_charges_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_by_user_fkey" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "public"."transport_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_host_user_id_fkey" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_logs" ADD CONSTRAINT "visitor_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_consents_subject" ON "consents" USING btree ("institution_id","student_id","kind");--> statement-breakpoint
CREATE INDEX "idx_platform_invoices_status" ON "platform_invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_endpoint" ON "webhook_deliveries" USING btree ("endpoint_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "hostel_allocations_one_current" ON "hostel_allocations" USING btree ("student_id") WHERE "hostel_allocations"."to_date" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_library_books_institution" ON "library_books" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "idx_library_loans_borrower" ON "library_loans" USING btree ("borrower_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_loans_one_open_per_copy" ON "library_loans" USING btree ("copy_id") WHERE "library_loans"."returned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_staff_leaves_teacher" ON "staff_leaves" USING btree ("teacher_id","from_date");--> statement-breakpoint
CREATE INDEX "idx_stock_movements_item" ON "stock_movements" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_visitor_logs_day" ON "visitor_logs" USING btree ("institution_id","check_in");--> statement-breakpoint
-- ---------- The default plans (prices per month; limits null = unlimited) ----------
INSERT INTO plans (key, name, description, prices, limits, features, overage, trial_days, public, position) VALUES
  ('free', 'Free', 'For a small school or academy getting started.', '{"PKR": 0, "USD": 0}',
   '{"students": 50, "staff": 10, "storage_mb": 1024, "ai_usd": 2, "messages": 0}',
   '{"modules": [], "api": false, "sso": false, "white_label": false, "custom_domain": false, "lti": false}', '{}', 0, true, 0),
  ('pro', 'Pro', 'Everything a school, college or academy needs, with the AI tutor and the main modules.', '{"PKR": 15000, "USD": 59, "AED": 220, "SAR": 220, "GBP": 47}',
   '{"students": 1000, "staff": 150, "storage_mb": 51200, "ai_usd": 50, "messages": 2000}',
   '{"modules": ["library", "hr", "transport", "hostel", "inventory", "visitors"], "api": true, "sso": true, "white_label": true, "custom_domain": false, "lti": true}',
   '{"PKR": 25, "USD": 0.1}', 14, true, 1),
  ('enterprise', 'Enterprise', 'For school networks and universities: your own domain, unlimited scale, priority support.', '{}',
   '{"students": null, "staff": null, "storage_mb": null, "ai_usd": 500, "messages": null}',
   '{"modules": ["library", "hr", "transport", "hostel", "inventory", "visitors"], "api": true, "sso": true, "white_label": true, "custom_domain": true, "lti": true}', '{}', 30, true, 2)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
ALTER TABLE "institutions" ADD CONSTRAINT "institutions_plan_fkey" FOREIGN KEY ("plan") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
-- ---------- Row-level security ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'platform_invoices', 'usage_snapshots', 'custom_domains', 'data_exports', 'api_keys', 'webhook_endpoints', 'webhook_deliveries',
    'lti_tools', 'lti_launches', 'consents', 'privacy_requests', 'report_schedules',
    'library_books', 'library_copies', 'library_loans', 'salary_structures', 'staff_salaries', 'payroll_runs', 'payslips', 'staff_leaves',
    'vehicles', 'transport_routes', 'transport_assignments', 'hostel_rooms', 'hostel_allocations', 'module_charges',
    'inventory_items', 'stock_movements', 'visitor_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR institution_id = app_institution_id()) '
      'WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id())', t);
  END LOOP;
  -- feedback may come from platform staff (no institution)
  ALTER TABLE product_feedback ENABLE ROW LEVEL SECURITY;
  ALTER TABLE product_feedback FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON product_feedback USING (app_bypass_rls() OR institution_id = app_institution_id())
    WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id() OR institution_id IS NULL);
  -- money, keys, consents, privacy decisions and payroll are audited
  FOREACH t IN ARRAY ARRAY['platform_invoices', 'lti_tools', 'consents', 'privacy_requests', 'payroll_runs', 'staff_salaries', 'staff_leaves', 'custom_domains'] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acadex_audit()', t);
  END LOOP;
  -- keys and signing secrets: record that they changed, never their values
  FOREACH t IN ARRAY ARRAY['api_keys', 'webhook_endpoints'] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acadex_audit(''masked'')', t);
  END LOOP;
END $$;

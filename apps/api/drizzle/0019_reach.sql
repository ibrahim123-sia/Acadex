CREATE TABLE "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"audience" text NOT NULL,
	"campus_id" integer,
	"section_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"channels" text[] NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_audience_check" CHECK ("broadcasts"."audience" IN ('everyone', 'staff', 'students', 'guardians'))
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"last_read_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_members_pkey" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "conversation_members_role_check" CHECK ("conversation_members"."role" IN ('member', 'cc'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"kind" text DEFAULT 'direct' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"offering_id" integer,
	"created_by" integer,
	"safeguarded" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_kind_check" CHECK ("conversations"."kind" IN ('direct', 'group', 'class'))
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_sealed" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_accounts_institution_id_provider_key" UNIQUE("institution_id","provider"),
	CONSTRAINT "integration_accounts_provider_check" CHECK ("integration_accounts"."provider" IN ('zoom', 'teams', 'meet'))
);
--> statement-breakpoint
CREATE TABLE "message_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"message_id" integer NOT NULL,
	"reporter_id" integer,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_by" integer,
	"review_note" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reports_status_check" CHECK ("message_reports"."status" IN ('open', 'actioned', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" integer,
	"body" text NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"hidden_at" timestamp with time zone,
	"hidden_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ptm_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"title" text NOT NULL,
	"date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"slot_minutes" integer DEFAULT 10 NOT NULL,
	"mode" text DEFAULT 'in_person' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"section_ids" integer[] NOT NULL,
	"allow_students" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ptm_events_mode_check" CHECK ("ptm_events"."mode" IN ('in_person', 'online')),
	CONSTRAINT "ptm_events_status_check" CHECK ("ptm_events"."status" IN ('open', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "ptm_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"teacher_user_id" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"booked_by" integer,
	"student_id" integer,
	"note" text DEFAULT '' NOT NULL,
	"join_url" text DEFAULT '' NOT NULL,
	"booked_at" timestamp with time zone,
	CONSTRAINT "ptm_slots_event_id_teacher_user_id_starts_at_key" UNIQUE("event_id","teacher_user_id","starts_at"),
	CONSTRAINT "ptm_slots_status_check" CHECK ("ptm_slots"."status" IN ('open', 'booked', 'blocked', 'done', 'no_show'))
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"ticket_id" integer NOT NULL,
	"author_id" integer,
	"body" text NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"raised_by" integer,
	"student_id" integer,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to" integer,
	"anonymous" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"satisfaction" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_category_check" CHECK ("tickets"."category" IN ('complaint', 'feedback', 'suggestion', 'academic', 'fees', 'transport', 'it', 'facilities', 'other')),
	CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
	CONSTRAINT "tickets_priority_check" CHECK ("tickets"."priority" IN ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "tickets_satisfaction_check" CHECK ("tickets"."satisfaction" IS NULL OR "tickets"."satisfaction" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "low_bandwidth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "host_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "digest" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "last_digest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_hidden_by_fkey" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptm_events" ADD CONSTRAINT "ptm_events_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptm_events" ADD CONSTRAINT "ptm_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptm_slots" ADD CONSTRAINT "ptm_slots_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptm_slots" ADD CONSTRAINT "ptm_slots_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."ptm_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptm_slots" ADD CONSTRAINT "ptm_slots_teacher_user_id_fkey" FOREIGN KEY ("teacher_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptm_slots" ADD CONSTRAINT "ptm_slots_booked_by_fkey" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ptm_slots" ADD CONSTRAINT "ptm_slots_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_broadcasts_institution" ON "broadcasts" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_members_user" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_institution" ON "conversations" USING btree ("institution_id","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_message_reports_status" ON "message_reports" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "idx_messages_flagged" ON "messages" USING btree ("institution_id") WHERE "messages"."flagged";--> statement-breakpoint
CREATE INDEX "idx_ptm_events_institution" ON "ptm_events" USING btree ("institution_id","date");--> statement-breakpoint
CREATE INDEX "idx_ptm_slots_event" ON "ptm_slots" USING btree ("event_id","teacher_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ptm_slots_one_per_student" ON "ptm_slots" USING btree ("event_id","teacher_user_id","student_id") WHERE "ptm_slots"."student_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_ticket_comments_ticket" ON "ticket_comments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_institution" ON "tickets" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "idx_tickets_raised_by" ON "tickets" USING btree ("raised_by");--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_digest_check" CHECK ("notification_preferences"."digest" IN ('off', 'daily', 'weekly'));--> statement-breakpoint
-- ---------- Row-level security ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'conversations', 'conversation_members', 'messages', 'message_reports', 'tickets', 'ticket_comments',
    'ptm_events', 'ptm_slots', 'broadcasts', 'integration_accounts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR institution_id = app_institution_id()) '
      'WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id())', t);
  END LOOP;
  -- safeguarding decisions, ticket handling, broadcasts and provider credentials are audited
  FOREACH t IN ARRAY ARRAY['message_reports', 'tickets', 'broadcasts', 'integration_accounts', 'conversations'] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acadex_audit()', t);
  END LOOP;
END $$;

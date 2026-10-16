CREATE TABLE "ai_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"offering_id" integer,
	"kind" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"input" jsonb NOT NULL,
	"proposal" jsonb NOT NULL,
	"applied" jsonb,
	"result" jsonb,
	"model" text DEFAULT '' NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_actions_status_check" CHECK ("ai_actions"."status" IN ('proposed', 'applied', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text DEFAULT 'tutor' NOT NULL,
	"student_id" integer,
	"offering_id" integer,
	"assessment_id" integer,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_conversations_kind_check" CHECK ("ai_conversations"."kind" IN ('tutor', 'helpdesk', 'ask'))
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flag" text,
	"topic_item_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_role_check" CHECK ("ai_messages"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "ai_provider_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"provider" text NOT NULL,
	"key_sealed" text NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_keys_institution_id_provider_key" UNIQUE("institution_id","provider"),
	CONSTRAINT "ai_provider_keys_provider_check" CHECK ("ai_provider_keys"."provider" IN ('openai', 'anthropic', 'gemini', 'groq'))
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer,
	"user_id" integer,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"error" text,
	"byo_key" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_status_check" CHECK ("ai_usage"."status" IN ('ok', 'error', 'blocked', 'quota'))
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"owner_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"due_on" date,
	"outcome" text DEFAULT '' NOT NULL,
	"guardian_alerted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "interventions_kind_check" CHECK ("interventions"."kind" IN ('meeting', 'call_guardian', 'tutoring', 'counselling', 'study_plan', 'fee_plan', 'other')),
	CONSTRAINT "interventions_status_check" CHECK ("interventions"."status" IN ('open', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer,
	"offering_id" integer,
	"source_type" text NOT NULL,
	"source_id" integer NOT NULL,
	"chunk_no" integer NOT NULL,
	"title" text NOT NULL,
	"locator" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"embedding" real[],
	"embedding_model" text,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || content)) STORED,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_chunks_source_type_source_id_chunk_no_key" UNIQUE("source_type","source_id","chunk_no"),
	CONSTRAINT "kb_chunks_source_type_check" CHECK ("kb_chunks"."source_type" IN ('content_item', 'assessment', 'file', 'transcript', 'help'))
);
--> statement-breakpoint
CREATE TABLE "media_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"vtt" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_transcripts_file_id_language_key" UNIQUE("file_id","language"),
	CONSTRAINT "media_transcripts_status_check" CHECK ("media_transcripts"."status" IN ('pending', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "report_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"term_id" integer,
	"comment" text NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_comments_student_id_term_id_key" UNIQUE NULLS NOT DISTINCT("student_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "risk_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"computed_on" date NOT NULL,
	"score" integer NOT NULL,
	"level" text NOT NULL,
	"factors" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_scores_student_id_computed_on_key" UNIQUE("student_id","computed_on"),
	CONSTRAINT "risk_scores_level_check" CHECK ("risk_scores"."level" IN ('low', 'medium', 'high')),
	CONSTRAINT "risk_scores_score_check" CHECK ("risk_scores"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "submission_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"keystrokes" integer DEFAULT 0 NOT NULL,
	"pastes" integer DEFAULT 0 NOT NULL,
	"pasted_chars" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_activity_assessment_id_student_id_key" UNIQUE("assessment_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "viva_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"teacher_note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "viva_sessions_status_check" CHECK ("viva_sessions"."status" IN ('open', 'answered', 'reviewed'))
);
--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "ai_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "ai_assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_keys" ADD CONSTRAINT "ai_provider_keys_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_keys" ADD CONSTRAINT "ai_provider_keys_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_transcripts" ADD CONSTRAINT "media_transcripts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_transcripts" ADD CONSTRAINT "media_transcripts_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_comments" ADD CONSTRAINT "report_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_activity" ADD CONSTRAINT "submission_activity_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_activity" ADD CONSTRAINT "submission_activity_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_activity" ADD CONSTRAINT "submission_activity_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viva_sessions" ADD CONSTRAINT "viva_sessions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viva_sessions" ADD CONSTRAINT "viva_sessions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viva_sessions" ADD CONSTRAINT "viva_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_actions_user" ON "ai_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_conversations_user" ON "ai_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_ai_messages_conversation" ON "ai_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_institution" ON "ai_usage" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_interventions_student" ON "interventions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_kb_chunks_offering" ON "kb_chunks" USING btree ("offering_id");--> statement-breakpoint
CREATE INDEX "idx_kb_chunks_tsv" ON "kb_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "idx_risk_scores_level" ON "risk_scores" USING btree ("institution_id","computed_on","level");--> statement-breakpoint
-- ---------- Row-level security ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_provider_keys', 'ai_conversations', 'ai_messages', 'ai_actions', 'submission_activity', 'viva_sessions',
    'risk_scores', 'interventions', 'media_transcripts', 'report_comments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR institution_id = app_institution_id()) '
      'WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id())', t);
  END LOOP;
  -- usage rows and knowledge chunks may belong to no institution (platform calls, help articles)
  FOREACH t IN ARRAY ARRAY['ai_usage', 'kb_chunks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR institution_id = app_institution_id() OR institution_id IS NULL) '
      'WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id())', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ai_provider_keys', 'ai_actions', 'interventions', 'report_comments'] LOOP
    EXECUTE format('CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION acadex_audit()', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- cosine similarity of two embeddings (stored as real[] so the database needs no extension)
CREATE OR REPLACE FUNCTION acadex_cosine(a real[], b real[]) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN na = 0 OR nb = 0 THEN 0 ELSE dot / (sqrt(na) * sqrt(nb)) END
    FROM (SELECT sum(x * y) AS dot, sum(x * x) AS na, sum(y * y) AS nb FROM unnest(a, b) AS u(x, y)) s
$$;
--> statement-breakpoint
-- ---------- Ask Acadex: the only relations generated questions may read ----------
-- security_invoker: the asker's row-level security applies; app.ask_scope (a comma list of
-- section ids, set for teachers) narrows them to their own classes.
CREATE OR REPLACE FUNCTION acadex_ask_in_scope(section integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.ask_scope', true), '') = ''
      OR section = ANY(string_to_array(current_setting('app.ask_scope', true), ',')::int[])
$$;
--> statement-breakpoint
CREATE VIEW ask_students WITH (security_invoker = true) AS
  SELECT st.id AS student_id, st.roll_no, st.first_name || ' ' || st.last_name AS name, st.gender, st.status, st.admission_date,
         st.section_id, sec.name || COALESCE(' ' || NULLIF(sec.label, ''), '') AS section, c.name AS campus, p.name AS program, pl.name AS level
    FROM students st LEFT JOIN sections sec ON sec.id = st.section_id LEFT JOIN campuses c ON c.id = sec.campus_id
    LEFT JOIN program_levels pl ON pl.id = sec.program_level_id LEFT JOIN programs p ON p.id = pl.program_id
   WHERE acadex_ask_in_scope(st.section_id);
--> statement-breakpoint
CREATE VIEW ask_attendance WITH (security_invoker = true) AS
  SELECT r.student_id, sn.date, r.status, sn.section_id, co.name AS course
    FROM attendance_records r JOIN attendance_sessions sn ON sn.id = r.session_id
    LEFT JOIN course_offerings o ON o.id = sn.offering_id LEFT JOIN courses co ON co.id = o.course_id
   WHERE acadex_ask_in_scope(sn.section_id);
--> statement-breakpoint
CREATE VIEW ask_grades WITH (security_invoker = true) AS
  SELECT g.student_id, o.section_id, co.name AS course, a.title AS assessment, a.kind, g.points, a.points AS max_points,
         round(100.0 * g.points / NULLIF(a.points, 0), 1) AS percent, g.status = 'released' AS released, g.graded_at
    FROM grades g JOIN assessments a ON a.id = g.assessment_id JOIN course_offerings o ON o.id = a.offering_id JOIN courses co ON co.id = o.course_id
   WHERE g.points IS NOT NULL AND acadex_ask_in_scope(o.section_id);
--> statement-breakpoint
CREATE VIEW ask_fees WITH (security_invoker = true) AS
  SELECT i.number AS invoice, i.student_id, st.section_id, i.title, i.due_date, i.status, i.total, i.paid, i.total - i.paid AS balance,
         (i.status IN ('issued', 'partially_paid') AND i.due_date < CURRENT_DATE) AS overdue
    FROM invoices i JOIN students st ON st.id = i.student_id
   WHERE i.status <> 'draft' AND acadex_ask_in_scope(st.section_id);
--> statement-breakpoint
CREATE VIEW ask_payments WITH (security_invoker = true) AS
  SELECT p.receipt_no, p.student_id, st.section_id, p.amount, COALESCE(p.provider, p.method) AS method, p.received_at
    FROM payments p LEFT JOIN students st ON st.id = p.student_id
   WHERE acadex_ask_in_scope(st.section_id);
--> statement-breakpoint
CREATE VIEW ask_courses WITH (security_invoker = true) AS
  SELECT o.id AS offering_id, co.code, co.name AS course, o.section_id, sec.name || COALESCE(' ' || NULLIF(sec.label, ''), '') AS section,
         (SELECT string_agg(t.first_name || ' ' || t.last_name, ', ') FROM section_staff ss JOIN teachers t ON t.id = ss.teacher_id WHERE ss.offering_id = o.id) AS teachers
    FROM course_offerings o JOIN courses co ON co.id = o.course_id LEFT JOIN sections sec ON sec.id = o.section_id
   WHERE acadex_ask_in_scope(o.section_id);
--> statement-breakpoint
CREATE VIEW ask_staff WITH (security_invoker = true) AS
  SELECT t.id AS staff_id, t.first_name || ' ' || t.last_name AS name, t.designation, t.staff_type, t.status, d.name AS department, c.name AS campus
    FROM teachers t LEFT JOIN departments d ON d.id = t.department_id LEFT JOIN campuses c ON c.id = t.campus_id
   WHERE COALESCE(current_setting('app.ask_scope', true), '') = '';
--> statement-breakpoint
CREATE VIEW ask_risk WITH (security_invoker = true) AS
  SELECT r.student_id, st.section_id, r.computed_on, r.score, r.level
    FROM risk_scores r JOIN students st ON st.id = r.student_id
   WHERE acadex_ask_in_scope(st.section_id);

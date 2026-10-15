-- acadex:reviewed-destructive — only the announcements audience CHECK is replaced (widened to add Parents).
CREATE TABLE "accommodations" (
	"student_id" integer PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"extra_time_percent" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accommodations_extra_time_check" CHECK ("accommodations"."extra_time_percent" BETWEEN 0 AND 300)
);
--> statement-breakpoint
CREATE TABLE "assessment_extensions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"student_id" integer,
	"group_id" integer,
	"due_at" timestamp with time zone,
	"available_until" timestamp with time zone,
	"extra_attempts" integer DEFAULT 0 NOT NULL,
	"extra_time_percent" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_extensions_assessment_id_student_id_group_id_key" UNIQUE NULLS NOT DISTINCT("assessment_id","student_id","group_id"),
	CONSTRAINT "assessment_extensions_target_check" CHECK (("assessment_extensions"."student_id" IS NULL) <> ("assessment_extensions"."group_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "assessment_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"question_id" integer,
	"pool_bank_id" integer,
	"pool_tag" text,
	"pool_count" integer,
	"points" numeric(6, 2),
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assessment_questions_source_check" CHECK (("assessment_questions"."question_id" IS NULL) <> ("assessment_questions"."pool_bank_id" IS NULL)),
	CONSTRAINT "assessment_questions_pool_check" CHECK ("assessment_questions"."pool_bank_id" IS NULL OR "assessment_questions"."pool_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"category_id" integer,
	"kind" text DEFAULT 'assignment' NOT NULL,
	"title" text NOT NULL,
	"instructions_html" text DEFAULT '' NOT NULL,
	"points" numeric(7, 2) DEFAULT '100' NOT NULL,
	"available_from" timestamp with time zone,
	"due_at" timestamp with time zone,
	"available_until" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"submission_types" text[] DEFAULT ARRAY['text','file']::text[] NOT NULL,
	"allowed_attempts" integer DEFAULT 1,
	"late_policy" jsonb DEFAULT '{"mode":"allow"}'::jsonb NOT NULL,
	"group_set_id" integer,
	"peer_review" jsonb,
	"rubric_id" integer,
	"ai_policy" text DEFAULT 'allowed' NOT NULL,
	"quiz" jsonb,
	"release_mode" text DEFAULT 'manual' NOT NULL,
	"grades_released_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "assessments_kind_check" CHECK ("assessments"."kind" IN ('assignment', 'quiz', 'exam', 'project', 'participation')),
	CONSTRAINT "assessments_status_check" CHECK ("assessments"."status" IN ('draft', 'published', 'closed')),
	CONSTRAINT "assessments_ai_policy_check" CHECK ("assessments"."ai_policy" IN ('allowed', 'limited', 'not_allowed')),
	CONSTRAINT "assessments_release_mode_check" CHECK ("assessments"."release_mode" IN ('manual', 'on_grading')),
	CONSTRAINT "assessments_points_check" CHECK ("assessments"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attempt_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"attempt_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"response" jsonb,
	"auto_points" numeric(6, 2),
	"manual_points" numeric(6, 2),
	"feedback" text DEFAULT '' NOT NULL,
	"graded_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_answers_attempt_id_question_id_key" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "attempt_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"attempt_id" integer NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"module_id" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"body_json" jsonb,
	"url" text DEFAULT '' NOT NULL,
	"file_id" integer,
	"video_provider" text,
	"video_ref" text,
	"assessment_id" integer,
	"scorm_package_id" integer,
	"live_session_id" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"unlock_at" timestamp with time zone,
	"completion" text DEFAULT 'view' NOT NULL,
	"duration_minutes" integer,
	"source_item_id" integer,
	"locally_modified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "content_items_kind_check" CHECK ("content_items"."kind" IN ('page', 'file', 'link', 'video', 'embed', 'assessment', 'live', 'scorm')),
	CONSTRAINT "content_items_completion_check" CHECK ("content_items"."completion" IN ('view', 'mark_done', 'submit', 'pass'))
);
--> statement-breakpoint
CREATE TABLE "content_progress" (
	"student_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"resume" jsonb,
	"first_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_progress_pkey" PRIMARY KEY("student_id","item_id"),
	CONSTRAINT "content_progress_status_check" CHECK ("content_progress"."status" IN ('started', 'done'))
);
--> statement-breakpoint
CREATE TABLE "course_blueprints" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"course_id" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE "final_grade_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"reason" text NOT NULL,
	"set_by" integer,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "final_grade_overrides_offering_id_student_id_key" UNIQUE("offering_id","student_id"),
	CONSTRAINT "final_grade_overrides_percent_check" CHECK ("final_grade_overrides"."percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "grade_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"name" text NOT NULL,
	"weight" numeric(5, 2) DEFAULT '0' NOT NULL,
	"drop_lowest" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "grade_categories_offering_id_name_key" UNIQUE("offering_id","name")
);
--> statement-breakpoint
CREATE TABLE "grade_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"grade_id" integer NOT NULL,
	"points" numeric(7, 2),
	"excused" boolean NOT NULL,
	"status" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"changed_by" integer,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"points" numeric(7, 2),
	"excused" boolean DEFAULT false NOT NULL,
	"missing" boolean DEFAULT false NOT NULL,
	"late_penalty_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"feedback_html" text DEFAULT '' NOT NULL,
	"feedback_file_ids" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
	"rubric_scores" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"graded_by" integer,
	"graded_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_assessment_id_student_id_key" UNIQUE("assessment_id","student_id"),
	CONSTRAINT "grades_status_check" CHECK ("grades"."status" IN ('draft', 'released')),
	CONSTRAINT "grades_points_check" CHECK ("grades"."points" IS NULL OR "grades"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"group_set_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	CONSTRAINT "group_members_pkey" PRIMARY KEY("group_id","student_id"),
	CONSTRAINT "group_members_group_set_id_student_id_key" UNIQUE("group_set_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "group_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"name" text NOT NULL,
	"self_signup" boolean DEFAULT false NOT NULL,
	"max_size" integer
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"join_url" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 45 NOT NULL,
	"recording_url" text DEFAULT '' NOT NULL,
	"auto_attendance" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_sessions_provider_check" CHECK ("live_sessions"."provider" IN ('jitsi', 'zoom', 'meet', 'teams', 'other'))
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer,
	"blueprint_id" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"unlock_at" timestamp with time zone,
	"prerequisite_module_id" integer,
	"mastery_percent" numeric(5, 2),
	"source_module_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modules_owner_check" CHECK (("modules"."offering_id" IS NULL) <> ("modules"."blueprint_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "peer_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"reviewer_student_id" integer NOT NULL,
	"rubric_scores" jsonb,
	"comments" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_reviews_submission_id_reviewer_student_id_key" UNIQUE("submission_id","reviewer_student_id")
);
--> statement-breakpoint
CREATE TABLE "question_banks" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"course_id" integer,
	"name" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"bank_id" integer NOT NULL,
	"type" text NOT NULL,
	"prompt_html" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"points" numeric(6, 2) DEFAULT '1' NOT NULL,
	"difficulty" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "questions_type_check" CHECK ("questions"."type" IN ('mcq', 'multi', 'true_false', 'short', 'numeric', 'formula', 'essay', 'matching', 'ordering', 'fill_blank', 'file_upload', 'audio')),
	CONSTRAINT "questions_difficulty_check" CHECK ("questions"."difficulty" IS NULL OR "questions"."difficulty" IN ('easy', 'medium', 'hard'))
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"score" numeric(7, 2),
	"max_score" numeric(7, 2) DEFAULT '0' NOT NULL,
	"layout" jsonb NOT NULL,
	"ip" text,
	CONSTRAINT "quiz_attempts_assessment_id_student_id_attempt_no_key" UNIQUE("assessment_id","student_id","attempt_no"),
	CONSTRAINT "quiz_attempts_status_check" CHECK ("quiz_attempts"."status" IN ('in_progress', 'submitted', 'graded'))
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"rubric_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"levels" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer,
	"title" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scorm_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"launch_path" text NOT NULL,
	"storage_prefix" text NOT NULL,
	"file_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorm_packages_version_check" CHECK ("scorm_packages"."version" IN ('1.2', '2004'))
);
--> statement-breakpoint
CREATE TABLE "student_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"group_set_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	"file_id" integer,
	"page" integer DEFAULT 1 NOT NULL,
	"shape" jsonb NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"author_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"version" integer NOT NULL,
	"text_html" text DEFAULT '' NOT NULL,
	"link_url" text DEFAULT '' NOT NULL,
	"file_ids" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_versions_submission_id_version_key" UNIQUE("submission_id","version")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"assessment_id" integer NOT NULL,
	"student_id" integer,
	"group_id" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"minutes_late" integer DEFAULT 0 NOT NULL,
	"submitted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_assessment_id_student_id_group_id_attempt_key" UNIQUE NULLS NOT DISTINCT("assessment_id","student_id","group_id","attempt"),
	CONSTRAINT "submissions_owner_check" CHECK (("submissions"."student_id" IS NULL) <> ("submissions"."group_id" IS NULL)),
	CONSTRAINT "submissions_status_check" CHECK ("submissions"."status" IN ('draft', 'submitted', 'returned'))
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"session_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"status" text NOT NULL,
	"minutes_late" integer,
	"note" text DEFAULT '' NOT NULL,
	"method" text DEFAULT 'manual' NOT NULL,
	"marked_by" integer,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_pkey" PRIMARY KEY("session_id","student_id"),
	CONSTRAINT "attendance_records_status_check" CHECK ("attendance_records"."status" IN ('present', 'absent', 'late', 'excused', 'leave')),
	CONSTRAINT "attendance_records_method_check" CHECK ("attendance_records"."method" IN ('manual', 'qr', 'leave', 'live', 'import', 'offline'))
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"section_id" integer NOT NULL,
	"offering_id" integer,
	"date" date NOT NULL,
	"period_id" integer,
	"slot_id" integer,
	"kind" text DEFAULT 'day' NOT NULL,
	"taken_by" integer,
	"qr_secret" text,
	"qr_issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_sessions_section_id_offering_id_date_period_id_key" UNIQUE NULLS NOT DISTINCT("section_id","offering_id","date","period_id"),
	CONSTRAINT "attendance_sessions_kind_check" CHECK ("attendance_sessions"."kind" IN ('day', 'class'))
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer,
	"teacher_id" integer,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"kind" text DEFAULT 'personal' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" integer,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_who_check" CHECK (("leave_requests"."student_id" IS NULL) <> ("leave_requests"."teacher_id" IS NULL)),
	CONSTRAINT "leave_requests_dates_check" CHECK ("leave_requests"."to_date" >= "leave_requests"."from_date"),
	CONSTRAINT "leave_requests_kind_check" CHECK ("leave_requests"."kind" IN ('sick', 'personal', 'family', 'official', 'other')),
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "live_joins" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"live_session_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"campus_id" integer,
	"name" text NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"position" integer NOT NULL,
	"is_break" boolean DEFAULT false NOT NULL,
	CONSTRAINT "periods_institution_id_campus_id_position_key" UNIQUE NULLS NOT DISTINCT("institution_id","campus_id","position"),
	CONSTRAINT "periods_times_check" CHECK ("periods"."ends_at" > "periods"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"campus_id" integer,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"capacity" integer,
	"kind" text DEFAULT 'classroom' NOT NULL,
	CONSTRAINT "rooms_institution_id_code_key" UNIQUE("institution_id","code"),
	CONSTRAINT "rooms_kind_check" CHECK ("rooms"."kind" IN ('classroom', 'lab', 'hall', 'library', 'ground', 'online', 'other'))
);
--> statement-breakpoint
CREATE TABLE "substitutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"slot_id" integer NOT NULL,
	"date" date NOT NULL,
	"substitute_teacher_id" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "substitutions_slot_id_date_key" UNIQUE("slot_id","date")
);
--> statement-breakpoint
CREATE TABLE "teacher_unavailability" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"period_id" integer,
	CONSTRAINT "teacher_unavailability_teacher_id_weekday_period_id_key" UNIQUE NULLS NOT DISTINCT("teacher_id","weekday","period_id")
);
--> statement-breakpoint
CREATE TABLE "timetable_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"term_id" integer,
	"section_id" integer NOT NULL,
	"offering_id" integer,
	"teacher_id" integer,
	"room_id" integer,
	"weekday" smallint NOT NULL,
	"period_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_slots_section_id_term_id_weekday_period_id_key" UNIQUE NULLS NOT DISTINCT("section_id","term_id","weekday","period_id"),
	CONSTRAINT "timetable_slots_weekday_check" CHECK ("timetable_slots"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "badge_awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"badge_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"offering_id" integer,
	"awarded_by" integer,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badge_awards_badge_id_student_id_offering_id_key" UNIQUE NULLS NOT DISTINCT("badge_id","student_id","offering_id")
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'award' NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badges_institution_id_name_key" UNIQUE("institution_id","name")
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_token_hash_key" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "certificate_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"auto_issue" boolean DEFAULT true NOT NULL,
	"min_progress_percent" integer DEFAULT 100 NOT NULL,
	"min_grade_percent" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"template_id" integer,
	"student_id" integer NOT NULL,
	"offering_id" integer,
	"verify_code" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "certificates_verify_code_key" UNIQUE("verify_code"),
	CONSTRAINT "certificates_template_id_student_id_key" UNIQUE("template_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "content_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer,
	"blueprint_id" integer,
	"format" text NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_imports_format_check" CHECK ("content_imports"."format" IN ('imscc', 'mbz', 'qti', 'classroom', 'scorm')),
	CONSTRAINT "content_imports_status_check" CHECK ("content_imports"."status" IN ('completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "delivery_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer,
	"notification_id" integer,
	"user_id" integer NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_logs_channel_check" CHECK ("delivery_logs"."channel" IN ('email', 'push')),
	CONSTRAINT "delivery_logs_status_check" CHECK ("delivery_logs"."status" IN ('sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "discussion_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"discussion_id" integer NOT NULL,
	"parent_id" integer,
	"author_id" integer,
	"body_html" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discussions" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer NOT NULL,
	"title" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'open' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	CONSTRAINT "discussions_mode_check" CHECK ("discussions"."mode" IN ('open', 'qa'))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"institution_id" integer,
	"channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_hours" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"offering_id" integer,
	"points" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_student_id_ref_key" UNIQUE("student_id","ref")
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"poll_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"institution_id" integer NOT NULL,
	"choices" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_pkey" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"anonymous" boolean DEFAULT true NOT NULL,
	"closes_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "scorm_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"package_id" integer NOT NULL,
	"item_id" integer,
	"student_id" integer NOT NULL,
	"cmi" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"score_percent" numeric(5, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scorm_attempts_package_id_student_id_item_id_key" UNIQUE NULLS NOT DISTINCT("package_id","student_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "survey_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"survey_id" integer NOT NULL,
	"respondent_id" integer,
	"respondent_hash" text NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_responses_survey_id_respondent_hash_key" UNIQUE("survey_id","respondent_hash")
);
--> statement-breakpoint
CREATE TABLE "surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"offering_id" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"anonymous" boolean DEFAULT true NOT NULL,
	"questions" jsonb NOT NULL,
	"audience" text DEFAULT 'students' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surveys_audience_check" CHECK ("surveys"."audience" IN ('students', 'staff', 'guardians', 'everyone')),
	CONSTRAINT "surveys_status_check" CHECK ("surveys"."status" IN ('draft', 'open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "xapi_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"user_id" integer,
	"verb" text NOT NULL,
	"object_id" text NOT NULL,
	"statement" jsonb NOT NULL,
	"stored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" DROP CONSTRAINT "announcements_target_audience_check";--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "campus_id" integer;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "section_id" integer;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "offering_id" integer;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "gradebook_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD COLUMN "periods_per_week" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accommodations" ADD CONSTRAINT "accommodations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accommodations" ADD CONSTRAINT "accommodations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accommodations" ADD CONSTRAINT "accommodations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_extensions" ADD CONSTRAINT "assessment_extensions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_extensions" ADD CONSTRAINT "assessment_extensions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_extensions" ADD CONSTRAINT "assessment_extensions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_extensions" ADD CONSTRAINT "assessment_extensions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."student_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_extensions" ADD CONSTRAINT "assessment_extensions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_pool_bank_id_fkey" FOREIGN KEY ("pool_bank_id") REFERENCES "public"."question_banks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."grade_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_group_set_id_fkey" FOREIGN KEY ("group_set_id") REFERENCES "public"."group_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_events" ADD CONSTRAINT "attempt_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_source_item_id_fkey" FOREIGN KEY ("source_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_scorm_package_id_fkey" FOREIGN KEY ("scorm_package_id") REFERENCES "public"."scorm_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_progress" ADD CONSTRAINT "content_progress_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_progress" ADD CONSTRAINT "content_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_progress" ADD CONSTRAINT "content_progress_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_blueprints" ADD CONSTRAINT "course_blueprints_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_blueprints" ADD CONSTRAINT "course_blueprints_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_blueprints" ADD CONSTRAINT "course_blueprints_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_grade_overrides" ADD CONSTRAINT "final_grade_overrides_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_grade_overrides" ADD CONSTRAINT "final_grade_overrides_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_grade_overrides" ADD CONSTRAINT "final_grade_overrides_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_grade_overrides" ADD CONSTRAINT "final_grade_overrides_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_categories" ADD CONSTRAINT "grade_categories_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_categories" ADD CONSTRAINT "grade_categories_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_history" ADD CONSTRAINT "grade_history_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_history" ADD CONSTRAINT "grade_history_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_history" ADD CONSTRAINT "grade_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."student_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_set_id_fkey" FOREIGN KEY ("group_set_id") REFERENCES "public"."group_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sets" ADD CONSTRAINT "group_sets_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "public"."course_blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_prerequisite_module_id_fkey" FOREIGN KEY ("prerequisite_module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_source_module_id_fkey" FOREIGN KEY ("source_module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_reviewer_student_id_fkey" FOREIGN KEY ("reviewer_student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "public"."question_banks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "public"."rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_packages" ADD CONSTRAINT "scorm_packages_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_packages" ADD CONSTRAINT "scorm_packages_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_packages" ADD CONSTRAINT "scorm_packages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_group_set_id_fkey" FOREIGN KEY ("group_set_id") REFERENCES "public"."group_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_annotations" ADD CONSTRAINT "submission_annotations_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_annotations" ADD CONSTRAINT "submission_annotations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "public"."submission_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_annotations" ADD CONSTRAINT "submission_annotations_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_annotations" ADD CONSTRAINT "submission_annotations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."student_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_marked_by_fkey" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_taken_by_fkey" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_joins" ADD CONSTRAINT "live_joins_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_joins" ADD CONSTRAINT "live_joins_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_joins" ADD CONSTRAINT "live_joins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."timetable_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_substitute_teacher_id_fkey" FOREIGN KEY ("substitute_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitutions" ADD CONSTRAINT "substitutions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_unavailability" ADD CONSTRAINT "teacher_unavailability_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_unavailability" ADD CONSTRAINT "teacher_unavailability_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_unavailability" ADD CONSTRAINT "teacher_unavailability_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_awarded_by_fkey" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "public"."course_blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_imports" ADD CONSTRAINT "content_imports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_discussion_id_fkey" FOREIGN KEY ("discussion_id") REFERENCES "public"."discussions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."discussion_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_hidden_by_fkey" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussions" ADD CONSTRAINT "discussions_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussions" ADD CONSTRAINT "discussions_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussions" ADD CONSTRAINT "discussions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD CONSTRAINT "scorm_attempts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD CONSTRAINT "scorm_attempts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."scorm_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD CONSTRAINT "scorm_attempts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD CONSTRAINT "scorm_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "public"."surveys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xapi_statements" ADD CONSTRAINT "xapi_statements_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xapi_statements" ADD CONSTRAINT "xapi_statements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assessments_offering" ON "assessments" USING btree ("offering_id");--> statement-breakpoint
CREATE INDEX "idx_attempt_events_attempt" ON "attempt_events" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "idx_content_items_module" ON "content_items" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "idx_content_progress_item" ON "content_progress" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "idx_grade_history_grade" ON "grade_history" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "idx_grades_student" ON "grades" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_live_sessions_offering" ON "live_sessions" USING btree ("offering_id","starts_at");--> statement-breakpoint
CREATE INDEX "idx_modules_offering" ON "modules" USING btree ("offering_id","position");--> statement-breakpoint
CREATE INDEX "idx_modules_blueprint" ON "modules" USING btree ("blueprint_id","position");--> statement-breakpoint
CREATE INDEX "idx_questions_bank" ON "questions" USING btree ("bank_id");--> statement-breakpoint
CREATE INDEX "idx_submission_annotations_version" ON "submission_annotations" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "idx_submissions_assessment" ON "submissions" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_records_student" ON "attendance_records" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "idx_attendance_sessions_date" ON "attendance_sessions" USING btree ("institution_id","date");--> statement-breakpoint
CREATE INDEX "idx_leave_requests_status" ON "leave_requests" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "idx_live_joins_session" ON "live_joins" USING btree ("live_session_id");--> statement-breakpoint
CREATE INDEX "idx_substitutions_date" ON "substitutions" USING btree ("institution_id","date");--> statement-breakpoint
CREATE INDEX "idx_timetable_slots_teacher" ON "timetable_slots" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_teacher_clash" ON "timetable_slots" USING btree ("teacher_id","term_id","weekday","period_id") WHERE teacher_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slots_room_clash" ON "timetable_slots" USING btree ("room_id","term_id","weekday","period_id") WHERE room_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_delivery_logs_notification" ON "delivery_logs" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "idx_discussion_posts_discussion" ON "discussion_posts" USING btree ("discussion_id");--> statement-breakpoint
CREATE INDEX "idx_discussions_offering" ON "discussions" USING btree ("offering_id");--> statement-breakpoint
CREATE INDEX "idx_push_subscriptions_user" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_xapi_statements_user" ON "xapi_statements" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "public"."campuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offerings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_target_audience_check" CHECK ("announcements"."target_audience" IN ('All', 'Teachers', 'Students', 'Parents'));
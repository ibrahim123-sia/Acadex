CREATE TABLE "mfa_email_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_email_codes_purpose_check" CHECK ("mfa_email_codes"."purpose" IN ('enable', 'verify'))
);
--> statement-breakpoint
ALTER TABLE "mfa_factors" DROP CONSTRAINT "mfa_factors_type_check";--> statement-breakpoint
ALTER TABLE "mfa_email_codes" ADD CONSTRAINT "mfa_email_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mfa_email_codes_user" ON "mfa_email_codes" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_type_check" CHECK ("mfa_factors"."type" IN ('totp', 'email'));--> statement-breakpoint
-- RLS: email codes are only ever read and written by the sign-in flows (as the system)
ALTER TABLE mfa_email_codes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE mfa_email_codes FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_only ON mfa_email_codes USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());

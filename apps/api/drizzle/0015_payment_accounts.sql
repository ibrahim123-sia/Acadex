CREATE TABLE "payment_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"mode" text DEFAULT 'sandbox' NOT NULL,
	"public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_sealed" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_institution_id_provider_key" UNIQUE("institution_id","provider"),
	CONSTRAINT "payment_accounts_provider_check" CHECK ("payment_accounts"."provider" IN ('stripe', 'jazzcash', 'easypaisa', 'bank', 'fake')),
	CONSTRAINT "payment_accounts_mode_check" CHECK ("payment_accounts"."mode" IN ('sandbox', 'live'))
);
--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON payment_accounts USING (app_bypass_rls() OR institution_id = app_institution_id())
  WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id());
--> statement-breakpoint
CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON payment_accounts
  FOR EACH ROW EXECUTE FUNCTION acadex_audit('full', 'secret_sealed');

CREATE TABLE "invoice_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_reminders_invoice_id_key_key" UNIQUE("invoice_id","key")
);
--> statement-breakpoint
ALTER TABLE "delivery_logs" DROP CONSTRAINT "delivery_logs_channel_check";--> statement-breakpoint
ALTER TABLE "delivery_logs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD COLUMN "to_address" text;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD CONSTRAINT "invoice_reminders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_logs" ADD CONSTRAINT "delivery_logs_channel_check" CHECK ("delivery_logs"."channel" IN ('email', 'push', 'sms', 'whatsapp'));--> statement-breakpoint
ALTER TABLE invoice_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoice_reminders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invoice_reminders USING (app_bypass_rls() OR institution_id = app_institution_id())
  WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id());

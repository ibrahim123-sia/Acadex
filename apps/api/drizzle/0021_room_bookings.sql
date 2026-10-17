CREATE TABLE "room_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"institution_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"title" text NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"booked_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_bookings_times_check" CHECK ("room_bookings"."ends_at" > "room_bookings"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_booked_by_fkey" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_room_bookings_room" ON "room_bookings" USING btree ("room_id","starts_at");--> statement-breakpoint
-- ---------- Row-level security and audit ----------
ALTER TABLE room_bookings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE room_bookings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON room_bookings USING (app_bypass_rls() OR institution_id = app_institution_id()) WITH CHECK (app_bypass_rls() OR institution_id = app_institution_id());--> statement-breakpoint
CREATE TRIGGER audit_changes AFTER INSERT OR UPDATE OR DELETE ON room_bookings FOR EACH ROW EXECUTE FUNCTION acadex_audit();

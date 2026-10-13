CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"scope_type" text DEFAULT 'school' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_school_id_key_key" UNIQUE NULLS NOT DISTINCT("school_id","key"),
	CONSTRAINT "roles_scope_type_check" CHECK ("roles"."scope_type" IN ('platform', 'school')),
	CONSTRAINT "roles_system_has_no_school" CHECK (NOT "roles"."is_system" OR "roles"."school_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" integer,
	"granted_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_role_scope_key" UNIQUE NULLS NOT DISTINCT("user_id","role_id","scope_type","scope_id"),
	CONSTRAINT "user_roles_scope_check" CHECK (("user_roles"."scope_type" = 'platform' AND "user_roles"."scope_id" IS NULL) OR ("user_roles"."scope_type" = 'school' AND "user_roles"."scope_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_fkey" FOREIGN KEY ("permission") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_roles_user" ON "user_roles" USING btree ("user_id");--> statement-breakpoint
-- Built-in roles (their permission sets are synced from @acadex/shared after every migrate)
INSERT INTO "roles" ("school_id", "key", "name", "is_system", "scope_type") VALUES
  (NULL, 'super_admin', 'Platform administrator', true, 'platform'),
  (NULL, 'school_admin', 'School administrator', true, 'school'),
  (NULL, 'teacher', 'Teacher', true, 'school'),
  (NULL, 'student', 'Student', true, 'school'),
  (NULL, 'parent', 'Parent / guardian', true, 'school');
--> statement-breakpoint
-- Every existing account gets the built-in role matching its users.role
INSERT INTO "user_roles" ("user_id", "role_id", "scope_type", "scope_id")
SELECT u.id, r.id, r.scope_type, CASE WHEN r.scope_type = 'platform' THEN NULL ELSE u.school_id END
  FROM "users" u
  JOIN "roles" r ON r.key = u.role AND r.school_id IS NULL
 WHERE r.scope_type = 'platform' OR u.school_id IS NOT NULL;

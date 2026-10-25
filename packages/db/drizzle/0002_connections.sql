CREATE TABLE "ai_settings" (
	"org_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'openai' NOT NULL,
	"key_sealed" text,
	"key_hint" text,
	"key_verified_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"auth_type" text NOT NULL,
	"credentials_sealed" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_detail" text,
	"last_verified_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crisp_link_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_hash" text NOT NULL,
	"website_id" text NOT NULL,
	"website_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crisp_link_tickets_ticket_hash_unique" UNIQUE("ticket_hash")
);
--> statement-breakpoint
CREATE INDEX "connections_org_idx" ON "connections" USING btree ("org_id","provider");
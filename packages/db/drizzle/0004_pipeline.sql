CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{"includeSourceLink":false,"includeCustomerNames":false,"minConfidence":0.7,"quietWindowSec":180,"timezone":"UTC","language":"en"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"topic" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"automation_id" uuid NOT NULL,
	"source_type" text DEFAULT 'conversation' NOT NULL,
	"source_id" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_processed_message_id" text,
	"last_evaluated_state" text,
	"last_evaluated_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"evaluation_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"rolling_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_source_connection_id_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automations_org_idx" ON "automations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "automations_source_idx" ON "automations" USING btree ("source_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_events_dedupe_key_unique" ON "source_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "source_events_received_idx" ON "source_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_source_unique" ON "threads" USING btree ("automation_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "threads_org_idx" ON "threads" USING btree ("org_id");
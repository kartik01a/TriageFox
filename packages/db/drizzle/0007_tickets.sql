CREATE TABLE "automation_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"automation_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_destinations_unique" UNIQUE("automation_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"automation_id" uuid NOT NULL,
	"origin_thread_id" uuid NOT NULL,
	"ai_run_id" uuid,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body_md" text NOT NULL,
	"type" text NOT NULL,
	"priority" integer NOT NULL,
	"due_date" date,
	"due_date_quote" text,
	"confidence" real NOT NULL,
	"report_count" integer DEFAULT 1 NOT NULL,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destination_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"automation_destination_id" uuid NOT NULL,
	"external_id" text,
	"external_key" text,
	"url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"last_pushed_at" timestamp with time zone,
	"last_remote_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "destination_tickets_unique" UNIQUE("issue_id","automation_destination_id")
);
--> statement-breakpoint
ALTER TABLE "automation_destinations" ADD CONSTRAINT "automation_destinations_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_destinations" ADD CONSTRAINT "automation_destinations_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_origin_thread_id_threads_id_fk" FOREIGN KEY ("origin_thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_tickets" ADD CONSTRAINT "destination_tickets_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_tickets" ADD CONSTRAINT "destination_tickets_automation_destination_id_automation_destinations_id_fk" FOREIGN KEY ("automation_destination_id") REFERENCES "public"."automation_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_thread_idx" ON "issues" USING btree ("origin_thread_id");--> statement-breakpoint
CREATE INDEX "issues_automation_idx" ON "issues" USING btree ("automation_id","status");--> statement-breakpoint
-- Row-level security (docs/security.md §6).
ALTER TABLE "automation_destinations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "automation_destinations_tenant_isolation" ON "automation_destinations"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "issues" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "issues_tenant_isolation" ON "issues"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "destination_tickets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "destination_tickets_tenant_isolation" ON "destination_tickets"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_status_check" CHECK ("status" IN ('active', 'pending_review', 'dismissed'));
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_priority_check" CHECK ("priority" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "destination_tickets" ADD CONSTRAINT "destination_tickets_status_check" CHECK ("status" IN ('pending', 'ok', 'failed', 'broken'));

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "embedding" vector(1536);
--> statement-breakpoint
CREATE INDEX "issues_embedding_idx" ON "issues" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE TABLE "issue_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"customer_ref" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_reports_unique" UNIQUE("issue_id","thread_id")
);
--> statement-breakpoint
CREATE TABLE "issue_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_sealed" text NOT NULL,
	"attachment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_priority" integer,
	"new_due_date" date,
	"customer_ref" text,
	"applied_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_updates" ADD CONSTRAINT "issue_updates_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_updates" ADD CONSTRAINT "issue_updates_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_updates_issue_idx" ON "issue_updates" USING btree ("issue_id");--> statement-breakpoint
ALTER TABLE "issue_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "issue_reports_tenant_isolation" ON "issue_reports"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "issue_updates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "issue_updates_tenant_isolation" ON "issue_updates"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "issue_updates" ADD CONSTRAINT "issue_updates_kind_check" CHECK ("kind" IN ('update', 'duplicate', 'resolved_in_chat'));

CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"model" text NOT NULL,
	"escalated" integer DEFAULT 0 NOT NULL,
	"key_source" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" integer DEFAULT 0 NOT NULL,
	"decision" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_output_sealed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"automation_id" uuid,
	"thread_id" uuid,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_thread_idx" ON "ai_runs" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_org_created_idx" ON "ai_runs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_org_created_idx" ON "activity_log" USING btree ("org_id","created_at");--> statement-breakpoint
-- Row-level security (docs/security.md §6).
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_runs_tenant_isolation" ON "ai_runs"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "activity_log_tenant_isolation" ON "activity_log"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_key_source_check" CHECK ("key_source" IN ('platform', 'byok'));
--> statement-breakpoint
-- Retention (docs/data-model.md): the sealed model output is cleared after N days; counts and cost stay.
CREATE FUNCTION "clear_old_ai_outputs"(p_days integer)
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS (
    UPDATE ai_runs SET raw_output_sealed = NULL
    WHERE raw_output_sealed IS NOT NULL AND created_at < now() - make_interval(days => p_days)
    RETURNING 1)
  SELECT count(*) FROM u
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "clear_old_ai_outputs"(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "clear_old_ai_outputs"(integer) TO triagefox_app;

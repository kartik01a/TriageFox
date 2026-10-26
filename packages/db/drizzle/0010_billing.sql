CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"prices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conversation_limit" integer,
	"fair_use_cap" integer,
	"inbox_limit" integer,
	"byok_required" boolean DEFAULT false NOT NULL,
	"support_level" text DEFAULT 'email' NOT NULL,
	"provider_price_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_popular" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_slug_version_unique" UNIQUE("slug","version")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"org_id" text PRIMARY KEY NOT NULL,
	"provider" text,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"plan_id" uuid,
	"interval" text,
	"status" text DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"past_due_since" timestamp with time zone,
	"comp_until" timestamp with time zone,
	"comp_reason" text,
	"reminder_sent_for_period_end" timestamp with time zone,
	"paused_by_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"org_id" text NOT NULL,
	"period_start" date NOT NULL,
	"conversations_analysed" integer DEFAULT 0 NOT NULL,
	"tickets_created" integer DEFAULT 0 NOT NULL,
	"ai_runs" integer DEFAULT 0 NOT NULL,
	"ai_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"trial_ai_cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"warned_80" boolean DEFAULT false NOT NULL,
	"warned_100" boolean DEFAULT false NOT NULL,
	CONSTRAINT "usage_counters_unique" UNIQUE("org_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "usage_conversations" (
	"org_id" text NOT NULL,
	"period_start" date NOT NULL,
	"thread_id" uuid NOT NULL,
	CONSTRAINT "usage_conversations_unique" UNIQUE("org_id","period_start","thread_id")
);
--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"email" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_org" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_org_id" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"category" text NOT NULL,
	"priority" integer,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"customer_email" text,
	"identity_verified" boolean DEFAULT false NOT NULL,
	"matched_user_id" text,
	"matched_org_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"testimonial_approved" boolean DEFAULT false NOT NULL,
	"crisp_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_items_thread_category_unique" UNIQUE("thread_id","category")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "support_items_status_idx" ON "support_items" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('trialing', 'active', 'past_due', 'canceled', 'comped'));--> statement-breakpoint
ALTER TABLE "support_items" ADD CONSTRAINT "support_items_status_check" CHECK ("status" IN ('new', 'in_progress', 'done'));--> statement-breakpoint
-- Row-level security on the tenant tables (docs/security.md §6).
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "usage_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "usage_counters_tenant_isolation" ON "usage_counters"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "usage_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "usage_conversations_tenant_isolation" ON "usage_conversations"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
-- Cross-workspace questions the app must ask without being able to read other workspaces' rows.
-- Each answers one narrow question and returns identifiers or totals only.
CREATE FUNCTION "billing_org_for_subscription"(p_subscription_id text, p_customer_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT org_id FROM subscriptions
  WHERE (p_subscription_id IS NOT NULL AND provider_subscription_id = p_subscription_id)
     OR (p_customer_id IS NOT NULL AND provider_customer_id = p_customer_id)
  LIMIT 1
$$;
--> statement-breakpoint
CREATE FUNCTION "platform_trial_ai_micro_usd"(p_from date)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(trial_ai_cost_micro_usd), 0)::bigint FROM usage_counters WHERE period_start >= p_from
$$;
--> statement-breakpoint
CREATE FUNCTION "platform_ai_micro_usd"(p_from date)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(ai_cost_micro_usd), 0)::bigint FROM usage_counters WHERE period_start >= p_from
$$;
--> statement-breakpoint
CREATE FUNCTION "billing_due_reminders"(p_monthly_days integer, p_yearly_days integer)
RETURNS TABLE (org_id text, period_end timestamptz, plan_interval text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.org_id, s.current_period_end, s.interval
  FROM subscriptions s
  WHERE s.status = 'active' AND NOT s.cancel_at_period_end AND s.current_period_end IS NOT NULL
    AND (s.reminder_sent_for_period_end IS NULL OR s.reminder_sent_for_period_end <> s.current_period_end)
    AND s.current_period_end > now()
    AND s.current_period_end <= now() + make_interval(days => CASE s.interval WHEN 'yearly' THEN p_yearly_days ELSE p_monthly_days END)
$$;
--> statement-breakpoint
CREATE FUNCTION "billing_ending_trials"(p_within_days integer)
RETURNS TABLE (org_id text, trial_ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT org_id, trial_ends_at FROM subscriptions
  WHERE status = 'trialing' AND trial_ends_at IS NOT NULL
    AND trial_ends_at > now() AND trial_ends_at <= now() + make_interval(days => p_within_days)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "billing_org_for_subscription"(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform_trial_ai_micro_usd"(date) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "platform_ai_micro_usd"(date) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "billing_due_reminders"(integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "billing_ending_trials"(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "billing_org_for_subscription"(text, text) TO triagefox_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "platform_trial_ai_micro_usd"(date) TO triagefox_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "platform_ai_micro_usd"(date) TO triagefox_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "billing_due_reminders"(integer, integer) TO triagefox_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "billing_ending_trials"(integer) TO triagefox_app;

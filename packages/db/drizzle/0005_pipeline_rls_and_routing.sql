-- Row-level security for the pipeline tables (docs/security.md §6).
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "automations_tenant_isolation" ON "automations"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "source_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "source_events_tenant_isolation" ON "source_events"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "threads_tenant_isolation" ON "threads"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_status_check" CHECK ("status" IN ('received', 'ignored'));
--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_state_check" CHECK ("state" IN ('open', 'resolved'));
--> statement-breakpoint
-- Routing without cross-workspace access.
-- A Crisp hook only knows the website id, not the workspace, and the runtime role cannot read across
-- workspaces. These SECURITY DEFINER functions (owned by the migration role, which bypasses RLS) answer
-- exactly one narrow question each and return identifiers only: no names, no credentials, no settings
-- beyond the quiet window. The runtime role may execute them; nobody else.
CREATE FUNCTION "crisp_routes"(p_website_id text)
RETURNS TABLE (org_id text, connection_id uuid, automation_id uuid, quiet_window_sec integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.org_id, c.id, a.id, COALESCE((a.settings ->> 'quietWindowSec')::integer, 180)
  FROM connections c
  JOIN automations a ON a.source_connection_id = c.id
  WHERE c.provider = 'crisp' AND c.status = 'active' AND a.enabled
    AND c.metadata ->> 'websiteId' = p_website_id
$$;
--> statement-breakpoint
CREATE FUNCTION "crisp_reconcile_targets"()
RETURNS TABLE (org_id text, connection_id uuid, website_id text, automation_id uuid, quiet_window_sec integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.org_id, c.id, c.metadata ->> 'websiteId', a.id, COALESCE((a.settings ->> 'quietWindowSec')::integer, 180)
  FROM connections c
  JOIN automations a ON a.source_connection_id = c.id
  WHERE c.provider = 'crisp' AND c.status = 'active' AND a.enabled
    AND c.metadata ->> 'websiteId' IS NOT NULL
$$;
--> statement-breakpoint
-- Retention (docs/data-model.md): hook records older than N days are deleted.
CREATE FUNCTION "purge_old_source_events"(p_days integer)
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH d AS (DELETE FROM source_events WHERE received_at < now() - make_interval(days => p_days) RETURNING 1)
  SELECT count(*) FROM d
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "crisp_routes"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "crisp_reconcile_targets"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "purge_old_source_events"(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "crisp_routes"(text) TO triagefox_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "crisp_reconcile_targets"() TO triagefox_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "purge_old_source_events"(integer) TO triagefox_app;

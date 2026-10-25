-- Row-level security for the new tenant tables (docs/security.md §6): the runtime role only sees
-- rows of the workspace set by withOrg().
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "connections_tenant_isolation" ON "connections"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
ALTER TABLE "ai_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_settings_tenant_isolation" ON "ai_settings"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));
--> statement-breakpoint
-- Data integrity.
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_check"
  CHECK ("provider" IN ('crisp', 'trello', 'jira'));
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_status_check"
  CHECK ("status" IN ('pending', 'active', 'error', 'revoked'));
--> statement-breakpoint
-- A Crisp website can only be linked to ONE workspace, across all workspaces (docs/security.md).
-- Unique indexes are global even with RLS, so this holds for every tenant.
CREATE UNIQUE INDEX "connections_crisp_website_unique"
  ON "connections" ((("metadata" ->> 'websiteId')))
  WHERE "provider" = 'crisp';

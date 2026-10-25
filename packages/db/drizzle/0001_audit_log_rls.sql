-- Row-level security for tenant tables (docs/security.md §6).
-- The runtime role (triagefox_app) does not own the tables, so these policies always apply to it.
-- Queries must run via withOrg(), which sets app.current_org for the transaction.
-- With the setting empty, current_setting(..., true) is NULL and no rows match.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
  USING ("org_id" = current_setting('app.current_org', true))
  WITH CHECK ("org_id" = current_setting('app.current_org', true));

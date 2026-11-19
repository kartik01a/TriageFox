-- Connection keep-alive: OAuth providers drop refresh tokens that go unused (Atlassian after 90 days,
-- Linear 30 days after issue), so the worker refreshes them daily. The runtime role cannot read across
-- workspaces; this answers one narrow question and returns identifiers only (no credentials).
CREATE FUNCTION "oauth_keepalive_targets"()
RETURNS TABLE (org_id text, connection_id uuid, provider text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.org_id, c.id, c.provider
  FROM connections c
  WHERE c.provider IN ('jira', 'linear') AND c.status = 'active' AND c.credentials_sealed IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "oauth_keepalive_targets"() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "oauth_keepalive_targets"() TO triagefox_app;

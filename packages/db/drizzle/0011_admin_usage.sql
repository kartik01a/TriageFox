-- Platform admin: the workspaces that cost the most AI this month. Totals only, no tenant content.
CREATE FUNCTION "admin_top_usage"(p_from date, p_limit integer)
RETURNS TABLE (org_id text, conversations integer, ai_cost_micro_usd bigint, trial_cost_micro_usd bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.org_id, SUM(u.conversations_analysed)::integer, SUM(u.ai_cost_micro_usd)::bigint, SUM(u.trial_ai_cost_micro_usd)::bigint
  FROM usage_counters u
  WHERE u.period_start >= p_from
  GROUP BY u.org_id
  ORDER BY SUM(u.ai_cost_micro_usd) DESC
  LIMIT p_limit
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "admin_top_usage"(date, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "admin_top_usage"(date, integer) TO triagefox_app;

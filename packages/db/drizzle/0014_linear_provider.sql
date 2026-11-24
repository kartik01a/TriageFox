-- Linear as a destination (ADR 0016).
ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_check";
--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_check"
  CHECK ("provider" IN ('crisp', 'trello', 'jira', 'linear'));

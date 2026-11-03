-- Plan changes (ADR 0015): the subscription's currency, and a downgrade scheduled for the next billing date.
ALTER TABLE "subscriptions" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_plan_id" uuid REFERENCES "plans"("id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_interval" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "scheduled_at" timestamp with time zone;

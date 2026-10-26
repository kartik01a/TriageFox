import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { automations, threads } from "./pipeline";

/**
 * One AI analysis of one conversation. Holds counts, cost and the decision (titles and reasons the AI
 * wrote); the model's full answer is sealed and cleared after 30 days (docs/data-model.md). The
 * conversation itself is never stored. RLS on org_id (migration 0006).
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    escalated: integer("escalated").notNull().default(0),
    keySource: text("key_source").$type<"platform" | "byok">().notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Millionths of a US dollar, so sums stay exact. */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** `create` | `update` | `duplicate_of` | `no_action`, one per action, plus counts. */
    decision: jsonb("decision")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Sealed box (binding: orgId, run id, "ai_run.output"); cleared to NULL after 30 days. */
    rawOutputSealed: text("raw_output_sealed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_runs_thread_idx").on(t.threadId, t.createdAt),
    index("ai_runs_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/** What the product did and why, shown in the dashboard (Phase 7). Never holds message text. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    automationId: uuid("automation_id").references(() => automations.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => threads.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    refs: jsonb("refs").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_log_org_created_idx").on(t.orgId, t.createdAt)],
);

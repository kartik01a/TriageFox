import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { connections } from "./connections";

export interface AutomationSettings {
  includeSourceLink: boolean;
  includeCustomerNames: boolean;
  minConfidence: number;
  /** Seconds of silence after the last customer message before a conversation is analysed. */
  quietWindowSec: number;
  timezone: string;
  language: string;
  /** The person has looked at and saved these (setup checklist step). */
  reviewed?: boolean;
  /** TriageFox's own support automation: also files conversations in the admin inbox (docs/own-support.md). */
  supportInbox?: boolean;
}

export const defaultAutomationSettings: AutomationSettings = {
  includeSourceLink: false,
  includeCustomerNames: false,
  minConfidence: 0.7,
  quietWindowSec: 180,
  timezone: "UTC",
  language: "en",
};

/**
 * One automation = one source connection (+ destinations, added in Phase 5). The setup UI arrives in
 * Phase 7; until then rows are created by tests and scripts. RLS on org_id (migration 0005).
 * Deleting the source connection deletes its automations (and, through them, threads).
 */
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    sourceConnectionId: uuid("source_connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    settings: jsonb("settings")
      .$type<AutomationSettings>()
      .notNull()
      .default(defaultAutomationSettings),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("automations_org_idx").on(t.orgId),
    index("automations_source_idx").on(t.sourceConnectionId),
  ],
);

/**
 * Raw hook deliveries, IDs only (docs/security.md §4): no message content is ever stored.
 * `dedupe_key` is unique, so a repeated delivery is a no-op.
 */
export const sourceEvents = pgTable(
  "source_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    topic: text("topic").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    /** `received` = turned into scheduled work, `ignored` = valid but needs no work (context only). */
    status: text("status").$type<"received" | "ignored">().notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("source_events_dedupe_key_unique").on(t.dedupeKey),
    index("source_events_received_idx").on(t.receivedAt),
  ],
);

/**
 * One conversation as seen by one automation. Holds scheduling state and the *position* we have
 * processed (a message fingerprint), never the conversation itself.
 */
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull().default("conversation"),
    /** Crisp session_id. */
    sourceId: text("source_id").notNull(),
    state: text("state").$type<"open" | "resolved">().notNull().default("open"),
    /** When the most recent relevant hook/reconcile signal arrived; the worker compares it to detect new activity. */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull().defaultNow(),
    lastProcessedMessageId: text("last_processed_message_id"),
    lastEvaluatedState: text("last_evaluated_state"),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    /** The conversation's own `updated_at` as of our last fetch; reconcile compares against it. */
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    evaluationCount: integer("evaluation_count").notNull().default(0),
    lastError: text("last_error"),
    /** Encrypted rolling summary for long conversations (Phase 4). */
    rollingSummary: text("rolling_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("threads_source_unique").on(t.automationId, t.sourceType, t.sourceId),
    index("threads_org_idx").on(t.orgId),
  ],
);

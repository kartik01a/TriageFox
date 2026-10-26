import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { connections } from "./connections";
import { automations, threads } from "./pipeline";

/** Trello: where cards go and the label ids found/created on the board. Jira: project and mappings. */
export type DestinationConfig =
  | {
      kind: "trello";
      boardId: string;
      listId: string;
      labelIds?: { types?: Record<string, string>; priorities?: Record<string, string> };
    }
  | {
      kind: "jira";
      cloudId: string;
      projectKey: string;
      issueTypeMap: Record<string, string>;
      priorityMap: Record<string, string>;
      extraLabels?: string[];
    };

/** One place an automation sends tickets to. Rows are created by the Phase 7 wizard (tests/scripts until then). */
export const automationDestinations = pgTable(
  "automation_destinations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    config: jsonb("config").$type<DestinationConfig>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("automation_destinations_unique").on(t.automationId, t.connectionId)],
);

/** A ticket we decided to create. The source of truth; each destination gets its own destination_tickets row. */
export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    originThreadId: uuid("origin_thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    aiRunId: uuid("ai_run_id"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    bodyMd: text("body_md").notNull(),
    type: text("type").notNull(),
    priority: integer("priority").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    dueDateQuote: text("due_date_quote"),
    confidence: real("confidence").notNull(),
    /** Embedding of title + summary, for duplicate search. Null until it has been computed. */
    embedding: vector("embedding", { dimensions: 1536 }),
    reportCount: integer("report_count").notNull().default(1),
    /** Crisp message fingerprints of the files to attach (ids only; files are fetched at delivery). */
    attachmentIds: jsonb("attachment_ids").$type<string[]>().notNull().default([]),
    status: text("status")
      .$type<"active" | "pending_review" | "dismissed">()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("issues_thread_idx").on(t.originThreadId),
    index("issues_automation_idx").on(t.automationId, t.status),
  ],
);

/** What exists in one destination for one issue. UNIQUE (issue, destination): never created twice. */
export const destinationTickets = pgTable(
  "destination_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    destinationId: uuid("automation_destination_id")
      .notNull()
      .references(() => automationDestinations.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    externalKey: text("external_key"),
    url: text("url"),
    status: text("status")
      .$type<"pending" | "ok" | "failed" | "broken">()
      .notNull()
      .default("pending"),
    lastError: text("last_error"),
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    lastRemoteUpdatedAt: timestamp("last_remote_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("destination_tickets_unique").on(t.issueId, t.destinationId)],
);

/** Every conversation that reported an issue (the first one and each confirmed duplicate). */
export const issueReports = pgTable(
  "issue_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** The customer's name, stored only when the automation allows names in tickets. */
    customerRef: text("customer_ref"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("issue_reports_unique").on(t.issueId, t.threadId)],
);

/**
 * Something to tell the trackers about an existing issue: a follow-up from the same conversation,
 * another customer's report, or "possibly fixed in chat". The AI-written text is sealed; once every
 * destination has it, the row is just a record.
 */
export const issueUpdates = pgTable(
  "issue_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"update" | "duplicate" | "resolved_in_chat">().notNull(),
    /** Sealed JSON `{ text }` (binding: orgId, row id, "issue_update.content"). */
    contentSealed: text("content_sealed").notNull(),
    attachmentIds: jsonb("attachment_ids").$type<string[]>().notNull().default([]),
    /** Crisp's website/session needed to fetch the files later are on the thread; only ids here. */
    newPriority: integer("new_priority"),
    newDueDate: date("new_due_date", { mode: "string" }),
    /** Names allowed in tickets only; otherwise null. */
    customerRef: text("customer_ref"),
    /** destination_tickets ids this update has already been applied to (retries skip them). */
    appliedTo: jsonb("applied_to").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("issue_updates_issue_idx").on(t.issueId)],
);

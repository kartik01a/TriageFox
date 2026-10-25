import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const connectionProviders = ["crisp", "trello", "jira"] as const;
export type ConnectionProvider = (typeof connectionProviders)[number];
export type ConnectionStatus = "pending" | "active" | "error" | "revoked";

/**
 * A workspace's link to an external tool (docs/data-model.md).
 *
 * `credentials_sealed` holds the OAuth tokens / API key as a sealed box (packages/crypto): the web app
 * can write it but cannot read it back; only the worker opens it. `metadata` is non-secret
 * (Crisp websiteId, Jira site, Trello username, chosen board/project defaults).
 * Row-level security is enabled in migration 0002.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    provider: text("provider").$type<ConnectionProvider>().notNull(),
    authType: text("auth_type").notNull(), // plugin_install | oauth | token
    credentialsSealed: text("credentials_sealed"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({} as Record<string, unknown>),
    status: text("status").$type<ConnectionStatus>().notNull().default("pending"),
    statusDetail: text("status_detail"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("connections_org_idx").on(t.orgId, t.provider)],
);

/** One OpenAI key per workspace (bring-your-own-key). The key is write-only: only a hint is readable. */
export const aiSettings = pgTable("ai_settings", {
  orgId: text("org_id").primaryKey(),
  provider: text("provider").notNull().default("openai"),
  keySealed: text("key_sealed"),
  /** Display-only, e.g. `sk-…1234`. */
  keyHint: text("key_hint"),
  keyVerifiedAt: timestamp("key_verified_at", { withTimezone: true }),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Short-lived, single-use proof that someone opened our page from inside a Crisp website.
 * Created after the worker verified Crisp's per-website token; consumed when a signed-in owner/admin
 * confirms the link. Only a hash of the ticket is stored. Not tenant data (no workspace yet).
 */
export const crispLinkTickets = pgTable("crisp_link_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketHash: text("ticket_hash").notNull().unique(),
  websiteId: text("website_id").notNull(),
  websiteName: text("website_name"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

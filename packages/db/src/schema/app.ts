import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Pre-launch waitlist. Not tenant data (no workspace), so no RLS. */
export const waitlistSignups = pgTable("waitlist_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Platform-wide settings, edited by platform admins (ADR 0009). */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-workspace audit trail (docs/security.md §11). Row-level security is enabled in a custom
 * migration: the runtime role only sees rows whose org_id matches `app.current_org`.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    target: text("target"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_created_idx").on(t.orgId, t.createdAt)],
);

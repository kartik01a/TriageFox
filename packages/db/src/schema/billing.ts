import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** Prices in minor units per currency: `{ USD: { monthly: 900, yearly: 9000 }, INR: {...} }`. */
export type PlanPrices = Record<string, { monthly: number; yearly: number }>;
/** Provider product ids per currency and interval: `{ dodo: { USD: { monthly: "pdt_..", yearly: ".." } } }`. */
export type ProviderPriceIds = Record<
  string,
  Record<string, { monthly?: string; yearly?: string }>
>;

/**
 * What a workspace can buy. Global (not tenant data), edited only through the admin routes (ADR 0009).
 * Changing a price creates a new version; existing subscribers keep theirs.
 */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    version: integer("version").notNull().default(1),
    name: text("name").notNull(),
    prices: jsonb("prices").$type<PlanPrices>().notNull().default({}),
    /** Conversations analysed per period; null = unlimited (then `fairUseCap` is a soft ceiling). */
    conversationLimit: integer("conversation_limit"),
    fairUseCap: integer("fair_use_cap"),
    /** Connected inboxes (Crisp websites); null = unlimited. */
    inboxLimit: integer("inbox_limit"),
    /** The plan only makes sense with the workspace's own OpenAI key. */
    byokRequired: boolean("byok_required").notNull().default(false),
    supportLevel: text("support_level").notNull().default("email"),
    providerPriceIds: jsonb("provider_price_ids").$type<ProviderPriceIds>().notNull().default({}),
    isPublic: boolean("is_public").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    isPopular: boolean("is_popular").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("plans_slug_version_unique").on(t.slug, t.version)],
);

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "comped";

/** One per workspace. RLS on org_id (migration 0010). */
export const subscriptions = pgTable("subscriptions", {
  orgId: text("org_id").primaryKey(),
  provider: text("provider"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  planId: uuid("plan_id").references(() => plans.id),
  interval: text("interval").$type<"monthly" | "yearly">(),
  status: text("status").$type<SubscriptionStatus>().notNull().default("trialing"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  pastDueSince: timestamp("past_due_since", { withTimezone: true }),
  /** Free access granted by an admin: null = indefinitely. Only meaningful when status = comped. */
  compUntil: timestamp("comp_until", { withTimezone: true }),
  compReason: text("comp_reason"),
  /** The renewal reminder was already sent for the period ending at this time. */
  reminderSentForPeriodEnd: timestamp("reminder_sent_for_period_end", { withTimezone: true }),
  /** An admin paused the workspace (support action). */
  pausedByAdmin: boolean("paused_by_admin").notNull().default(false),
  /** Currency of the paid subscription (plan changes must stay in it). */
  currency: text("currency"),
  /** A downgrade the customer scheduled for the next billing date (ADR 0015). */
  scheduledPlanId: uuid("scheduled_plan_id").references(() => plans.id),
  scheduledInterval: text("scheduled_interval").$type<"monthly" | "yearly">(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Usage in one entitlement period. RLS on org_id. Cost in millionths of a dollar. */
export const usageCounters = pgTable(
  "usage_counters",
  {
    orgId: text("org_id").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    conversationsAnalysed: integer("conversations_analysed").notNull().default(0),
    ticketsCreated: integer("tickets_created").notNull().default(0),
    aiRuns: integer("ai_runs").notNull().default(0),
    aiCostMicroUsd: bigint("ai_cost_micro_usd", { mode: "number" }).notNull().default(0),
    trialAiCostMicroUsd: bigint("trial_ai_cost_micro_usd", { mode: "number" }).notNull().default(0),
    warned80: boolean("warned_80").notNull().default(false),
    warned100: boolean("warned_100").notNull().default(false),
  },
  (t) => [unique("usage_counters_unique").on(t.orgId, t.periodStart)],
);

/** Which conversations already counted in a period, so re-analysing one never counts twice. RLS. */
export const usageConversations = pgTable(
  "usage_conversations",
  {
    orgId: text("org_id").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    threadId: uuid("thread_id").notNull(),
  },
  (t) => [unique("usage_conversations_unique").on(t.orgId, t.periodStart, t.threadId)],
);

/** Single-use, email-bound, hashed invite codes that grant a complimentary plan. Global. */
export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeHash: text("code_hash").notNull().unique(),
  email: text("email").notNull(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id),
  months: integer("months").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  usedByOrg: text("used_by_org"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Billing webhook deliveries already handled (the provider's event id is unique). Global. */
export const billingEvents = pgTable("billing_events", {
  eventId: text("event_id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every platform-admin change, with before and after. Global; only admin routes touch it. */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_audit_log_created_idx").on(t.createdAt)],
);

export type SupportCategory =
  | "bug"
  | "feature"
  | "billing"
  | "refund_request"
  | "account"
  | "complaint"
  | "question"
  | "praise";

/** Our own support inbox (docs/own-support.md). Global; only admin routes read it. */
export const supportItems = pgTable(
  "support_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The conversation it came from, as ids only. */
    sourceOrgId: text("source_org_id").notNull(),
    threadId: uuid("thread_id").notNull(),
    category: text("category").$type<SupportCategory>().notNull(),
    priority: integer("priority"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    customerEmail: text("customer_email"),
    identityVerified: boolean("identity_verified").notNull().default(false),
    matchedUserId: text("matched_user_id"),
    matchedOrgId: text("matched_org_id"),
    status: text("status").$type<"new" | "in_progress" | "done">().notNull().default("new"),
    notes: jsonb("notes")
      .$type<{ at: string; by: string; text: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    testimonialApproved: boolean("testimonial_approved").notNull().default(false),
    crispUrl: text("crisp_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("support_items_thread_category_unique").on(t.threadId, t.category),
    index("support_items_status_idx").on(t.status, t.createdAt),
  ],
);

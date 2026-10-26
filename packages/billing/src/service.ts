import { createHash, randomBytes } from "node:crypto";
import { and, asc, type Db, desc, eq, schema, sql, withOrg } from "@triagefox/db";
import { type Decision, evaluate, periodStartFor } from "./entitlement";
import type { NormalizedEvent } from "./provider";
import {
  defaultPlatformSettings,
  type PlatformSettingKey,
  type PlatformSettings,
  platformSettingsSchemas,
} from "./settings";

type Plan = typeof schema.plans.$inferSelect;
type Subscription = typeof schema.subscriptions.$inferSelect;

const monthStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

// ---- Platform settings (database, not code) ----------------------------------------------------

/** Every setting, with the built-in fallback for anything an admin never saved or saved invalidly. */
export async function getSettings(db: Db): Promise<PlatformSettings> {
  const rows = await db.select().from(schema.platformSettings);
  const out: PlatformSettings = structuredClone(defaultPlatformSettings);
  for (const row of rows) {
    const key = row.key as PlatformSettingKey;
    const parser = platformSettingsSchemas[key];
    if (!parser) continue;
    const parsed = parser.safeParse(row.value);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

// ---- Plans ---------------------------------------------------------------------------------------

/**
 * The newest active version of every plan. `publicOnly` is what customers can buy: the newest version that is
 * public, so after a price change the old version stays on sale until the new one has its product ids and is published.
 */
export async function listPlans(db: Db, opts: { publicOnly?: boolean } = {}): Promise<Plan[]> {
  const rows = await db
    .select()
    .from(schema.plans)
    .where(
      opts.publicOnly
        ? and(eq(schema.plans.isActive, true), eq(schema.plans.isPublic, true))
        : eq(schema.plans.isActive, true),
    )
    .orderBy(asc(schema.plans.sortOrder), desc(schema.plans.version));
  const seen = new Set<string>();
  const latest: Plan[] = [];
  for (const p of rows) {
    if (seen.has(p.slug)) continue;
    seen.add(p.slug);
    latest.push(p);
  }
  return latest;
}

/** Which plan version, interval and currency a provider product id belongs to. */
export function findPlanForProduct(
  plans: Plan[],
  provider: string,
  productId: string,
): { plan: Plan; interval: "monthly" | "yearly"; currency: string } | null {
  for (const plan of plans)
    for (const [currency, ids] of Object.entries(plan.providerPriceIds[provider] ?? {}))
      for (const interval of ["monthly", "yearly"] as const)
        if (ids[interval] === productId) return { plan, interval, currency };
  return null;
}

// ---- Subscriptions -------------------------------------------------------------------------------

export async function getSubscription(db: Db, orgId: string) {
  const [sub] = await withOrg(db, orgId, (tx) =>
    tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.orgId, orgId)),
  );
  if (!sub) return { subscription: null, plan: null };
  const [plan] = sub.planId
    ? await db.select().from(schema.plans).where(eq(schema.plans.id, sub.planId))
    : [];
  return { subscription: sub, plan: plan ?? null };
}

/** Every new workspace starts a trial (hosted only). Safe to call twice. */
export async function startTrial(db: Db, orgId: string, now = new Date()) {
  const settings = await getSettings(db);
  await withOrg(db, orgId, (tx) =>
    tx
      .insert(schema.subscriptions)
      .values({
        orgId,
        status: "trialing",
        trialEndsAt: new Date(now.getTime() + settings.trial.days * 86_400_000),
      })
      .onConflictDoNothing(),
  );
}

// ---- Limits and usage ------------------------------------------------------------------------------

export async function checkEntitlement(
  db: Db,
  i: { orgId: string; threadId: string; hasOwnKey: boolean; now?: Date },
): Promise<{ decision: Decision; periodStart: string; trialing: boolean }> {
  const now = i.now ?? new Date();
  const { subscription, plan } = await getSubscription(db, i.orgId);
  const settings = await getSettings(db);
  const periodStart = periodStartFor(subscription, now);
  const [counter, counted] = await withOrg(db, i.orgId, async (tx) => [
    (
      await tx
        .select({ n: schema.usageCounters.conversationsAnalysed })
        .from(schema.usageCounters)
        .where(
          and(
            eq(schema.usageCounters.orgId, i.orgId),
            eq(schema.usageCounters.periodStart, periodStart),
          ),
        )
    )[0],
    (
      await tx
        .select({ t: schema.usageConversations.threadId })
        .from(schema.usageConversations)
        .where(
          and(
            eq(schema.usageConversations.orgId, i.orgId),
            eq(schema.usageConversations.periodStart, periodStart),
            eq(schema.usageConversations.threadId, i.threadId),
          ),
        )
    )[0],
  ]);
  const trialing = subscription?.status === "trialing";
  let trialSpendUsd = 0;
  if (trialing) {
    const rows = await db.execute<{ v: string }>(
      sql`select platform_trial_ai_micro_usd(${monthStart(now)}::date)::text as v`,
    );
    trialSpendUsd = Number(rows[0]?.v ?? 0) / 1e6;
  }
  const decision = evaluate({
    now,
    subscription,
    plan,
    settings,
    used: counter?.n ?? 0,
    alreadyCounted: !!counted,
    hasOwnKey: i.hasOwnKey,
    platformTrialSpendUsd: trialSpendUsd,
  });
  return { decision, periodStart, trialing };
}

/**
 * Counts one analysed conversation (once per period), its AI runs and cost. Returns which warning level
 * was crossed for the first time this period, so the caller emails exactly once.
 */
export async function recordUsage(
  db: Db,
  i: {
    orgId: string;
    threadId: string;
    periodStart: string;
    costMicroUsd: number;
    trialing: boolean;
    usingPlatformKey: boolean;
    ticketsCreated: number;
    limit: number | null;
  },
): Promise<{ crossed: "80" | "100" | null; used: number }> {
  return withOrg(db, i.orgId, async (tx) => {
    const inserted = await tx
      .insert(schema.usageConversations)
      .values({ orgId: i.orgId, periodStart: i.periodStart, threadId: i.threadId })
      .onConflictDoNothing()
      .returning({ t: schema.usageConversations.threadId });
    const [row] = await tx
      .insert(schema.usageCounters)
      .values({
        orgId: i.orgId,
        periodStart: i.periodStart,
        conversationsAnalysed: inserted.length,
        ticketsCreated: i.ticketsCreated,
        aiRuns: 1,
        aiCostMicroUsd: i.costMicroUsd,
        trialAiCostMicroUsd: i.trialing && i.usingPlatformKey ? i.costMicroUsd : 0,
      })
      .onConflictDoUpdate({
        target: [schema.usageCounters.orgId, schema.usageCounters.periodStart],
        set: {
          conversationsAnalysed: sql`${schema.usageCounters.conversationsAnalysed} + ${inserted.length}`,
          ticketsCreated: sql`${schema.usageCounters.ticketsCreated} + ${i.ticketsCreated}`,
          aiRuns: sql`${schema.usageCounters.aiRuns} + 1`,
          aiCostMicroUsd: sql`${schema.usageCounters.aiCostMicroUsd} + ${i.costMicroUsd}`,
          trialAiCostMicroUsd: sql`${schema.usageCounters.trialAiCostMicroUsd} + ${i.trialing && i.usingPlatformKey ? i.costMicroUsd : 0}`,
        },
      })
      .returning();
    const used = row?.conversationsAnalysed ?? 0;
    if (!row || i.limit === null || i.limit === 0) return { crossed: null, used };
    let crossed: "80" | "100" | null = null;
    if (used >= i.limit && !row.warned100) crossed = "100";
    else if (used >= Math.ceil(i.limit * 0.8) && !row.warned80 && !row.warned100) crossed = "80";
    if (crossed)
      await tx
        .update(schema.usageCounters)
        .set(crossed === "100" ? { warned80: true, warned100: true } : { warned80: true })
        .where(
          and(
            eq(schema.usageCounters.orgId, i.orgId),
            eq(schema.usageCounters.periodStart, i.periodStart),
          ),
        );
    return { crossed, used };
  });
}

// ---- Webhooks ----------------------------------------------------------------------------------

export type ApplyResult =
  | { handled: false; reason: "duplicate" | "ignored" | "unknown_workspace" }
  | { handled: true; orgId: string; status: Subscription["status"] };

/** Applies one verified provider event to the workspace's subscription. Idempotent on the event id. */
export async function applyBillingEvent(
  db: Db,
  provider: string,
  e: NormalizedEvent,
  now = new Date(),
): Promise<ApplyResult> {
  if (e.type === "ignored") return { handled: false, reason: "ignored" };
  const fresh = await db
    .insert(schema.billingEvents)
    .values({ eventId: e.id, provider, type: e.rawType })
    .onConflictDoNothing()
    .returning({ id: schema.billingEvents.eventId });
  if (fresh.length === 0) return { handled: false, reason: "duplicate" };

  let orgId = e.orgId;
  if (!orgId) {
    const rows = await db.execute<{ org: string | null }>(
      sql`select billing_org_for_subscription(${e.subscriptionId ?? null}, ${e.customerId ?? null}) as org`,
    );
    orgId = rows[0]?.org ?? undefined;
  }
  if (!orgId) return { handled: false, reason: "unknown_workspace" };
  const org = orgId;

  const plans = await db.select().from(schema.plans);
  const match = e.productId ? findPlanForProduct(plans, provider, e.productId) : null;

  const status = await withOrg(db, org, async (tx) => {
    const [cur] = await tx
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.orgId, org));
    const base = {
      orgId: org,
      provider,
      providerCustomerId: e.customerId ?? cur?.providerCustomerId ?? null,
      providerSubscriptionId: e.subscriptionId ?? cur?.providerSubscriptionId ?? null,
    };
    let patch: Partial<typeof schema.subscriptions.$inferInsert> | null = null;
    switch (e.type) {
      case "subscription_active":
        patch = {
          status: "active",
          planId: match?.plan.id ?? cur?.planId ?? null,
          interval: match?.interval ?? cur?.interval ?? null,
          currentPeriodStart: e.periodStart ?? cur?.currentPeriodStart ?? now,
          currentPeriodEnd: e.periodEnd ?? cur?.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: false,
          pastDueSince: null,
          compUntil: null,
        };
        break;
      case "subscription_past_due":
      case "payment_failed":
        if (cur?.status === "comped") break;
        patch = { status: "past_due", pastDueSince: cur?.pastDueSince ?? now };
        break;
      case "payment_succeeded":
        if (cur?.status === "past_due") patch = { status: "active", pastDueSince: null };
        break;
      case "subscription_cancelled": {
        if (cur?.status === "comped") break;
        const end = e.periodEnd ?? cur?.currentPeriodEnd ?? now;
        patch =
          end > now
            ? { status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: end }
            : { status: "canceled", cancelAtPeriodEnd: false, currentPeriodEnd: end };
        break;
      }
      case "subscription_ended":
        if (cur?.status === "comped") break;
        patch = { status: "canceled", currentPeriodEnd: cur?.currentPeriodEnd ?? now };
        break;
    }
    if (!patch) return cur?.status ?? "trialing";
    const [row] = await tx
      .insert(schema.subscriptions)
      .values({ ...base, ...patch })
      .onConflictDoUpdate({
        target: schema.subscriptions.orgId,
        set: { ...base, ...patch, updatedAt: now },
      })
      .returning({ status: schema.subscriptions.status });
    return row?.status ?? "trialing";
  });
  return { handled: true, orgId: org, status };
}

// ---- Free access (admin grants and invite codes) ---------------------------------------------------

export async function grantComp(
  db: Db,
  i: { orgId: string; planId: string; months: number | null; reason: string },
  now = new Date(),
) {
  const until = i.months === null ? null : new Date(now.getTime() + i.months * 30 * 86_400_000);
  await withOrg(db, i.orgId, (tx) =>
    tx
      .insert(schema.subscriptions)
      .values({
        orgId: i.orgId,
        status: "comped",
        planId: i.planId,
        compUntil: until,
        compReason: i.reason,
        currentPeriodStart: now,
        currentPeriodEnd: until,
      })
      .onConflictDoUpdate({
        target: schema.subscriptions.orgId,
        set: {
          status: "comped",
          planId: i.planId,
          compUntil: until,
          compReason: i.reason,
          currentPeriodStart: now,
          currentPeriodEnd: until,
          cancelAtPeriodEnd: false,
          pastDueSince: null,
          updatedAt: now,
        },
      }),
  );
  return until;
}

export async function revokeComp(db: Db, orgId: string, now = new Date()) {
  await withOrg(db, orgId, (tx) =>
    tx
      .update(schema.subscriptions)
      .set({ status: "canceled", compUntil: null, currentPeriodEnd: now, updatedAt: now })
      .where(and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, "comped"))),
  );
}

export const hashInviteCode = (code: string) =>
  createHash("sha256").update(code.trim()).digest("hex");

/** A random 24-character code (shown once; only its hash is stored). */
export const newInviteCode = () => randomBytes(18).toString("base64url");

export type RedeemResult =
  | { ok: true; planName: string; until: Date }
  | { ok: false; reason: "invalid" | "expired" | "used" | "wrong_email" };

/** Single-use, tied to one email address and expiring. The error never says which part was wrong in detail. */
export async function redeemInviteCode(
  db: Db,
  i: { code: string; email: string; orgId: string },
  now = new Date(),
): Promise<RedeemResult> {
  const [row] = await db
    .select()
    .from(schema.inviteCodes)
    .where(eq(schema.inviteCodes.codeHash, hashInviteCode(i.code)));
  if (!row) return { ok: false, reason: "invalid" };
  if (row.email.toLowerCase() !== i.email.toLowerCase())
    return { ok: false, reason: "wrong_email" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt < now) return { ok: false, reason: "expired" };
  // Claim it first: two simultaneous redemptions cannot both win.
  const claimed = await db
    .update(schema.inviteCodes)
    .set({ usedAt: now, usedByOrg: i.orgId })
    .where(and(eq(schema.inviteCodes.id, row.id), sql`${schema.inviteCodes.usedAt} is null`))
    .returning({ id: schema.inviteCodes.id });
  if (claimed.length === 0) return { ok: false, reason: "used" };
  const until = (await grantComp(
    db,
    { orgId: i.orgId, planId: row.planId, months: row.months, reason: "invite code" },
    now,
  )) as Date;
  const [plan] = await db.select().from(schema.plans).where(eq(schema.plans.id, row.planId));
  return { ok: true, planName: plan?.name ?? "plan", until };
}

// ---- What the billing page shows -----------------------------------------------------------------

export interface BillingSummary {
  status: Subscription["status"] | "none";
  planName: string | null;
  planSlug: string | null;
  interval: "monthly" | "yearly" | null;
  trialDaysLeft: number | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  compUntil: Date | null;
  used: number;
  limit: number | null;
  percent: number | null;
  /** Why new conversations are waiting, if they are. */
  blocked: { reason: string; message: string } | null;
  hasPortal: boolean;
}

export async function billingSummary(
  db: Db,
  orgId: string,
  hasOwnKey: boolean,
  now = new Date(),
): Promise<BillingSummary> {
  const { subscription: s, plan } = await getSubscription(db, orgId);
  const probe = await checkEntitlement(db, {
    orgId,
    threadId: "00000000-0000-0000-0000-000000000000",
    hasOwnKey,
    now,
  });
  const d = probe.decision;
  const limit = d.limit;
  return {
    status: s?.status ?? "none",
    planName: plan?.name ?? null,
    planSlug: plan?.slug ?? null,
    interval: s?.interval ?? null,
    trialDaysLeft:
      s?.status === "trialing" && s.trialEndsAt
        ? Math.max(0, Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / 86_400_000))
        : null,
    periodEnd: s?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: s?.cancelAtPeriodEnd ?? false,
    compUntil: s?.compUntil ?? null,
    used: d.used,
    limit,
    percent: limit ? Math.min(100, Math.round((d.used / limit) * 100)) : null,
    blocked: d.allowed ? null : { reason: d.reason, message: d.message },
    hasPortal: !!s?.providerCustomerId,
  };
}

// ---- Connected inboxes ------------------------------------------------------------------------

/** Trials include one connected inbox; paid plans follow `plans.inbox_limit` (null = unlimited). */
export async function checkInboxLimit(
  db: Db,
  orgId: string,
): Promise<{ ok: true } | { ok: false; limit: number; message: string }> {
  const { subscription, plan } = await getSubscription(db, orgId);
  const limit = subscription?.status === "trialing" || !plan ? 1 : plan.inboxLimit;
  if (limit === null) return { ok: true };
  const [row] = await withOrg(db, orgId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.connections)
      .where(
        and(eq(schema.connections.provider, "crisp"), eq(schema.connections.status, "active")),
      ),
  );
  if ((row?.n ?? 0) < limit) return { ok: true };
  return {
    ok: false,
    limit,
    message: `Your plan includes ${limit} connected ${limit === 1 ? "inbox" : "inboxes"}. Upgrade to connect another.`,
  };
}

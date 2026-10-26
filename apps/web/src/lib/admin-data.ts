import "server-only";
import { billingSummary } from "@triagefox/billing";
import { desc, eq, ilike, schema, sql } from "@triagefox/db";
import { db } from "./db";

/** Workspaces (newest first, 25 at a time) with owner, plan and usage. */
export async function listWorkspaces(q?: string | null) {
  const term = q?.trim();
  const orgs = await db()
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .where(term ? ilike(schema.organization.name, `%${term.replace(/[%_]/g, "")}%`) : undefined)
    .orderBy(desc(schema.organization.createdAt))
    .limit(25);
  const rows = [];
  for (const o of orgs) {
    const [owner] = await db()
      .select({ email: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, o.id))
      .limit(1);
    rows.push({
      ...o,
      ownerEmail: owner?.email ?? null,
      summary: await billingSummary(db(), o.id, false),
    });
  }
  return rows;
}

/** Platform AI spend this month (all, and trials) and the workspaces that cost the most. */
export async function usageReport() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const [totals] = await db().execute<{ total: string; trial: string }>(
    sql`select platform_ai_micro_usd(${from}::date)::text as total, platform_trial_ai_micro_usd(${from}::date)::text as trial`,
  );
  const top = await db().execute<{
    org_id: string;
    conversations: number;
    ai_cost_micro_usd: string;
    trial_cost_micro_usd: string;
  }>(sql`select * from admin_top_usage(${from}::date, 20)`);
  const out = [];
  for (const t of top) {
    const [o] = await db()
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, t.org_id));
    out.push({
      orgId: t.org_id,
      name: o?.name ?? t.org_id,
      conversations: t.conversations,
      costUsd: Number(t.ai_cost_micro_usd) / 1e6,
      trialCostUsd: Number(t.trial_cost_micro_usd) / 1e6,
    });
  }
  return {
    month: from,
    totalUsd: Number(totals?.total ?? 0) / 1e6,
    trialUsd: Number(totals?.trial ?? 0) / 1e6,
    top: out,
  };
}

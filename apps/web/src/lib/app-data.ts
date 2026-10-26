import "server-only";
import { and, desc, eq, inArray, lt, schema, sql, withOrg } from "@triagefox/db";
import { db } from "./db";

export const ACTIVITY_FILTERS = {
  created: { label: "Created", kinds: ["ticket_created", "regression"] },
  updated: { label: "Updated", kinds: ["ticket_updated"] },
  skipped: { label: "Skipped", kinds: ["ai_no_action"] },
  duplicate: { label: "Duplicate", kinds: ["ai_duplicate_of"] },
  error: {
    label: "Problems",
    kinds: [
      "delivery_failed",
      "update_failed",
      "update_skipped",
      "extras_failed",
      "ai_key_problem",
      "ai_limit",
      "ai_unavailable",
      "no_destination",
    ],
  },
} as const;
export type ActivityFilter = keyof typeof ACTIVITY_FILTERS;

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** Counts for the overview. Everything comes from the activity log, so it matches what the user sees there. */
export async function monthStats(orgId: string) {
  const rows = await withOrg(db(), orgId, (tx) =>
    tx
      .select({ kind: schema.activityLog.kind, n: sql<number>`count(*)::int` })
      .from(schema.activityLog)
      .where(sql`${schema.activityLog.createdAt} >= ${monthStart()}`)
      .groupBy(schema.activityLog.kind),
  );
  const count = (kinds: readonly string[]) =>
    rows.filter((r) => kinds.includes(r.kind)).reduce((a, r) => a + r.n, 0);
  const created = count(ACTIVITY_FILTERS.created.kinds);
  const updated = count(ACTIVITY_FILTERS.updated.kinds);
  return {
    created,
    updated,
    skipped: count(ACTIVITY_FILTERS.skipped.kinds),
    duplicates: count(ACTIVITY_FILTERS.duplicate.kinds),
    problems: count(ACTIVITY_FILTERS.error.kinds),
    // A rough, honest estimate: about 10 minutes to read a chat and write a ticket, 3 to follow up.
    minutesSaved: created * 10 + updated * 3,
  };
}

export interface ActivityRow {
  id: string;
  kind: string;
  message: string;
  createdAt: Date;
  aiRunId: string | null;
  ticketUrl: string | null;
  conversationUrl: string | null;
}

export async function listActivity(
  orgId: string,
  opts: { filter?: ActivityFilter; before?: Date; limit?: number } = {},
): Promise<ActivityRow[]> {
  const kinds = opts.filter ? ACTIVITY_FILTERS[opts.filter].kinds : null;
  const rows = await withOrg(db(), orgId, (tx) =>
    tx
      .select({
        id: schema.activityLog.id,
        kind: schema.activityLog.kind,
        message: schema.activityLog.message,
        createdAt: schema.activityLog.createdAt,
        refs: schema.activityLog.refs,
        sessionId: schema.threads.sourceId,
        websiteId: sql<string | null>`${schema.connections.metadata} ->> 'websiteId'`,
      })
      .from(schema.activityLog)
      .leftJoin(schema.threads, eq(schema.threads.id, schema.activityLog.threadId))
      .leftJoin(schema.automations, eq(schema.automations.id, schema.threads.automationId))
      .leftJoin(
        schema.connections,
        eq(schema.connections.id, schema.automations.sourceConnectionId),
      )
      .where(
        and(
          kinds ? inArray(schema.activityLog.kind, [...kinds]) : undefined,
          opts.before ? lt(schema.activityLog.createdAt, opts.before) : undefined,
        ),
      )
      .orderBy(desc(schema.activityLog.createdAt))
      .limit(opts.limit ?? 30),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    createdAt: r.createdAt,
    aiRunId: typeof r.refs.aiRunId === "string" ? r.refs.aiRunId : null,
    ticketUrl: typeof r.refs.url === "string" ? r.refs.url : null,
    conversationUrl:
      r.websiteId && r.sessionId
        ? `https://app.crisp.chat/website/${r.websiteId}/inbox/${r.sessionId}/`
        : null,
  }));
}

export async function reviewQueue(orgId: string) {
  return withOrg(db(), orgId, (tx) =>
    tx
      .select({
        id: schema.issues.id,
        title: schema.issues.title,
        summary: schema.issues.summary,
        type: schema.issues.type,
        priority: schema.issues.priority,
        confidence: schema.issues.confidence,
        dueDate: schema.issues.dueDate,
        createdAt: schema.issues.createdAt,
      })
      .from(schema.issues)
      .where(eq(schema.issues.status, "pending_review"))
      .orderBy(desc(schema.issues.createdAt)),
  );
}

export async function reviewCount(orgId: string) {
  const [row] = await withOrg(db(), orgId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.issues)
      .where(eq(schema.issues.status, "pending_review")),
  );
  return row?.n ?? 0;
}

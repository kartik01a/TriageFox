import "server-only";
import { and, desc, destinationConfigFromDefaults, eq, schema, sql, withOrg } from "@triagefox/db";
import { db } from "./db";

type Automation = typeof schema.automations.$inferSelect;

/** One automation per Crisp connection; the app shows the first one. */
export async function getAutomation(orgId: string): Promise<Automation | null> {
  const [row] = await withOrg(db(), orgId, (tx) =>
    tx.select().from(schema.automations).orderBy(schema.automations.createdAt).limit(1),
  );
  return row ?? null;
}

/** Creates the (paused) automation on the workspace's active Crisp connection if there is none yet. */
export async function ensureAutomation(orgId: string): Promise<Automation | null> {
  const existing = await getAutomation(orgId);
  if (existing) return existing;
  return withOrg(db(), orgId, async (tx) => {
    const [crisp] = await tx
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.provider, "crisp"), eq(schema.connections.status, "active")))
      .limit(1);
    if (!crisp) return null;
    const [row] = await tx
      .insert(schema.automations)
      .values({ orgId, sourceConnectionId: crisp.id, name: "Crisp to tickets", enabled: false })
      .returning();
    return row ?? null;
  });
}

/**
 * Makes the automation's destinations match the workspace's connected tools: one per active Trello/Jira
 * connection with a chosen target. An existing destination keeps its remembered label ids and enabled flag.
 */
export async function syncDestinations(orgId: string, automationId: string) {
  await withOrg(db(), orgId, async (tx) => {
    const conns = await tx
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.status, "active"));
    const existing = await tx
      .select()
      .from(schema.automationDestinations)
      .where(eq(schema.automationDestinations.automationId, automationId));
    for (const c of conns) {
      if (c.provider === "crisp") continue;
      const fresh = destinationConfigFromDefaults(c);
      if (!fresh) continue;
      const have = existing.find((d) => d.connectionId === c.id);
      if (!have) {
        await tx
          .insert(schema.automationDestinations)
          .values({ orgId, automationId, connectionId: c.id, config: fresh });
      } else if (JSON.stringify(stripCache(have.config)) !== JSON.stringify(fresh)) {
        // The target changed: take the new one and forget label ids that belonged to the old board.
        await tx
          .update(schema.automationDestinations)
          .set({ config: fresh })
          .where(eq(schema.automationDestinations.id, have.id));
      }
    }
  });
}

function stripCache(config: typeof schema.automationDestinations.$inferSelect.config) {
  if (config.kind !== "trello") return config;
  const { labelIds: _ignored, ...rest } = config;
  return rest;
}

export interface DestinationView {
  id: string;
  enabled: boolean;
  provider: "trello" | "jira" | "linear";
  connectionStatus: string;
  target: string;
  ok: number;
  failed: number;
}

export async function automationOverview(orgId: string) {
  const automation = await getAutomation(orgId);
  if (!automation) return null;
  return withOrg(db(), orgId, async (tx) => {
    const [source] = await tx
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, automation.sourceConnectionId));
    const dests = await tx
      .select({
        id: schema.automationDestinations.id,
        enabled: schema.automationDestinations.enabled,
        config: schema.automationDestinations.config,
        connectionStatus: schema.connections.status,
        metadata: schema.connections.metadata,
      })
      .from(schema.automationDestinations)
      .innerJoin(
        schema.connections,
        eq(schema.connections.id, schema.automationDestinations.connectionId),
      )
      .where(eq(schema.automationDestinations.automationId, automation.id));
    const counts = await tx
      .select({
        destinationId: schema.destinationTickets.destinationId,
        status: schema.destinationTickets.status,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.destinationTickets)
      .groupBy(schema.destinationTickets.destinationId, schema.destinationTickets.status);
    const failedTickets = await tx
      .select({
        id: schema.destinationTickets.id,
        issueId: schema.destinationTickets.issueId,
        destinationId: schema.destinationTickets.destinationId,
        title: schema.issues.title,
        error: schema.destinationTickets.lastError,
      })
      .from(schema.destinationTickets)
      .innerJoin(schema.issues, eq(schema.issues.id, schema.destinationTickets.issueId))
      .where(eq(schema.destinationTickets.status, "failed"))
      .orderBy(desc(schema.destinationTickets.createdAt))
      .limit(20);

    const destinations: DestinationView[] = dests.map((d) => {
      const m = d.metadata as { defaults?: Record<string, string> };
      return {
        id: d.id,
        enabled: d.enabled,
        provider: d.config.kind,
        connectionStatus: d.connectionStatus,
        target:
          d.config.kind === "trello"
            ? `${m.defaults?.boardName ?? "Board"} › ${m.defaults?.listName ?? "List"}`
            : d.config.kind === "jira"
              ? `Project ${m.defaults?.projectName ?? d.config.projectKey} (${d.config.projectKey})`
              : `Team ${m.defaults?.teamName ?? "Linear"}${m.defaults?.projectName ? ` › ${m.defaults.projectName}` : ""}`,
        ok: counts.find((c) => c.destinationId === d.id && c.status === "ok")?.n ?? 0,
        failed: counts.find((c) => c.destinationId === d.id && c.status === "failed")?.n ?? 0,
      };
    });
    return { automation, source: source ?? null, destinations, failedTickets };
  });
}

/** Why the automation cannot be switched on yet, or null when it can. */
export async function enableBlocker(orgId: string, automationId: string): Promise<string | null> {
  return withOrg(db(), orgId, async (tx) => {
    const [a] = await tx
      .select()
      .from(schema.automations)
      .where(eq(schema.automations.id, automationId));
    if (!a) return "Automation not found.";
    const [source] = await tx
      .select({ status: schema.connections.status })
      .from(schema.connections)
      .where(eq(schema.connections.id, a.sourceConnectionId));
    if (source?.status !== "active") return "Crisp isn't connected. Reconnect it first.";
    const dests = await tx
      .select({ status: schema.connections.status })
      .from(schema.automationDestinations)
      .innerJoin(
        schema.connections,
        eq(schema.connections.id, schema.automationDestinations.connectionId),
      )
      .where(
        and(
          eq(schema.automationDestinations.automationId, automationId),
          eq(schema.automationDestinations.enabled, true),
        ),
      );
    if (dests.length === 0)
      return "Connect Trello, Jira or Linear and choose where tickets should go first.";
    if (!dests.some((d) => d.status === "active"))
      return "Your Trello, Jira or Linear connection needs to be reconnected first.";
    return null;
  });
}

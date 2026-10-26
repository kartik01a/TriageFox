/**
 * Dev helper until the Phase 7 setup wizard exists: for a workspace, make sure there is one enabled
 * automation on its Crisp connection and one destination per connected Trello/Jira target
 * (copied from each connection's chosen defaults). Idempotent. Usage:
 *   pnpm db:dev-automation <orgId>      (omit the id to list workspaces that have a Crisp connection)
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { automationDestinations, automations, connections } from "./schema/index";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error("DATABASE_MIGRATION_URL is not set.");
  process.exit(1);
}
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);
const orgId = process.argv[2];

const crispAll = await db.select().from(connections).where(eq(connections.provider, "crisp"));
if (!orgId) {
  console.log("Workspaces with a Crisp connection:");
  for (const c of crispAll)
    console.log(`  ${c.orgId}  (${c.status})  ${c.metadata.websiteName ?? ""}`);
  await client.end();
  process.exit(0);
}

const crisp = crispAll.find((c) => c.orgId === orgId && c.status === "active");
if (!crisp) {
  console.error("No active Crisp connection in that workspace.");
  await client.end();
  process.exit(1);
}

let [automation] = await db
  .select()
  .from(automations)
  .where(eq(automations.sourceConnectionId, crisp.id));
if (!automation) {
  [automation] = await db
    .insert(automations)
    .values({ orgId, sourceConnectionId: crisp.id, name: "Crisp to tickets", enabled: true })
    .returning();
  console.log("created automation");
} else if (!automation.enabled) {
  await db.update(automations).set({ enabled: true }).where(eq(automations.id, automation.id));
  console.log("enabled automation");
}
if (!automation) throw new Error("automation missing");

const targets = await db
  .select()
  .from(connections)
  .where(and(eq(connections.orgId, orgId), eq(connections.status, "active")));
for (const c of targets) {
  const d = c.metadata.defaults as Record<string, unknown> | undefined;
  let config: (typeof automationDestinations.$inferInsert)["config"] | null = null;
  if (c.provider === "trello" && d?.boardId && d?.listId)
    config = { kind: "trello", boardId: String(d.boardId), listId: String(d.listId) };
  if (c.provider === "jira" && d?.projectKey && d?.setupOk)
    config = {
      kind: "jira",
      cloudId: String(d.cloudId),
      projectKey: String(d.projectKey),
      issueTypeMap: d.issueTypeMap as Record<string, string>,
      priorityMap: d.priorityMap as Record<string, string>,
    };
  if (!config) continue;
  await db
    .insert(automationDestinations)
    .values({ orgId, automationId: automation.id, connectionId: c.id, config })
    .onConflictDoUpdate({
      target: [automationDestinations.automationId, automationDestinations.connectionId],
      set: { config },
    });
  console.log(`destination ready: ${c.provider}`);
}
await client.end();

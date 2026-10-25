import { type Db, sql } from "@triagefox/db";

export interface CrispRoute {
  orgId: string;
  connectionId: string;
  automationId: string;
  quietWindowSec: number;
}

export interface ReconcileTarget extends CrispRoute {
  websiteId: string;
}

/**
 * Which workspace and automations does a Crisp website belong to? A hook only knows the website id and
 * the runtime role cannot read across workspaces, so this goes through narrow database functions that
 * return identifiers only (migration 0005).
 */
export async function findCrispRoutes(db: Db, websiteId: string): Promise<CrispRoute[]> {
  const rows = await db.execute<{
    org_id: string;
    connection_id: string;
    automation_id: string;
    quiet_window_sec: number;
  }>(
    sql`select org_id, connection_id, automation_id, quiet_window_sec from crisp_routes(${websiteId})`,
  );
  return rows.map((r) => ({
    orgId: r.org_id,
    connectionId: r.connection_id,
    automationId: r.automation_id,
    quietWindowSec: Number(r.quiet_window_sec),
  }));
}

export async function listReconcileTargets(db: Db): Promise<ReconcileTarget[]> {
  const rows = await db.execute<{
    org_id: string;
    connection_id: string;
    website_id: string;
    automation_id: string;
    quiet_window_sec: number;
  }>(
    sql`select org_id, connection_id, website_id, automation_id, quiet_window_sec from crisp_reconcile_targets()`,
  );
  return rows.map((r) => ({
    orgId: r.org_id,
    connectionId: r.connection_id,
    websiteId: r.website_id,
    automationId: r.automation_id,
    quietWindowSec: Number(r.quiet_window_sec),
  }));
}

export async function purgeOldSourceEvents(db: Db, days: number): Promise<number> {
  const rows = await db.execute<{ count: string }>(
    sql`select purge_old_source_events(${days}) as count`,
  );
  return Number(rows[0]?.count ?? 0);
}

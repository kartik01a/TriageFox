import { type Db, sql } from "@triagefox/db";
import { RpcError } from "@triagefox/rpc";
import { type Ctx, loadConnection } from "./rpc/context";
import { jiraAccessToken, linearAccessToken } from "./rpc/handlers";

/** Refresh tokens older than this. Atlassian drops refresh tokens unused for 90 days; Linear's expire 30 days after issue. */
export const KEEPALIVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Active OAuth connections whose refresh tokens expire when unused (ids only, across workspaces). */
export async function keepAliveTargets(db: Db) {
  return db.execute<{ org_id: string; connection_id: string; provider: string }>(
    sql`select org_id, connection_id, provider from oauth_keepalive_targets()`,
  );
}

/**
 * Daily: refresh the tokens of connections that have not been used for a week, so a quiet workspace does
 * not lose its Jira connection. A refusal turns the connection `revoked` and emails the owners, exactly as
 * a refusal during a delivery would; any other failure is retried the next day.
 */
export async function keepConnectionsAlive(ctx: Ctx, opts: { maxAgeMs?: number } = {}) {
  const maxAgeMs = opts.maxAgeMs ?? KEEPALIVE_MAX_AGE_MS;
  let checked = 0;
  let failed = 0;
  for (const t of await keepAliveTargets(ctx.db)) {
    if (t.provider !== "jira" && t.provider !== "linear") continue;
    checked++;
    try {
      const c = await loadConnection(ctx, t.org_id, t.connection_id, t.provider);
      if (c.status !== "active") continue;
      if (t.provider === "jira") await jiraAccessToken(ctx, c, { maxAgeMs });
      else await linearAccessToken(ctx, c, { maxAgeMs });
    } catch (err) {
      failed++;
      const code = err instanceof RpcError ? err.code : "internal";
      ctx.log.warn(
        { connectionId: t.connection_id, provider: t.provider, code },
        "connection keep-alive failed",
      );
    }
  }
  return { checked, failed };
}

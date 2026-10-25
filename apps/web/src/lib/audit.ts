import "server-only";
import { schema, withOrg } from "@triagefox/db";
import { db } from "./db";
import { logger } from "./logger";

/**
 * Writes a workspace audit entry (docs/security.md §11). Goes through withOrg so row-level security
 * applies. Failures are logged but never block the user action. Metadata must contain IDs only:
 * no secrets, no chat content.
 */
export async function recordAudit(entry: {
  orgId: string;
  actorUserId?: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await withOrg(db(), entry.orgId, (tx) =>
      tx.insert(schema.auditLog).values({
        orgId: entry.orgId,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        target: entry.target ?? null,
        metadata: entry.metadata ?? {},
        ip: entry.ip ?? null,
      }),
    );
  } catch (err) {
    logger.error({ err: (err as Error).message, action: entry.action }, "audit write failed");
  }
}

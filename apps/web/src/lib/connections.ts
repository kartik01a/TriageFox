import "server-only";
import { randomUUID } from "node:crypto";
import { sealSecret } from "@triagefox/crypto";
import { and, desc, eq, schema, withOrg } from "@triagefox/db";
import { recordAudit } from "./audit";
import { db } from "./db";
import { publicKeyring } from "./keyring";

export type ConnectionRow = typeof schema.connections.$inferSelect;

/** Safe-to-render view: never includes credentials. */
export interface ConnectionView {
  id: string;
  provider: ConnectionRow["provider"];
  status: ConnectionRow["status"];
  statusDetail: string | null;
  metadata: Record<string, unknown>;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

export async function listConnections(orgId: string): Promise<ConnectionView[]> {
  const rows = await withOrg(db(), orgId, (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.orgId, orgId))
      .orderBy(desc(schema.connections.createdAt)),
  );
  return rows
    .filter((r) => r.status !== "pending")
    .map((r) => ({
      id: r.id,
      provider: r.provider,
      status: r.status,
      statusDetail: r.statusDetail,
      metadata: r.metadata,
      lastVerifiedAt: r.lastVerifiedAt,
      createdAt: r.createdAt,
    }));
}

export async function getConnectionView(orgId: string, id: string) {
  return (await listConnections(orgId)).find((c) => c.id === id) ?? null;
}

/**
 * Stores a new connection with its credentials sealed under the worker's public key. The row starts
 * as `pending`; the worker verifies it (and activates or deletes it). The web app cannot read the
 * credentials back after this call.
 */
export async function createPendingConnection(input: {
  orgId: string;
  userId: string;
  provider: ConnectionRow["provider"];
  authType: string;
  credentials: unknown;
  metadata?: Record<string, unknown>;
}) {
  const id = randomUUID();
  const sealed = await sealSecret(
    JSON.stringify(input.credentials),
    { orgId: input.orgId, recordId: id, purpose: "connection.credentials" },
    publicKeyring(),
  );
  await withOrg(db(), input.orgId, (tx) =>
    tx.insert(schema.connections).values({
      id,
      orgId: input.orgId,
      provider: input.provider,
      authType: input.authType,
      credentialsSealed: sealed,
      metadata: input.metadata ?? {},
      status: "pending",
      createdBy: input.userId,
    }),
  );
  return id;
}

export async function deletePendingConnection(orgId: string, id: string) {
  await withOrg(db(), orgId, (tx) =>
    tx
      .delete(schema.connections)
      .where(
        and(
          eq(schema.connections.id, id),
          eq(schema.connections.orgId, orgId),
          eq(schema.connections.status, "pending"),
        ),
      ),
  );
}

export const audit = recordAudit;

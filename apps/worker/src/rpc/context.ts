import { type FetchLike, ProviderError } from "@triagefox/connectors";
import { openSecret, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { and, type Db, eq, schema, withOrg } from "@triagefox/db";
import { RpcError } from "@triagefox/rpc";
import type { Redis } from "ioredis";
import type { loadConfig } from "../config";

type Connection = typeof schema.connections.$inferSelect;

export interface Ctx {
  db: Db;
  config: ReturnType<typeof loadConfig>;
  keyring: PrivateKeyring;
  redis: Redis;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: FetchLike;
  log: {
    info(o: object, m: string): void;
    warn(o: object, m: string): void;
    error(o: object, m: string): void;
  };
}

const PURPOSE = "connection.credentials";

/** Loads a connection inside its workspace: another workspace's id simply isn't found. */
export async function loadConnection(
  ctx: Ctx,
  orgId: string,
  connectionId: string,
  provider: Connection["provider"],
): Promise<Connection> {
  const [row] = await withOrg(ctx.db, orgId, (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(and(eq(schema.connections.id, connectionId), eq(schema.connections.orgId, orgId))),
  );
  if (!row || row.provider !== provider) throw new RpcError("not_found", "Connection not found.");
  return row;
}

export async function openCredentials<T>(ctx: Ctx, c: Connection): Promise<T> {
  if (!c.credentialsSealed)
    throw new RpcError("invalid", "This connection has no stored credentials.");
  const json = await openSecret(
    c.credentialsSealed,
    { orgId: c.orgId, recordId: c.id, purpose: PURPOSE },
    ctx.keyring,
  );
  return JSON.parse(json) as T;
}

export async function sealCredentials(
  ctx: Ctx,
  c: Pick<Connection, "orgId" | "id">,
  value: unknown,
) {
  return sealSecret(
    JSON.stringify(value),
    { orgId: c.orgId, recordId: c.id, purpose: PURPOSE },
    ctx.keyring,
  );
}

export async function updateConnection(
  ctx: Ctx,
  c: Pick<Connection, "orgId" | "id">,
  patch: Partial<typeof schema.connections.$inferInsert>,
) {
  await withOrg(ctx.db, c.orgId, (tx) =>
    tx
      .update(schema.connections)
      .set(patch)
      .where(and(eq(schema.connections.id, c.id), eq(schema.connections.orgId, c.orgId))),
  );
}

export async function deleteConnection(ctx: Ctx, c: Pick<Connection, "orgId" | "id">) {
  await withOrg(ctx.db, c.orgId, (tx) =>
    tx
      .delete(schema.connections)
      .where(and(eq(schema.connections.id, c.id), eq(schema.connections.orgId, c.orgId))),
  );
}

/**
 * Translates provider failures into RpcErrors with customer-safe wording, and records when the
 * provider no longer accepts our credentials so the dashboard can ask for a reconnect.
 */
export async function failWith(
  ctx: Ctx,
  c: Pick<Connection, "orgId" | "id" | "status"> | null,
  name: string,
  err: unknown,
): Promise<never> {
  if (err instanceof RpcError) throw err;
  if (err instanceof ProviderError) {
    if (err.kind === "auth") {
      if (c && c.status !== "pending") {
        await updateConnection(ctx, c, {
          status: "revoked",
          statusDetail: `${name} no longer accepts this connection. Please reconnect.`,
        });
      }
      throw new RpcError(
        "auth_expired",
        `${name} no longer accepts this connection. Please reconnect.`,
      );
    }
    if (err.kind === "rate_limited")
      throw new RpcError("rate_limited", `${name} is busy. Please try again in a minute.`);
    if (err.kind === "not_found")
      throw new RpcError("not_found", `${name} could not find that item.`);
    if (err.kind === "unavailable")
      throw new RpcError("unavailable", `${name} is not responding. Please try again shortly.`);
    throw new RpcError("invalid", `${name} rejected the request.`);
  }
  throw err;
}

/** Run `fn` while holding a Redis lock (serialises token refreshes for one connection). */
export async function withLock<T>(
  redis: Redis,
  key: string,
  fn: () => Promise<T>,
  waitMs = 15_000,
): Promise<T> {
  const token = Math.random().toString(36).slice(2);
  const deadline = Date.now() + waitMs;
  while (true) {
    const ok = await redis.set(`lock:${key}`, token, "PX", 20_000, "NX");
    if (ok) break;
    if (Date.now() > deadline)
      throw new RpcError("unavailable", "Another refresh is in progress. Please try again.");
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await fn();
  } finally {
    // Release only our own lock.
    await redis.eval(
      `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) end return 0`,
      1,
      `lock:${key}`,
      token,
    );
  }
}

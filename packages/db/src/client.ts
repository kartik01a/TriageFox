import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { $client: client });
}

export type Db = ReturnType<typeof createDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction scoped to one workspace.
 *
 * Sets `app.current_org` for the transaction, which Postgres row-level security policies compare
 * against. Every query on tenant tables must go through this (docs/security.md §6): outside it the
 * setting is empty and RLS returns no rows.
 */
export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error("withOrg requires an orgId");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
    return fn(tx);
  });
}

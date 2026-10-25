import "server-only";
import { createDb, type Db } from "@triagefox/db";
import { env } from "./env";

// Reuse one pool across hot reloads in development.
const g = globalThis as unknown as { __triagefoxDb?: Db };

export function db(): Db {
  g.__triagefoxDb ??= createDb(env().DATABASE_URL, { max: 10 });
  return g.__triagefoxDb;
}

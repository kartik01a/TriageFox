// Test-only database access as the table owner (bypasses row-level security) for setup and cleanup.
import { createDb } from "@triagefox/db";

let db: ReturnType<typeof createDb> | undefined;

export function ownerDb() {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is required for e2e setup (see .env.example)");
  db ??= createDb(url, { max: 2 });
  return db;
}

export async function closeOwnerDb() {
  await db?.$client.end();
  db = undefined;
}

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { platformSettings } from "./schema/index";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error("DATABASE_MIGRATION_URL is not set.");
  process.exit(1);
}
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

// Idempotent: never overwrites values an admin has changed.
await db
  .insert(platformSettings)
  .values([{ key: "signupEnabled", value: true }])
  .onConflictDoNothing();

await client.end();
console.log("seed applied");

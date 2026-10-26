import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { plans, platformSettings } from "./schema/index";

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

// Launch plans. The prices live in a private, git-ignored file (docs/private/plans.seed.json), so pricing
// strategy never lands in the repository. Without the file no plans are seeded: create them in /admin/plans.
// Seeded plans start hidden; an admin adds the payment provider's product ids and publishes them.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const file = process.env.PLANS_SEED_FILE ?? join(root, "docs", "private", "plans.seed.json");
const planSeed = z.array(
  z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    prices: z.record(z.string(), z.object({ monthly: z.number().int(), yearly: z.number().int() })),
    conversationLimit: z.number().int().nullable().default(null),
    fairUseCap: z.number().int().nullable().default(null),
    inboxLimit: z.number().int().nullable().default(null),
    byokRequired: z.boolean().default(false),
    supportLevel: z.string().default("email"),
    isPopular: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
  }),
);
if (existsSync(file)) {
  const rows = planSeed.parse(JSON.parse(readFileSync(file, "utf8")));
  await db
    .insert(plans)
    .values(rows.map((p) => ({ ...p, version: 1, isPublic: false, isActive: true })))
    .onConflictDoNothing();
  console.log(`plans seeded from ${file}`);
} else {
  console.log("no plan seed file found: create plans in /admin/plans");
}

await client.end();
console.log("seed applied");

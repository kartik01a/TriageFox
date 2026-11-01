/**
 * Creates the Dodo subscription products for the plans in docs/private/plans.seed.json and links their
 * ids to the plans in the database. Dry run by default.
 *
 *   pnpm db:dodo-products                 show what would be created (first 3 plans)
 *   pnpm db:dodo-products -- --apply      create them and link the ids
 *   ... -- --all                          include the own-key plans
 *   ... -- --apply --publish              also make plans public once they can be bought
 *
 * Reads DODO_API_KEY and DODO_ENV from .env. Refuses live mode unless --allow-live is given.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import {
  buildSpecs,
  CORE_PLANS,
  dodoBody,
  formatAmount,
  type ProductSpec,
} from "./dodo-products-plan";
import { plans } from "./schema/index";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const publish = args.has("--publish");
const mode = process.env.DODO_ENV === "live" ? "live" : "test";
const base = `https://${mode}.dodopayments.com`;
const apiKey = process.env.DODO_API_KEY;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (mode === "live" && !args.has("--allow-live"))
  fail("DODO_ENV=live. Live products are real: run test mode first, or add --allow-live.");
if (apply && !apiKey)
  fail("Set DODO_API_KEY in .env first (Dodo dashboard → Developer → API Keys).");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const file = process.env.PLANS_SEED_FILE ?? join(root, "docs", "private", "plans.seed.json");
if (!existsSync(file)) fail(`No plan file at ${file}.`);
const seed = z
  .array(
    z.object({
      slug: z.string(),
      name: z.string(),
      prices: z.record(
        z.string(),
        z.object({ monthly: z.number().int(), yearly: z.number().int() }),
      ),
    }),
  )
  .parse(JSON.parse(readFileSync(file, "utf8")));

const specs = buildSpecs(seed, args.has("--all") ? "all" : CORE_PLANS);

async function dodo(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    // Dodo's error text is safe to show; the key is never part of it.
    fail(
      `Dodo said ${res.status} for ${init?.method ?? "GET"} ${path}: ${(await res.text()).slice(0, 400)}`,
    );
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function existingByName() {
  const found = new Map<string, string>();
  for (let page = 0; page < 20; page++) {
    const r = (await dodo(`/products?page_size=100&page_number=${page}&recurring=true`)) as {
      items?: { product_id: string; name: string | null }[];
    };
    const items = r.items ?? [];
    for (const i of items) if (i.name) found.set(i.name, i.product_id);
    if (items.length < 100) break;
  }
  return found;
}

console.log(`Dodo ${mode} mode · ${specs.length} products · ${apply ? "APPLY" : "dry run"}\n`);
const existing = apiKey ? await existingByName() : new Map<string, string>();
if (!apiKey) console.log("(no DODO_API_KEY yet: cannot check what already exists)\n");

const ids = new Map<ProductSpec, string>();
for (const spec of specs) {
  const line = `${spec.name.padEnd(42)} ${formatAmount(spec.currency, spec.amount)}`;
  const have = existing.get(spec.name);
  if (have) {
    ids.set(spec, have);
    console.log(`  exists  ${line}  ${have}`);
  } else if (!apply) {
    console.log(`  create  ${line}`);
  } else {
    const made = (await dodo("/products", {
      method: "POST",
      body: JSON.stringify(dodoBody(spec)),
    })) as {
      product_id?: string;
    };
    if (!made.product_id) fail(`Dodo did not return a product id for ${spec.name}.`);
    ids.set(spec, made.product_id);
    console.log(`  created ${line}  ${made.product_id}`);
  }
}

if (!apply) {
  console.log("\nNothing was created. Run again with --apply to create the products above.");
  process.exit(0);
}

// Keep a private copy of the ids (git-ignored folder).
const out = join(root, "docs", "private", `dodo-products.${mode}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(Object.fromEntries([...ids].map(([s, id]) => [s.name, id])), null, 2),
);
console.log(`\nIds saved to ${out}`);

// Link the ids to the newest version of each plan.
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) fail("DATABASE_MIGRATION_URL is not set, so the ids were not linked to the plans.");
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);
for (const slug of new Set(specs.map((s) => s.slug))) {
  const [latest] = await db
    .select()
    .from(plans)
    .where(eq(plans.slug, slug))
    .orderBy(desc(plans.version))
    .limit(1);
  if (!latest) {
    console.log(`  plan ${slug} is not in the database: run pnpm db:seed first`);
    continue;
  }
  const dodoIds = { ...(latest.providerPriceIds.dodo ?? {}) };
  for (const [spec, id] of ids) {
    if (spec.slug !== slug) continue;
    dodoIds[spec.currency] = { ...(dodoIds[spec.currency] ?? {}), [spec.interval]: id } as never;
  }
  const next = { ...latest.providerPriceIds, dodo: dodoIds };
  const buyable = Object.values(dodoIds).some((c) => c.monthly && c.yearly);
  await db
    .update(plans)
    .set({ providerPriceIds: next, ...(publish && buyable ? { isPublic: true } : {}) })
    .where(eq(plans.id, latest.id));
  console.log(
    `  linked ${slug} v${latest.version}${publish && buyable ? " and made it public" : ""}`,
  );
}
await client.end();
console.log("\nDone. Check /admin/plans and /pricing.");

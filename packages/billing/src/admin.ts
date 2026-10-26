import { type Db, desc, eq, schema } from "@triagefox/db";
import { z } from "zod";

const money = z.object({ monthly: z.number().int().min(0), yearly: z.number().int().min(0) });

export const planFields = z.object({
  name: z.string().trim().min(1).max(80),
  prices: z.record(z.string().regex(/^[A-Z]{3}$/), money),
  conversationLimit: z.number().int().min(1).nullable(),
  fairUseCap: z.number().int().min(1).nullable(),
  inboxLimit: z.number().int().min(1).nullable(),
  byokRequired: z.boolean(),
  supportLevel: z.enum(["email", "priority"]),
  providerPriceIds: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({ monthly: z.string().min(1).optional(), yearly: z.string().min(1).optional() }),
    ),
  ),
  isPublic: z.boolean(),
  isActive: z.boolean(),
  isPopular: z.boolean(),
  sortOrder: z.number().int(),
});

export const createPlanInput = planFields
  .partial()
  .required({ name: true, prices: true })
  .extend({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/) });

export const patchPlanInput = planFields.partial();

/** Changing any of these changes what a subscriber gets or pays, so it creates a new version. */
export const VERSIONED_FIELDS = [
  "prices",
  "conversationLimit",
  "fairUseCap",
  "inboxLimit",
  "byokRequired",
] as const;

type Plan = typeof schema.plans.$inferSelect;

/** At least one currency has product ids for both intervals: a customer can actually buy it. */
export function isPurchasable(plan: Pick<Plan, "providerPriceIds" | "prices">, provider = "dodo") {
  return Object.keys(plan.prices).some((currency) => {
    const ids = plan.providerPriceIds[provider]?.[currency];
    return !!ids?.monthly && !!ids?.yearly;
  });
}

export class PlanError extends Error {}

export async function createPlan(db: Db, input: z.infer<typeof createPlanInput>) {
  const draft = {
    slug: input.slug,
    version: 1,
    name: input.name,
    prices: input.prices,
    conversationLimit: input.conversationLimit ?? null,
    fairUseCap: input.fairUseCap ?? null,
    inboxLimit: input.inboxLimit ?? null,
    byokRequired: input.byokRequired ?? false,
    supportLevel: input.supportLevel ?? "email",
    providerPriceIds: input.providerPriceIds ?? {},
    isPublic: input.isPublic ?? false,
    isActive: input.isActive ?? true,
    isPopular: input.isPopular ?? false,
    sortOrder: input.sortOrder ?? 0,
  };
  if (draft.isPublic && !isPurchasable(draft))
    throw new PlanError("Add the payment provider's product ids before making a plan public.");
  const [row] = await db.insert(schema.plans).values(draft).returning();
  if (!row) throw new PlanError("The plan could not be created.");
  return row;
}

/** Edits the newest version of a plan; price or limit changes create a new version and leave subscribers on theirs. */
export async function updatePlan(db: Db, id: string, patch: z.infer<typeof patchPlanInput>) {
  const [target] = await db.select().from(schema.plans).where(eq(schema.plans.id, id));
  if (!target) throw new PlanError("Plan not found.");
  const [latest] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.slug, target.slug))
    .orderBy(desc(schema.plans.version))
    .limit(1);
  if (!latest || latest.id !== target.id)
    throw new PlanError("Only the newest version of a plan can be edited.");

  const merged = { ...latest, ...patch };
  if (merged.isPublic && !isPurchasable(merged))
    throw new PlanError("Add the payment provider's product ids before making a plan public.");

  const versioned = VERSIONED_FIELDS.some(
    (k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(latest[k]),
  );
  if (!versioned) {
    const [row] = await db
      .update(schema.plans)
      .set(patch)
      .where(eq(schema.plans.id, latest.id))
      .returning();
    return { plan: row as Plan, versioned: false };
  }
  const { id: _id, createdAt: _created, ...rest } = merged;
  // The old product ids belong to the OLD price: copying them would let people buy the new version at the
  // old price. The new version starts without ids (or with the ones given) and is offered once it has them.
  const providerPriceIds = patch.providerPriceIds ?? {};
  const next = { ...rest, providerPriceIds, version: latest.version + 1 };
  const [row] = await db
    .insert(schema.plans)
    .values({ ...next, isPublic: next.isPublic && isPurchasable(next) })
    .returning();
  return { plan: row as Plan, versioned: true };
}

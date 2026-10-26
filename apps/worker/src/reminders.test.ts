import { randomUUID } from "node:crypto";
import { createDb, type Db, eq, schema, withOrg } from "@triagefox/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Notifier } from "./notify";
import { sendBillingReminders } from "./reminders";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const day = 86_400_000;
const orgs: string[] = [];
const sent: { orgId: string; subject: string; body: string }[] = [];
const notifier: Notifier = {
  emailOwners: async (orgId, m) => void sent.push({ orgId, subject: m.subject, body: m.body }),
  alert: async () => {},
};
const mine = (o: string) => sent.filter((s) => s.orgId === o);

async function sub(over: Partial<typeof schema.subscriptions.$inferInsert>) {
  const orgId = `org_${randomUUID()}`;
  orgs.push(orgId);
  await owner.insert(schema.subscriptions).values({ orgId, status: "active", ...over });
  return orgId;
}

beforeAll(() => {
  sent.length = 0;
});
afterAll(async () => {
  for (const o of orgs) {
    await owner.delete(schema.subscriptions).where(eq(schema.subscriptions.orgId, o));
    await owner.delete(schema.activityLog).where(eq(schema.activityLog.orgId, o));
  }
  await db.$client.end();
  await owner.$client.end();
});

describe("renewal reminders", () => {
  it("reminds 3 days before a monthly and 7 before a yearly renewal, once, with a summary", async () => {
    const monthly = await sub({
      interval: "monthly",
      currentPeriodEnd: new Date(Date.now() + 2 * day),
    });
    const yearly = await sub({
      interval: "yearly",
      currentPeriodEnd: new Date(Date.now() + 6 * day),
    });
    const tooEarlyMonthly = await sub({
      interval: "monthly",
      currentPeriodEnd: new Date(Date.now() + 10 * day),
    });
    const cancelled = await sub({
      interval: "monthly",
      currentPeriodEnd: new Date(Date.now() + day),
      cancelAtPeriodEnd: true,
    });
    await withOrg(db, monthly, (tx) =>
      tx.insert(schema.activityLog).values([
        { orgId: monthly, kind: "ticket_created", message: "x" },
        { orgId: monthly, kind: "ticket_created", message: "x" },
        { orgId: monthly, kind: "ai_duplicate_of", message: "x" },
      ]),
    );

    await sendBillingReminders({ db, notifier });
    expect(mine(monthly)).toHaveLength(1);
    expect(mine(monthly)[0]?.body).toContain("created 2 tickets");
    expect(mine(monthly)[0]?.body).toContain("merged 1 duplicates");
    expect(mine(monthly)[0]?.body).toContain("non-refundable");
    expect(mine(yearly)).toHaveLength(1);
    expect(mine(tooEarlyMonthly)).toHaveLength(0);
    expect(mine(cancelled)).toHaveLength(0); // already cancelling: nothing to remind about

    await sendBillingReminders({ db, notifier }); // a second run the same day sends nothing more
    expect(mine(monthly)).toHaveLength(1);
    expect(mine(yearly)).toHaveLength(1);
  });

  it("warns once when a trial is about to end", async () => {
    const o = await sub({ status: "trialing", trialEndsAt: new Date(Date.now() + 2 * day) });
    const far = await sub({ status: "trialing", trialEndsAt: new Date(Date.now() + 9 * day) });
    await sendBillingReminders({ db, notifier });
    await sendBillingReminders({ db, notifier });
    expect(mine(o)).toHaveLength(1);
    expect(mine(o)[0]?.subject).toMatch(/trial ends in/);
    expect(mine(far)).toHaveLength(0);
  });
});

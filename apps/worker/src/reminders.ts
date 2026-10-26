import { getSettings } from "@triagefox/billing";
import { and, type Db, eq, gte, inArray, schema, sql, withOrg } from "@triagefox/db";
import type { Notifier } from "./notify";

/**
 * Daily: a renewal reminder before each renewal (3 days before monthly, 7 before yearly: admin settings),
 * and a notice when a trial is about to end. Each is sent once per period. The renewal email doubles as a
 * summary of what TriageFox did, which is also the honest answer to "what am I paying for?".
 */
export async function sendBillingReminders(deps: { db: Db; notifier: Notifier; now?: () => Date }) {
  const now = (deps.now ?? (() => new Date()))();
  const settings = await getSettings(deps.db);
  let renewals = 0;
  let trials = 0;

  const due = await deps.db.execute<{ org_id: string; period_end: string; plan_interval: string }>(
    sql`select org_id, period_end, plan_interval from billing_due_reminders(${settings.reminders.monthlyDays}, ${settings.reminders.yearlyDays})`,
  );
  for (const row of due) {
    const periodEnd = new Date(row.period_end);
    const since = new Date(periodEnd);
    if (row.plan_interval === "yearly") since.setUTCFullYear(since.getUTCFullYear() - 1);
    else since.setUTCMonth(since.getUTCMonth() - 1);
    const counts = await withOrg(deps.db, row.org_id, (tx) =>
      tx
        .select({ kind: schema.activityLog.kind, n: sql<number>`count(*)::int` })
        .from(schema.activityLog)
        .where(
          and(
            gte(schema.activityLog.createdAt, since),
            inArray(schema.activityLog.kind, [
              "ticket_created",
              "ticket_updated",
              "ai_duplicate_of",
            ]),
          ),
        )
        .groupBy(schema.activityLog.kind),
    );
    const n = (k: string) => counts.find((c) => c.kind === k)?.n ?? 0;
    const when = periodEnd.toLocaleDateString("en-US", { dateStyle: "long" });
    await deps.notifier.emailOwners(row.org_id, {
      subject: `Your TriageFox plan renews on ${when}`,
      heading: `Your plan renews on ${when}`,
      body: `Your TriageFox plan renews automatically on ${when}.\n\nSince the last renewal TriageFox created ${n("ticket_created")} tickets, updated ${n("ticket_updated")} and merged ${n("ai_duplicate_of")} duplicates for you.\n\nTo change or cancel, open the payment portal on the Billing page before then. Payments are non-refundable.`,
      cta: { label: "Open billing", path: "/app/billing" },
    });
    await withOrg(deps.db, row.org_id, (tx) =>
      tx
        .update(schema.subscriptions)
        .set({ reminderSentForPeriodEnd: periodEnd })
        .where(eq(schema.subscriptions.orgId, row.org_id)),
    );
    renewals++;
  }

  const ending = await deps.db.execute<{ org_id: string; trial_ends_at: string }>(
    sql`select org_id, trial_ends_at from billing_ending_trials(3)`,
  );
  for (const row of ending) {
    const endsAt = new Date(row.trial_ends_at);
    const [sub] = await withOrg(deps.db, row.org_id, (tx) =>
      tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.orgId, row.org_id)),
    );
    if (sub?.reminderSentForPeriodEnd?.getTime() === endsAt.getTime()) continue;
    const days = Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
    await deps.notifier.emailOwners(row.org_id, {
      subject: `Your TriageFox trial ends in ${days} ${days === 1 ? "day" : "days"}`,
      heading: `Your trial ends in ${days} ${days === 1 ? "day" : "days"}`,
      body: "To keep turning customer chats into tickets, choose a plan before the trial ends. No card is needed until then.",
      cta: { label: "Choose a plan", path: "/app/billing" },
    });
    await withOrg(deps.db, row.org_id, (tx) =>
      tx
        .update(schema.subscriptions)
        .set({ reminderSentForPeriodEnd: endsAt })
        .where(eq(schema.subscriptions.orgId, row.org_id)),
    );
    trials++;
  }
  return { renewals, trials };
}

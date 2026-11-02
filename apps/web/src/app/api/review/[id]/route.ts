import { refreshTicketFooter } from "@triagefox/connectors";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { scheduleDelivery } from "@triagefox/pipeline";
import { PRIORITIES, type Priority, TICKET_TYPES, type TicketType } from "@triagefox/shared";
import { z } from "zod";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";
import { pipelineQueue } from "@/lib/pipeline-queue";

const body = z.object({
  action: z.enum(["create", "dismiss"]),
  type: z.enum(TICKET_TYPES).optional(),
  priority: z
    .number()
    .int()
    .refine((n): n is Priority => (PRIORITIES as readonly number[]).includes(n))
    .optional(),
});

/** Review queue: approve (optionally fixing type/priority first) or dismiss a ticket the AI was unsure about. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  const input = body.safeParse(await req.json().catch(() => null));
  if (!id.success || !input.success) return json({ ok: false, error: "Bad request." }, 400);
  const orgId = guard.ctx.workspace.id;

  const result = await withOrg(db(), orgId, async (tx) => {
    // Only a ticket still waiting for review can be decided: a double click can't create twice.
    const [issue] = await tx
      .select()
      .from(schema.issues)
      .where(and(eq(schema.issues.id, id.data), eq(schema.issues.status, "pending_review")))
      .for("update");
    if (!issue) return null;
    const log = (kind: string, message: string) =>
      tx.insert(schema.activityLog).values({
        orgId,
        automationId: issue.automationId,
        threadId: issue.originThreadId,
        kind,
        message,
        refs: { issueId: issue.id },
      });

    if (input.data.action === "dismiss") {
      await tx
        .update(schema.issues)
        .set({ status: "dismissed" })
        .where(eq(schema.issues.id, issue.id));
      await log("review_dismissed", "A ticket was dismissed from the review queue.");
      return { deliveries: [] as string[] };
    }
    const type = (input.data.type ?? issue.type) as TicketType;
    const priority = (input.data.priority ?? issue.priority) as Priority;
    await tx
      .update(schema.issues)
      .set({
        status: "active",
        type,
        priority,
        bodyMd: refreshTicketFooter(issue.bodyMd, {
          priority,
          type,
          reportedBy: /^Reported by (.*)$/m.exec(issue.bodyMd)?.[1] ?? "1 customer",
        }),
      })
      .where(eq(schema.issues.id, issue.id));
    const destinations = await tx
      .select({ id: schema.automationDestinations.id })
      .from(schema.automationDestinations)
      .where(
        and(
          eq(schema.automationDestinations.automationId, issue.automationId),
          eq(schema.automationDestinations.enabled, true),
        ),
      );
    await log(
      destinations.length ? "review_approved" : "no_destination",
      destinations.length
        ? "A ticket was approved from the review queue."
        : "A ticket was approved but not sent: no Trello or Jira destination is set up or switched on.",
    );
    return { deliveries: destinations.map((d) => d.id), issueId: issue.id };
  });
  if (!result) return json({ ok: false, error: "That ticket was already handled." }, 409);

  for (const destinationId of result.deliveries)
    await scheduleDelivery(pipelineQueue().queue, {
      orgId,
      issueId: id.data,
      destinationId,
    });
  await audit({
    orgId,
    actorUserId: guard.ctx.session.user.id,
    action: input.data.action === "create" ? "review.approved" : "review.dismissed",
    target: id.data,
  });
  return json({ ok: true });
}

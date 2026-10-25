"use server";

import { and, eq, gt, isNull, schema, withOrg } from "@triagefox/db";
import { redirect } from "next/navigation";
import { audit } from "@/lib/connections";
import { hashTicket } from "@/lib/crisp-link";
import { db } from "@/lib/db";
import { resolveWorkspace } from "@/lib/workspace";

class LinkError extends Error {}

/** Consumes the one-time ticket and links the Crisp website to the active workspace. */
export async function confirmCrispLink(formData: FormData) {
  const ctx = await resolveWorkspace();
  if (!ctx) redirect("/login");
  if (!ctx.canManage) redirect("/app/connections?error=forbidden");
  const ticket = String(formData.get("ticket") ?? "");
  const orgId = ctx.workspace.id;

  let connectionId: string;
  try {
    connectionId = await withOrg(db(), orgId, async (tx) => {
      // Atomic: a ticket can be used once. If the insert below fails, this update rolls back too.
      const [t] = await tx
        .update(schema.crispLinkTickets)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(schema.crispLinkTickets.ticketHash, hashTicket(ticket)),
            isNull(schema.crispLinkTickets.usedAt),
            gt(schema.crispLinkTickets.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!t) throw new LinkError("expired");
      const [c] = await tx
        .insert(schema.connections)
        .values({
          orgId,
          provider: "crisp",
          authType: "plugin_install",
          status: "active",
          lastVerifiedAt: new Date(),
          createdBy: ctx.session.user.id,
          metadata: { websiteId: t.websiteId, websiteName: t.websiteName },
        })
        .returning({ id: schema.connections.id });
      if (!c) throw new LinkError("failed");
      return c.id;
    });
  } catch (err) {
    if (err instanceof LinkError) redirect("/app/connections?error=crisp_ticket");
    // 23505 = unique violation: this Crisp website is already linked to a workspace.
    if (
      (err as { code?: string }).code === "23505" ||
      (err as { cause?: { code?: string } }).cause?.code === "23505"
    )
      redirect("/app/connections?error=crisp_taken");
    throw err;
  }
  await audit({
    orgId,
    actorUserId: ctx.session.user.id,
    action: "connection.created",
    target: connectionId,
    metadata: { provider: "crisp" },
  });
  redirect(`/app/connections/${connectionId}?connected=crisp`);
}

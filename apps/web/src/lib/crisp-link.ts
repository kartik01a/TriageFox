import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, schema } from "@triagefox/db";
import { db } from "./db";

export const hashTicket = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

const TICKET_TTL_MS = 15 * 60 * 1000;

/** Creates a single-use ticket proving the page was opened from inside a verified Crisp website. */
export async function createLinkTicket(websiteId: string, websiteName?: string) {
  const ticket = randomBytes(32).toString("base64url");
  await db()
    .insert(schema.crispLinkTickets)
    .values({
      ticketHash: hashTicket(ticket),
      websiteId,
      websiteName: websiteName ?? null,
      expiresAt: new Date(Date.now() + TICKET_TTL_MS),
    });
  return ticket;
}

/** Looks a ticket up without consuming it (for the confirmation page). */
export async function peekLinkTicket(ticket: string) {
  const [row] = await db()
    .select()
    .from(schema.crispLinkTickets)
    .where(
      and(
        eq(schema.crispLinkTickets.ticketHash, hashTicket(ticket)),
        isNull(schema.crispLinkTickets.usedAt),
        gt(schema.crispLinkTickets.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

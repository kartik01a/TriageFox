import type { TriageAction } from "@triagefox/ai";
import { getSettings } from "@triagefox/billing";
import { type Db, eq, schema } from "@triagefox/db";
import type { Notifier } from "../notify";
import type { TriageInput } from "./deps";

type SupportCategory = schema.SupportCategory;

const BUG_TYPES = new Set(["bug", "ui_ux", "performance", "infra", "security", "data"]);
const NO_ACTION: Record<string, SupportCategory> = {
  billing: "billing",
  refund_request: "refund_request",
  account: "account",
  complaint: "complaint",
  praise: "praise",
  question: "question",
};

/** Our own support categories for one AI action, or null when it is not for the inbox (greetings, spam, updates). */
export function supportCategory(
  a: Pick<TriageAction, "kind" | "type" | "category">,
): SupportCategory | null {
  if (a.kind === "create") return a.type && BUG_TYPES.has(a.type) ? "bug" : "feature";
  if (a.kind === "no_action" && a.category) return NO_ACTION[a.category] ?? null;
  return null;
}

/**
 * TriageFox's own support (docs/own-support.md): files what the AI found in a support conversation in the
 * admin inbox, links the customer to a user and workspace by email, and raises an urgent alert for the
 * categories that matter (billing, refunds, account access, serious bugs). Runs only for the platform's
 * own automation. Safe to run again for the same conversation: one item per category.
 */
export async function recordSupportItems(deps: {
  db: Db;
  notifier?: Notifier;
  input: TriageInput;
  actions: TriageAction[];
}) {
  const { db, input } = deps;
  const settings = (await getSettings(db)).support;
  const email = input.conversation.customer.email?.toLowerCase() ?? null;
  let matchedUserId: string | null = null;
  let matchedOrgId: string | null = null;
  if (email) {
    const [u] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    matchedUserId = u?.id ?? null;
    if (u) {
      const [m] = await db
        .select({ org: schema.member.organizationId })
        .from(schema.member)
        .where(eq(schema.member.userId, u.id))
        .limit(1);
      matchedOrgId = m?.org ?? null;
    }
  }
  const crispUrl = `https://app.crisp.chat/website/${input.conversation.websiteId}/inbox/${input.conversation.sessionId}/`;

  for (const a of deps.actions) {
    const category = supportCategory(a);
    if (!category || !settings.capture.includes(category)) continue;
    const title = (a.title || a.reason || category).slice(0, 160);
    const summary = a.summary || a.reason || "";
    const [row] = await db
      .insert(schema.supportItems)
      .values({
        sourceOrgId: input.orgId,
        threadId: input.thread.id,
        category,
        priority: a.priority ?? null,
        title,
        summary,
        customerEmail: email,
        identityVerified: input.conversation.customer.verified === true,
        matchedUserId,
        matchedOrgId,
        crispUrl,
      })
      .onConflictDoUpdate({
        target: [schema.supportItems.threadId, schema.supportItems.category],
        set: { title, summary, priority: a.priority ?? null, updatedAt: new Date() },
      })
      .returning({
        id: schema.supportItems.id,
        createdAt: schema.supportItems.createdAt,
        updatedAt: schema.supportItems.updatedAt,
      });

    // Alert only for a brand new item, never again when the same conversation is re-read.
    const isNew = row && row.createdAt.getTime() === row.updatedAt.getTime();
    const urgent =
      settings.urgent.includes(category) ||
      (category === "bug" && (a.priority ?? 0) >= settings.urgentMinPriority);
    if (isNew && urgent && deps.notifier)
      await deps.notifier.alert({
        subject: `Support: ${category.replace("_", " ")}`,
        text: `${title}\n${email ? `From ${email}${input.conversation.customer.verified ? " (verified)" : " (unverified: check before acting)"}` : "Unknown customer"}\nOpen in Crisp: ${crispUrl}`,
      });
  }
}

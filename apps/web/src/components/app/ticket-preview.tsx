"use client";

import { buildTicketBody } from "@triagefox/connectors/ticket-body";
import { PriorityChip, TypeChip } from "./chips";

/** A made-up ticket that reacts to the settings, so the effect of each switch is visible before saving. */
export function TicketPreview({
  includeSourceLink,
  includeCustomerNames,
}: {
  includeSourceLink: boolean;
  includeCustomerNames: boolean;
}) {
  const body = buildTicketBody(
    {
      type: "bug",
      priority: 4,
      priorityReason: "Checkout is broken for Safari users with no workaround.",
      summary:
        "The Pay button on the checkout page does nothing in Safari, so customers cannot pay.",
      stepsToReproduce: ["Open the checkout page in Safari", "Click Pay"],
      expected: "The payment form opens",
      actual: "Nothing happens",
      environment: { browser: "Safari 18", os: "macOS" },
    },
    {
      reportedBy: includeCustomerNames ? "Jane Doe" : "1 customer",
      sourceUrl: includeSourceLink ? "https://app.crisp.chat/website/…/inbox/…" : undefined,
    },
  );
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <TypeChip type="bug" />
        <PriorityChip priority={4} />
      </div>
      <p className="font-semibold">Checkout button does nothing on Safari</p>
      <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">{body}</pre>
    </div>
  );
}

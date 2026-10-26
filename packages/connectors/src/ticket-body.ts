import {
  PRIORITY_NAMES,
  type Priority,
  TICKET_TYPE_LABELS,
  type TicketType,
} from "@triagefox/shared";

export interface TicketContent {
  type: TicketType;
  priority: Priority;
  priorityReason: string;
  summary: string;
  stepsToReproduce: string[];
  expected?: string;
  actual?: string;
  environment?: { browser?: string; os?: string; device?: string; pageUrl?: string };
}

export interface TicketBodyOptions {
  /** "Reported by …" line: a count, or the customer's name when the workspace allows names. */
  reportedBy?: string;
  sourceUrl?: string;
  productName?: string;
}

/** Plain text on one line: no newlines or markdown that could reshape the ticket. */
const line = (s: string) => s.replace(/\s+/g, " ").trim();

/** The ticket body in the template from docs/ai-triage.md. Sections without content are left out. */
export function buildTicketBody(c: TicketContent, o: TicketBodyOptions = {}): string {
  const out: string[] = ["## Summary", c.summary.trim(), ""];
  if (c.stepsToReproduce.length > 0) {
    out.push("## Steps to reproduce");
    for (const [i, step] of c.stepsToReproduce.entries()) out.push(`${i + 1}. ${line(step)}`);
    if (c.expected) out.push("", `**Expected:** ${line(c.expected)}`);
    if (c.actual) out.push(`**Actual:** ${line(c.actual)}`);
    out.push("");
  } else if (c.expected || c.actual) {
    out.push("## Expected vs actual");
    if (c.expected) out.push(`**Expected:** ${line(c.expected)}`);
    if (c.actual) out.push(`**Actual:** ${line(c.actual)}`);
    out.push("");
  }
  const env = c.environment;
  const envParts = env ? [env.browser, env.os, env.device, env.pageUrl].filter(Boolean) : [];
  if (envParts.length > 0)
    out.push("## Environment", envParts.map((p) => line(String(p))).join(" · "), "");
  out.push(
    "---",
    `Type: ${TICKET_TYPE_LABELS[c.type]} · Priority: ${c.priority} (${PRIORITY_NAMES[c.priority]}) — ${line(c.priorityReason)}`,
  );
  if (o.reportedBy) out.push(`Reported by ${line(o.reportedBy)}`);
  if (o.sourceUrl) out.push(`Source: ${o.sourceUrl}`);
  out.push(`Created by ${o.productName ?? "TriageFox"}`);
  return out.join("\n");
}

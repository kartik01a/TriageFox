import type { TriageAction } from "@triagefox/ai";
import type { CrispMessage } from "@triagefox/connectors";

/**
 * Which files go on which ticket (docs/requirements.md §13: customer files are always attached).
 *
 * The AI's `relevantAttachmentIds` only decides which ticket a file belongs to when one chat produces
 * several tickets; it never drops a customer's file. Files the AI matched to no ticket go on every
 * ticket from this run. A new ticket gets the customer's files from the whole conversation that are not
 * already on another ticket from this chat; a follow-up or duplicate gets only the files sent since the
 * last analysis (older ones are already on a ticket). Operator and note files are attached only when the
 * AI picks them.
 */
export function planTicketFiles(args: {
  messages: CrispMessage[];
  /** Fingerprint of the last message the previous analysis saw, or null on the first one. */
  cursor: string | null;
  actions: Pick<TriageAction, "kind" | "relevantAttachmentIds" | "resolvedInChat">[];
  /** Files already on tickets created from this conversation. */
  alreadyOnThreadTickets: Iterable<string>;
}): string[][] {
  const { messages, cursor, actions } = args;
  const customerFiles = messages
    .filter((m) => m.role === "customer" && m.kind === "file")
    .map((m) => m.fingerprint);
  const cursorAt = cursor ? messages.findIndex((m) => m.fingerprint === cursor) : -1;
  const sinceCursor = new Set(messages.slice(cursorAt + 1).map((m) => m.fingerprint));
  const newCustomerFiles = customerFiles.filter((id) => sinceCursor.has(id));

  const carriesFiles = (a: (typeof actions)[number]) =>
    a.kind === "create" || a.kind === "duplicate_of" || (a.kind === "update" && !a.resolvedInChat);
  const claimed = new Set(actions.filter(carriesFiles).flatMap((a) => a.relevantAttachmentIds));
  const taken = new Set(args.alreadyOnThreadTickets);

  return actions.map((a) => {
    if (!carriesFiles(a)) return [];
    const pool =
      a.kind === "create" ? customerFiles.filter((id) => !taken.has(id)) : newCustomerFiles;
    const unclaimed = pool.filter((id) => !claimed.has(id));
    return [...new Set([...a.relevantAttachmentIds, ...unclaimed])];
  });
}

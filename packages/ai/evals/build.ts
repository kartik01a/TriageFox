import type { Priority, TicketType } from "@triagefox/shared";
import type { NoActionCategory } from "../src/types";
import type { EvalCase, EvalMessage, Expect } from "./types";

const ROLE = { C: "customer", O: "operator", N: "note" } as const;

/** "C: text" = customer, "O: text" = operator, "N: text" = private note. */
export function talk(lines: string[]): EvalMessage[] {
  return lines.map((l) => {
    const tag = l.slice(0, 2) as "C:" | "O:" | "N:";
    const role = ROLE[tag.charAt(0) as keyof typeof ROLE];
    if (!role || tag.charAt(1) !== ":") throw new Error(`Bad eval line (needs C:/O:/N:): ${l}`);
    return { role, text: l.slice(2).trim() };
  });
}

type Extra = Partial<Omit<EvalCase, "id" | "tags" | "messages" | "expect">>;

export const c = (
  id: string,
  tags: string[],
  lines: string[],
  expect: Expect,
  extra: Extra & { note?: string } = {},
): EvalCase => ({
  id,
  tags,
  messages: talk(lines),
  expect,
  ...extra,
});

/** Expect a ticket. */
export const ticket = (
  type: TicketType | TicketType[],
  priority: Priority,
  more: Partial<Expect> = {},
): Expect => ({
  positive: true,
  kind: "create",
  type,
  priority,
  ...more,
});

/** Expect no ticket. */
export const none = (
  category?: NoActionCategory | NoActionCategory[],
  more: Partial<Expect> = {},
): Expect => ({
  positive: false,
  kind: "no_action",
  ...(category ? { category } : {}),
  ...more,
});

import type { CrispMessage } from "@triagefox/connectors";
import { describe, expect, it } from "vitest";
import { planTicketFiles } from "./files";

const text = (id: string, role: CrispMessage["role"] = "customer"): CrispMessage => ({
  fingerprint: id,
  timestamp: Number(id.replace(/\D/g, "")) || 1,
  role,
  kind: "text",
  text: "x",
});
const file = (id: string, role: CrispMessage["role"] = "customer"): CrispMessage => ({
  fingerprint: id,
  timestamp: 1,
  role,
  kind: "file",
  file: { name: `${id}.png`, url: `https://storage.crisp.chat/${id}`, mime: "image/png" },
});
const act = (
  kind: "create" | "update" | "duplicate_of" | "no_action",
  relevant: string[] = [],
  resolvedInChat = false,
) => ({ kind, relevantAttachmentIds: relevant, resolvedInChat });

describe("planTicketFiles: customer files are always attached", () => {
  it("attaches a screenshot the AI did not pick", () => {
    const plan = planTicketFiles({
      messages: [text("m1"), file("f1")],
      cursor: null,
      actions: [act("create")],
      alreadyOnThreadTickets: [],
    });
    expect(plan).toEqual([["f1"]]);
  });

  it("with two tickets, matched files go to their ticket and unmatched files go to both", () => {
    const plan = planTicketFiles({
      messages: [text("m1"), file("a"), file("b"), file("c")],
      cursor: null,
      actions: [act("create", ["a"]), act("create", ["b"])],
      alreadyOnThreadTickets: [],
    });
    expect(plan).toEqual([
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("a follow-up only carries files sent since the last analysis", () => {
    const plan = planTicketFiles({
      messages: [text("m1"), file("old"), text("m2"), file("new")],
      cursor: "m2",
      actions: [act("update")],
      alreadyOnThreadTickets: ["old"],
    });
    expect(plan).toEqual([["new"]]);
  });

  it("a later ticket from the same chat does not repeat files already on an earlier one", () => {
    const plan = planTicketFiles({
      messages: [file("first"), text("m2"), file("second")],
      cursor: "m2",
      actions: [act("create")],
      alreadyOnThreadTickets: ["first"],
    });
    expect(plan).toEqual([["second"]]);
  });

  it("a duplicate report brings the new customer's files to the existing ticket", () => {
    const plan = planTicketFiles({
      messages: [text("m1"), file("shot")],
      cursor: null,
      actions: [act("duplicate_of")],
      alreadyOnThreadTickets: [],
    });
    expect(plan).toEqual([["shot"]]);
  });

  it("no files for no-ticket answers or 'resolved in chat'; operator files only when picked", () => {
    const plan = planTicketFiles({
      messages: [text("m1"), file("op", "operator"), file("cust")],
      cursor: null,
      actions: [act("no_action"), act("update", [], true), act("create")],
      alreadyOnThreadTickets: [],
    });
    expect(plan).toEqual([[], [], ["cust"]]);
  });
});

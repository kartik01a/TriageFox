import { describe, expect, it } from "vitest";
import {
  buildTicketBody,
  JiraClient,
  markdownToAdf,
  ProviderError,
  refreshTicketFooter,
  TrelloClient,
} from "./index";

describe("markdownToAdf", () => {
  it("converts the ticket template: headings, lists, bold, rule", () => {
    const body = buildTicketBody({
      type: "bug",
      priority: 4,
      priorityReason: "Checkout is broken.",
      summary: "Cannot pay on Safari.",
      stepsToReproduce: ["Open checkout", "Click Pay"],
      expected: "Form opens",
      actual: "Nothing happens",
      environment: { browser: "Safari 18", os: "macOS" },
    });
    const adf = markdownToAdf(body);
    expect(adf.type).toBe("doc");
    const types = adf.content.map((n) => n.type);
    expect(types).toContain("heading");
    expect(types).toContain("orderedList");
    expect(types).toContain("rule");
    const list = adf.content.find((n) => n.type === "orderedList");
    expect(list?.content).toHaveLength(2);
    const strong = JSON.stringify(adf).includes('"strong"');
    expect(strong).toBe(true);
  });

  it("never turns text into markup: HTML stays literal text", () => {
    const adf = markdownToAdf("<script>alert(1)</script> and <b>x</b>");
    const first = adf.content[0]?.content?.[0];
    expect(first?.type).toBe("text");
    expect(first?.text).toContain("<script>");
  });

  it("only links http(s) URLs", () => {
    const adf = markdownToAdf("[bad](javascript:alert(1)) [ok](https://example.com/a)");
    const json = JSON.stringify(adf);
    expect(json).not.toContain('"href":"javascript');
    expect(json).toContain("https://example.com/a");
  });

  it("returns a valid empty document for empty input", () => {
    expect(markdownToAdf("").content).toHaveLength(1);
  });
});

describe("buildTicketBody", () => {
  const base = {
    type: "feature" as const,
    priority: 2 as const,
    priorityReason: "Nice to have.",
    summary: "Dark mode please.",
    stepsToReproduce: [],
  };
  it("leaves out empty sections and adds the footer", () => {
    const b = buildTicketBody(base, { reportedBy: "1 customer" });
    expect(b).not.toContain("Steps to reproduce");
    expect(b).not.toContain("Environment");
    expect(b).toContain("Type: Feature · Priority: 2 (Low)");
    expect(b).toContain("Reported by 1 customer");
    expect(b).not.toContain("Source:");
    expect(b).toContain("Created by TriageFox");
  });
  it("includes the source link only when given", () => {
    expect(buildTicketBody(base, { sourceUrl: "https://app.crisp.chat/x" })).toContain(
      "Source: https://app.crisp.chat/x",
    );
  });
  it("keeps AI text on one line so it cannot add sections", () => {
    const b = buildTicketBody({ ...base, priorityReason: "ok\n## Injected" });
    expect(b).not.toMatch(/^## Injected/m);
  });
});

function fake(handler: (url: URL, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
    });
  }) as typeof fetch;
  return { fn, calls };
}

describe("Trello card creation", () => {
  it("sends the card as JSON (long descriptions), with labels and due date", async () => {
    const { fn, calls } = fake(() => ({
      body: { id: "c1", shortUrl: "https://trello.com/c/x", url: "u" },
    }));
    const t = new TrelloClient({ apiKey: "K", token: "T", fetch: fn });
    const card = await t.createCard({
      listId: "L",
      name: "N",
      desc: "D".repeat(5000),
      due: "2026-10-30T12:00:00.000Z",
      labelIds: ["a", "b"],
    });
    expect(card.id).toBe("c1");
    const call = calls[0];
    expect(call?.url.pathname).toBe("/1/cards");
    expect(call?.url.search).not.toContain("DDDD");
    const body = JSON.parse(String(call?.init.body));
    expect(body).toMatchObject({ idList: "L", idLabels: "a,b", due: "2026-10-30T12:00:00.000Z" });
  });
  it("uploads a file as multipart", async () => {
    const { fn, calls } = fake(() => ({ body: {} }));
    await new TrelloClient({ apiKey: "K", token: "T", fetch: fn }).uploadAttachment(
      "c1",
      new Blob(["x"]),
      "a.png",
    );
    expect(calls[0]?.init.body).toBeInstanceOf(FormData);
  });
  it("classifies a deleted list as not_found", async () => {
    const { fn } = fake(() => ({ status: 404 }));
    await expect(
      new TrelloClient({ apiKey: "K", token: "T", fetch: fn }).createCard({
        listId: "L",
        name: "n",
        desc: "",
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("Jira issue creation", () => {
  it("creates with ADF, labels and edits priority separately", async () => {
    const { fn, calls } = fake((url, init) => {
      if (init.method === "POST" && url.pathname.endsWith("/issue"))
        return { body: { id: "1", key: "TF-1" } };
      return { status: 200 };
    });
    const j = new JiraClient({ accessToken: "A", cloudId: "C", fetch: fn });
    const made = await j.createIssue({
      projectKey: "TF",
      issueTypeId: "10001",
      summary: "S",
      description: markdownToAdf("hi"),
      labels: ["from-chat"],
    });
    expect(made.key).toBe("TF-1");
    await j.editIssue("TF-1", { fields: { priority: { id: "2" } } });
    const create = JSON.parse(String(calls[0]?.init.body));
    expect(create.fields.project.key).toBe("TF");
    expect(create.fields.description.type).toBe("doc");
    expect(calls[1]?.init.method).toBe("PUT");
  });
  it("uploads attachments with the no-check header", async () => {
    const { fn, calls } = fake(() => ({ body: [] }));
    await new JiraClient({ accessToken: "A", cloudId: "C", fetch: fn }).uploadAttachment(
      "TF-1",
      new Blob(["x"]),
      "a.png",
    );
    expect(((calls[0]?.init.headers ?? {}) as Record<string, string>)["x-atlassian-token"]).toBe(
      "no-check",
    );
  });
  it("reports a rejected field as invalid", async () => {
    const { fn } = fake(() => ({ status: 400, body: { errors: { duedate: "bad" } } }));
    const err = await new JiraClient({ accessToken: "A", cloudId: "C", fetch: fn })
      .createIssue({
        projectKey: "TF",
        issueTypeId: "1",
        summary: "s",
        description: {},
        labels: [],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("invalid");
  });
});

describe("refreshTicketFooter", () => {
  const body =
    "## Summary\nx\n\n---\nType: Bug · Priority: 3 (Medium) — Workaround exists.\nReported by 1 customer\nCreated by TriageFox";
  it("changes only the priority and reporter lines", () => {
    const next = refreshTicketFooter(body, { priority: 5, reportedBy: "3 customers" });
    expect(next).toContain("Type: Bug · Priority: 5 (Critical) — Workaround exists.");
    expect(next).toContain("Reported by 3 customers");
    expect(next).toContain("## Summary\nx");
    expect(next).toContain("Created by TriageFox");
  });
});

describe("state and edit-history calls", () => {
  it("Trello: reads a card and the people who edited its description", async () => {
    const { fn } = fake((url) =>
      url.pathname.endsWith("/actions")
        ? { body: [{ date: "2026-10-27T10:00:00.000Z", idMemberCreator: "M1" }] }
        : { body: { id: "c", closed: true, idLabels: ["a"], desc: "" } },
    );
    const t = new TrelloClient({ apiKey: "K", token: "T", fetch: fn });
    expect((await t.getCard("c")).closed).toBe(true);
    expect(await t.descriptionEdits("c")).toEqual([
      { byMemberId: "M1", at: "2026-10-27T10:00:00.000Z" },
    ]);
  });
  it("Jira: knows when an issue is Done and who changed the description", async () => {
    const { fn } = fake((url) =>
      url.pathname.endsWith("/changelog")
        ? {
            body: {
              values: [
                {
                  created: "2026-10-27T10:00:00.000Z",
                  author: { accountId: "A1" },
                  items: [{ field: "description" }, { field: "status" }],
                },
                {
                  created: "2026-10-27T11:00:00.000Z",
                  author: { accountId: "A2" },
                  items: [{ field: "status" }],
                },
              ],
              isLast: true,
            },
          }
        : { body: { fields: { status: { statusCategory: { key: "done" } } } } },
    );
    const j = new JiraClient({ accessToken: "A", cloudId: "C", fetch: fn });
    expect(await j.isDone("TF-1")).toBe(true);
    expect(await j.descriptionEdits("TF-1")).toEqual([
      { byAccountId: "A1", at: "2026-10-27T10:00:00.000Z" },
    ]);
  });
});

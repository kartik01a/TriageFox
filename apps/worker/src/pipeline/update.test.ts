import { randomUUID } from "node:crypto";
import { generateKeyPair, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { createDb, type Db, eq, schema, withOrg } from "@triagefox/db";
import type { DeliverPayload } from "@triagefox/pipeline";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Ctx, sealCredentials } from "../rpc/context";
import { FakeNet, type Route } from "./fake-net";
import { createUpdate } from "./update";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 5 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
const orgId = `org_${randomUUID()}`;
const net = new FakeNet();
let keyring: PrivateKeyring;
let ctx: Ctx;
const log = { info() {}, warn() {}, error() {} };
const delivered: DeliverPayload[] = [];
let conversationFiles: { fingerprint: string; name: string; url: string }[] = [];

const run = () =>
  createUpdate({
    ctx,
    enqueueDelivery: async (p) => void delivered.push(p),
    crisp: () => ({
      fetchConversation: async () => ({
        sessionId: "sess",
        websiteId: "w",
        state: "open" as const,
        updatedAt: Date.now(),
        customer: {},
        messages: conversationFiles.map((f, i) => ({
          fingerprint: f.fingerprint,
          timestamp: i,
          role: "customer" as const,
          kind: "file" as const,
          file: { name: f.name, url: f.url, mime: "image/png" },
        })),
      }),
      listConversations: async () => [],
    }),
    download: { fetch: net.fetch, resolve: async () => ["93.184.216.34"] },
  });

type Kind = "update" | "duplicate" | "resolved_in_chat";

/** An issue that already exists in Trello or Jira, plus an update waiting to be applied. */
async function world(
  tool: "trello" | "jira",
  o: {
    kind?: Kind;
    text?: string;
    newPriority?: number;
    newDueDate?: string;
    attachmentIds?: string[];
    ticketStatus?: "ok" | "pending" | "failed";
    lastPushedAt?: Date;
  } = {},
) {
  const ins = <T>(fn: (tx: Parameters<Parameters<typeof withOrg>[2]>[0]) => Promise<T>) =>
    withOrg(db, orgId, fn);
  const [source] = await ins((tx) =>
    tx
      .insert(schema.connections)
      .values({
        orgId,
        provider: "crisp",
        authType: "plugin_install",
        status: "active",
        metadata: { websiteId: `w-${randomUUID()}` },
      })
      .returning(),
  );
  const [automation] = await ins((tx) =>
    tx
      .insert(schema.automations)
      .values({ orgId, sourceConnectionId: source?.id ?? "", name: "a", enabled: true })
      .returning(),
  );
  const [thread] = await ins((tx) =>
    tx
      .insert(schema.threads)
      .values({ orgId, automationId: automation?.id ?? "", sourceId: "sess" })
      .returning(),
  );
  const body =
    "## Summary\nCannot pay.\n\n---\nType: Bug · Priority: 3 (Medium) — x\nReported by 1 customer\nCreated by TriageFox";
  const [issue] = await ins((tx) =>
    tx
      .insert(schema.issues)
      .values({
        orgId,
        automationId: automation?.id ?? "",
        originThreadId: thread?.id ?? "",
        title: "Checkout fails",
        summary: "s",
        bodyMd: body,
        type: "bug",
        priority: 3,
        confidence: 0.9,
      })
      .returning(),
  );
  const [conn] = await ins((tx) =>
    tx
      .insert(schema.connections)
      .values({
        orgId,
        provider: tool,
        authType: tool === "trello" ? "token" : "oauth",
        status: "active",
        metadata:
          tool === "trello"
            ? { memberId: "ME" }
            : { sites: [{ id: "CLOUD", name: "x", url: "https://x.atlassian.net" }] },
      })
      .returning(),
  );
  const creds =
    tool === "trello"
      ? { token: "TOK" }
      : { accessToken: "A", refreshToken: "R", expiresAt: Date.now() + 3_600_000 };
  const sealed = await sealCredentials(ctx, { orgId, id: conn?.id ?? "" }, creds);
  await ins((tx) =>
    tx
      .update(schema.connections)
      .set({ credentialsSealed: sealed })
      .where(eq(schema.connections.id, conn?.id ?? "")),
  );
  const [dest] = await ins((tx) =>
    tx
      .insert(schema.automationDestinations)
      .values({
        orgId,
        automationId: automation?.id ?? "",
        connectionId: conn?.id ?? "",
        config:
          tool === "trello"
            ? {
                kind: "trello",
                boardId: "B",
                listId: "L",
                labelIds: { priorities: { "3": "p3", "5": "p5" }, types: { bug: "tb" } },
              }
            : {
                kind: "jira",
                cloudId: "CLOUD",
                projectKey: "TF",
                issueTypeMap: { bug: "10001" },
                priorityMap: { "5": "1", "3": "3" },
              },
      })
      .returning(),
  );
  const [ticket] = await ins((tx) =>
    tx
      .insert(schema.destinationTickets)
      .values({
        orgId,
        issueId: issue?.id ?? "",
        destinationId: dest?.id ?? "",
        status: o.ticketStatus ?? "ok",
        externalId: tool === "trello" ? "card1" : "10",
        externalKey: tool === "jira" ? "TF-10" : null,
        url:
          tool === "trello" ? "https://trello.com/c/abc" : "https://x.atlassian.net/browse/TF-10",
        lastPushedAt: o.lastPushedAt ?? new Date(Date.now() - 60_000),
      })
      .returning(),
  );
  const updateId = randomUUID();
  const contentSealed = await sealSecret(
    JSON.stringify({ text: o.text ?? "It also fails on iPad." }),
    { orgId, recordId: updateId, purpose: "issue_update.content" },
    keyring,
  );
  await ins((tx) =>
    tx.insert(schema.issueUpdates).values({
      id: updateId,
      orgId,
      issueId: issue?.id ?? "",
      threadId: thread?.id ?? "",
      kind: o.kind ?? "update",
      contentSealed,
      attachmentIds: o.attachmentIds ?? [],
      newPriority: o.newPriority ?? null,
      newDueDate: o.newDueDate ?? null,
    }),
  );
  return {
    p: { orgId, updateId, destinationId: dest?.id ?? "" },
    issueId: issue?.id ?? "",
    threadId: thread?.id ?? "",
    ticketId: ticket?.id ?? "",
    connId: conn?.id ?? "",
  };
}

const kinds = (threadId: string) =>
  withOrg(db, orgId, (tx) =>
    tx.select().from(schema.activityLog).where(eq(schema.activityLog.threadId, threadId)),
  ).then((r) => r.map((x) => x.kind));
const bodies = (method: string, path: RegExp) =>
  net.calls
    .filter((c) => c.method === method && path.test(c.url.pathname))
    .map((c) => (typeof c.body === "string" ? JSON.parse(c.body) : c.body));

const trelloBase: Route = ({ method, url }) => {
  if (url.hostname !== "api.trello.com") return;
  if (method === "GET" && url.pathname === "/1/cards/card1")
    return { body: { id: "card1", closed: false, idLabels: ["p3", "tb"], desc: "" } };
  if (method === "GET" && url.pathname.endsWith("/actions")) return { body: [] };
  return { body: {} };
};
const jiraBase: Route = ({ method, url }) => {
  if (url.hostname !== "api.atlassian.com") return;
  if (method === "GET" && url.pathname.endsWith("/myself")) return { body: { accountId: "ME" } };
  if (method === "GET" && url.pathname.endsWith("/changelog"))
    return { body: { values: [], isLast: true } };
  if (method === "GET" && url.pathname.endsWith("/issue/TF-10"))
    return { body: { fields: { status: { statusCategory: { key: "indeterminate" } } } } };
  return { body: {} };
};

beforeAll(async () => {
  const kp = await generateKeyPair();
  keyring = {
    currentVersion: 1,
    publicKeys: { 1: kp.publicKey },
    privateKeys: { 1: kp.privateKey },
  };
  ctx = {
    db,
    redis,
    keyring,
    log,
    fetch: net.fetch,
    config: {
      TRELLO_API_KEY: "KEY",
      ATLASSIAN_CLIENT_ID: "id",
      ATLASSIAN_CLIENT_SECRET: "secret",
      APP_URL: "http://localhost:3000",
    } as Ctx["config"],
  };
});
afterAll(async () => {
  await owner.$client.unsafe("delete from connections where org_id = $1", [orgId]);
  await db.$client.end();
  await owner.$client.end();
  redis.disconnect();
});

describe("Trello follow-ups", () => {
  it("comments once, swaps the priority label, sets the due date and refreshes the description", async () => {
    net.reset();
    net.routes.push(trelloBase);
    const w = await world("trello", { newPriority: 5, newDueDate: "2026-11-03" });
    await run()(w.p);
    await run()(w.p); // a repeated job changes nothing

    const comments = bodies("POST", /\/cards\/card1\/actions\/comments$/);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain("Customer added:");
    expect(comments[0].text).toContain("It also fails on iPad.");
    const puts = bodies("PUT", /\/cards\/card1$/);
    expect(puts).toContainEqual({ idLabels: "tb,p5" }); // p3 removed, p5 added
    expect(puts).toContainEqual({ due: "2026-11-03T12:00:00.000Z" });
    expect(puts.some((b) => typeof b.desc === "string")).toBe(true);
    expect(await kinds(w.threadId)).toContain("ticket_updated");
  });

  it("leaves the description alone when a person edited it", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "GET" && url.pathname.endsWith("/actions")
          ? { body: [{ date: new Date().toISOString(), idMemberCreator: "SOMEONE_ELSE" }] }
          : undefined,
      trelloBase,
    );
    const w = await world("trello", { newPriority: 5 });
    await run()(w.p);
    expect(bodies("POST", /comments$/)).toHaveLength(1); // the comment still goes through
    expect(bodies("PUT", /\/cards\/card1$/).some((b) => typeof b.desc === "string")).toBe(false);
    expect(await kinds(w.threadId)).toContain("description_kept");
  });

  it("our own earlier description edit does not count as a person's edit", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "GET" && url.pathname.endsWith("/actions")
          ? { body: [{ date: new Date().toISOString(), idMemberCreator: "ME" }] }
          : undefined,
      trelloBase,
    );
    const w = await world("trello", { newPriority: 5 });
    await run()(w.p);
    expect(bodies("PUT", /\/cards\/card1$/).some((b) => typeof b.desc === "string")).toBe(true);
  });

  it("'possibly resolved in chat' is a comment only", async () => {
    net.reset();
    net.routes.push(trelloBase);
    const w = await world("trello", {
      kind: "resolved_in_chat",
      text: "Disabling the extension fixed it.",
    });
    await run()(w.p);
    expect(bodies("POST", /comments$/)[0].text).toContain("Possibly resolved in chat:");
    expect(bodies("PUT", /\/cards\/card1$/)).toHaveLength(0);
  });

  it("uploads new screenshots from the follow-up", async () => {
    net.reset();
    net.routes.push(trelloBase);
    net.files.set("/new.png", new Uint8Array([1, 2]));
    conversationFiles = [
      { fingerprint: "f9", name: "new.png", url: "https://storage.crisp.chat/new.png" },
    ];
    const w = await world("trello", { attachmentIds: ["f9"] });
    await run()(w.p);
    const uploads = net.calls.filter(
      (c) => c.method === "POST" && c.url.pathname === "/1/cards/card1/attachments",
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.body).toBeInstanceOf(FormData);
    conversationFiles = [];
  });

  it("another customer's report on a closed card opens a new ticket that points to the old one", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "GET" && url.pathname === "/1/cards/card1"
          ? { body: { id: "card1", closed: true, idLabels: [], desc: "" } }
          : undefined,
      trelloBase,
    );
    delivered.length = 0;
    const w = await world("trello", { kind: "duplicate", text: "Same problem here." });
    await run()(w.p);

    expect(bodies("POST", /comments$/)).toHaveLength(0);
    expect(delivered).toHaveLength(1);
    const [fresh] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(schema.issues)
        .where(eq(schema.issues.id, delivered[0]?.issueId ?? "")),
    );
    expect(fresh?.bodyMd).toContain("Possible regression");
    expect(fresh?.title).toContain("(again)");
    expect(await kinds(w.threadId)).toContain("regression");
  });

  it("waits for a ticket that is still being created, then gives up cleanly", async () => {
    net.reset();
    net.routes.push(trelloBase);
    const w = await world("trello", { ticketStatus: "pending" });
    await expect(run()(w.p)).rejects.toThrow(/not delivered/);
    await run()(w.p, { finalAttempt: true });
    expect(net.calls).toHaveLength(0);
    expect(await kinds(w.threadId)).toContain("update_skipped");
  });

  it("a revoked token pauses the connection", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "POST" && url.pathname.endsWith("/comments") ? { status: 401 } : undefined,
      trelloBase,
    );
    const w = await world("trello");
    await run()(w.p);
    const [conn] = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.connections).where(eq(schema.connections.id, w.connId)),
    );
    expect(conn?.status).toBe("revoked");
  });
});

describe("Jira follow-ups", () => {
  it("comments in ADF, edits priority and due date, refreshes the description", async () => {
    net.reset();
    net.routes.push(jiraBase);
    const w = await world("jira", { newPriority: 5, newDueDate: "2026-11-03" });
    await run()(w.p);
    const comment = bodies("POST", /\/issue\/TF-10\/comment$/)[0];
    expect(comment.body.type).toBe("doc");
    expect(JSON.stringify(comment)).toContain("Customer added:");
    const edits = bodies("PUT", /\/issue\/TF-10$/);
    expect(edits).toContainEqual({ fields: { priority: { id: "1" } } });
    expect(edits).toContainEqual({ fields: { duedate: "2026-11-03" } });
    expect(edits.some((b) => b.fields?.description?.type === "doc")).toBe(true);
  });

  it("keeps a developer's description edit", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "GET" && url.pathname.endsWith("/changelog")
          ? {
              body: {
                values: [
                  {
                    created: new Date().toISOString(),
                    author: { accountId: "DEV" },
                    items: [{ field: "description" }],
                  },
                ],
                isLast: true,
              },
            }
          : undefined,
      jiraBase,
    );
    const w = await world("jira", { newPriority: 5 });
    await run()(w.p);
    expect(bodies("PUT", /\/issue\/TF-10$/).some((b) => b.fields?.description)).toBe(false);
    expect(await kinds(w.threadId)).toContain("description_kept");
  });

  it("a duplicate of a Done issue opens a new ticket", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "GET" && url.pathname.endsWith("/issue/TF-10")
          ? { body: { fields: { status: { statusCategory: { key: "done" } } } } }
          : undefined,
      jiraBase,
    );
    delivered.length = 0;
    const w = await world("jira", { kind: "duplicate" });
    await run()(w.p);
    expect(bodies("POST", /comment$/)).toHaveLength(0);
    expect(delivered).toHaveLength(1);
    expect(await kinds(w.threadId)).toContain("regression");
  });
});

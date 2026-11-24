import { randomUUID } from "node:crypto";
import type { CrispConversation } from "@triagefox/connectors";
import { generateKeyPair, type PrivateKeyring } from "@triagefox/crypto";
import { createDb, type Db, eq, schema, withOrg } from "@triagefox/db";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Ctx, sealCredentials } from "../rpc/context";
import { createDeliver } from "./deliver";
import { FakeNet, type Route } from "./fake-net";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 5 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
const orgId = `org_${randomUUID()}`;
let keyring: PrivateKeyring;

const net = new FakeNet();

const log = { info() {}, warn() {}, error() {} };
const revoked: { orgId: string; id: string; provider: string }[] = [];
let ctx: Ctx;
const conv = (messages: CrispConversation["messages"] = []): CrispConversation => ({
  sessionId: "sess",
  websiteId: "w",
  state: "open",
  updatedAt: Date.now(),
  customer: {},
  messages,
});
let conversation = conv();
const crisp = () => ({
  fetchConversation: async () => conversation,
  listConversations: async () => [],
});
const deliver = () =>
  createDeliver({
    ctx,
    crisp,
    download: { fetch: net.fetch, resolve: async () => ["93.184.216.34"] },
  });

async function world(
  opts: {
    trello?: boolean;
    jira?: boolean;
    status?: "active" | "pending_review";
    attachmentIds?: string[];
    dueDate?: string;
    labelMap?: {
      priorities?: Record<string, string | null>;
      types?: Record<string, string | null>;
    };
    typeLabels?: Record<string, string | null>;
    linear?: { stateId?: string; projectId?: string; typeLabels?: Record<string, string | null> };
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
  const [issue] = await ins((tx) =>
    tx
      .insert(schema.issues)
      .values({
        orgId,
        automationId: automation?.id ?? "",
        originThreadId: thread?.id ?? "",
        title: "Checkout fails on Safari",
        summary: "s",
        bodyMd: "## Summary\nCannot pay.\n\n---\nType: Bug",
        type: "bug",
        priority: 4,
        confidence: 0.9,
        dueDate: opts.dueDate ?? null,
        attachmentIds: opts.attachmentIds ?? [],
        status: opts.status ?? "active",
      })
      .returning(),
  );
  const out: {
    issue: typeof issue;
    thread: typeof thread;
    trello?: { dest: string; conn: string };
    jira?: { dest: string; conn: string };
    linear?: { dest: string; conn: string };
  } = { issue, thread };
  if (opts.trello) {
    const [conn] = await ins((tx) =>
      tx
        .insert(schema.connections)
        .values({ orgId, provider: "trello", authType: "token", status: "active", metadata: {} })
        .returning(),
    );
    const sealed = await sealCredentials(ctx, { orgId, id: conn?.id ?? "" }, { token: "TOK" });
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
          config: {
            kind: "trello",
            boardId: "B",
            listId: "L",
            ...(opts.labelMap ? { labelMap: opts.labelMap } : {}),
          },
        })
        .returning(),
    );
    out.trello = { dest: dest?.id ?? "", conn: conn?.id ?? "" };
  }
  if (opts.jira) {
    const [conn] = await ins((tx) =>
      tx
        .insert(schema.connections)
        .values({
          orgId,
          provider: "jira",
          authType: "oauth",
          status: "active",
          metadata: { sites: [{ id: "CLOUD", name: "x", url: "https://x.atlassian.net" }] },
        })
        .returning(),
    );
    const sealed = await sealCredentials(
      ctx,
      { orgId, id: conn?.id ?? "" },
      { accessToken: "A", refreshToken: "R", expiresAt: Date.now() + 3_600_000 },
    );
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
          config: {
            kind: "jira",
            cloudId: "CLOUD",
            projectKey: "TF",
            issueTypeMap: { bug: "10001" },
            priorityMap: { "4": "2" },
            ...(opts.typeLabels ? { typeLabels: opts.typeLabels } : {}),
          },
        })
        .returning(),
    );
    out.jira = { dest: dest?.id ?? "", conn: conn?.id ?? "" };
  }
  if (opts.linear) {
    const [conn] = await ins((tx) =>
      tx
        .insert(schema.connections)
        .values({
          orgId,
          provider: "linear",
          authType: "oauth",
          status: "active",
          metadata: { workspaceName: "Acme", appUserId: "APP" },
        })
        .returning(),
    );
    const sealed = await sealCredentials(
      ctx,
      { orgId, id: conn?.id ?? "" },
      {
        accessToken: "LA",
        refreshToken: "LR",
        expiresAt: Date.now() + 3_600_000,
        refreshedAt: Date.now(),
      },
    );
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
          config: { kind: "linear", teamId: "TEAM", ...opts.linear },
        })
        .returning(),
    );
    out.linear = { dest: dest?.id ?? "", conn: conn?.id ?? "" };
  }
  return out;
}

const ticket = (issueId: string, destinationId: string) =>
  withOrg(db, orgId, (tx) =>
    tx
      .select()
      .from(schema.destinationTickets)
      .where(eq(schema.destinationTickets.issueId, issueId)),
  ).then((rows) => rows.find((r) => r.destinationId === destinationId));
const kinds = (threadId: string) =>
  withOrg(db, orgId, (tx) =>
    tx.select().from(schema.activityLog).where(eq(schema.activityLog.threadId, threadId)),
  ).then((r) => r.map((x) => x.kind));

const trelloOk: Route = ({ method, url }) => {
  if (url.hostname !== "api.trello.com") return;
  if (method === "GET" && url.pathname.endsWith("/labels")) return { body: [] };
  if (method === "POST" && url.pathname === "/1/labels")
    return { body: { id: `lab-${randomUUID()}` } };
  if (method === "POST" && url.pathname === "/1/cards")
    return { body: { id: "card1", shortUrl: "https://trello.com/c/abc" } };
  return { body: {} };
};
const jiraOk: Route = ({ method, url }) => {
  if (url.hostname !== "api.atlassian.com") return;
  if (method === "POST" && url.pathname.endsWith("/issue"))
    return { body: { id: "1", key: "TF-7" } };
  return { body: {} };
};

/** Fake Linear GraphQL API: a team with triage on, one existing workspace label "from-chat". */
const gql = (r: { body: unknown }) =>
  JSON.parse(String(r.body)) as { query: string; variables: Record<string, unknown> };
const linearOk =
  (opts: { triage?: boolean } = {}): Route =>
  (r) => {
    if (r.url.hostname === "uploads.example") return { body: {} };
    if (r.url.hostname !== "api.linear.app") return;
    const { query } = gql(r);
    if (query.includes("team(id"))
      return {
        body: {
          data: {
            team: {
              id: "TEAM",
              triageEnabled: opts.triage ?? true,
              states: {
                nodes: [
                  { id: "S-backlog", name: "Backlog", type: "backlog", position: 1 },
                  { id: "S-triage", name: "Triage", type: "triage", position: 0 },
                ],
              },
              projects: { nodes: [{ id: "P1", name: "Web", status: { type: "started" } }] },
            },
          },
        },
      };
    if (query.includes("issueLabels"))
      return {
        body: {
          data: {
            issueLabels: {
              nodes: [{ id: "L-chat", name: "from-chat", color: null, isGroup: false, team: null }],
            },
          },
        },
      };
    if (query.includes("issueLabelCreate"))
      return {
        body: {
          data: {
            issueLabelCreate: {
              success: true,
              issueLabel: {
                id: `L-${gql(r).variables.input && (gql(r).variables.input as { name: string }).name}`,
                name: "x",
                color: null,
              },
            },
          },
        },
      };
    if (query.includes("issueCreate"))
      return {
        body: {
          data: {
            issueCreate: {
              success: true,
              issue: {
                id: "ISS",
                identifier: "ACME-12",
                url: "https://linear.app/acme/issue/ACME-12",
              },
            },
          },
        },
      };
    if (query.includes("fileUpload"))
      return {
        body: {
          data: {
            fileUpload: {
              success: true,
              uploadFile: {
                uploadUrl: "https://uploads.example/put",
                assetUrl: "https://uploads.linear.app/asset-1",
                headers: [],
              },
            },
          },
        },
      };
    return { body: { data: { commentCreate: { success: true } } } };
  };
const linearCreate = () =>
  gql(
    net.calls.find(
      (c) => c.url.hostname === "api.linear.app" && String(c.body).includes("issueCreate"),
    ) as { body: unknown },
  ).variables.input as Record<string, unknown>;

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
    onRevoked: async (c) => void revoked.push(c),
    fetch: net.fetch,
    config: {
      TRELLO_API_KEY: "KEY",
      ATLASSIAN_CLIENT_ID: "id",
      ATLASSIAN_CLIENT_SECRET: "secret",
      LINEAR_CLIENT_ID: "lid",
      LINEAR_CLIENT_SECRET: "lsecret",
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

describe("Trello delivery", () => {
  it("creates labels and the card once, even if the job runs twice", async () => {
    net.reset();
    net.routes.push(trelloOk);
    const w = await world({ trello: true, dueDate: "2026-10-30" });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" };
    await deliver()(p);
    await deliver()(p);

    expect(net.count("POST", /^\/1\/cards$/)).toBe(1);
    expect(net.count("POST", /^\/1\/labels$/)).toBe(2); // priority + type
    const card = JSON.parse(String(net.calls.find((c) => c.url.pathname === "/1/cards")?.body));
    expect(card).toMatchObject({
      idList: "L",
      name: "Checkout fails on Safari",
      due: "2026-10-30T12:00:00.000Z",
    });
    expect(card.idLabels.split(",")).toHaveLength(2);

    const row = await ticket(p.issueId, p.destinationId);
    expect(row).toMatchObject({
      status: "ok",
      externalId: "card1",
      url: "https://trello.com/c/abc",
    });
    expect(await kinds(w.thread?.id ?? "")).toContain("ticket_created");

    // Label ids are remembered, so the next ticket does not ask Trello again.
    const [dest] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(schema.automationDestinations)
        .where(eq(schema.automationDestinations.id, p.destinationId)),
    );
    expect(dest?.config).toMatchObject({
      labelIds: { priorities: { "4": expect.any(String) }, types: { bug: expect.any(String) } },
    });
  });

  it("reuses labels that already exist on the board", async () => {
    net.reset();
    net.routes.push(({ method, url }) => {
      if (method === "GET" && url.pathname.endsWith("/labels"))
        return {
          body: [
            { id: "p4", name: "p4 high", color: "orange" },
            { id: "tb", name: "Bug", color: "blue" },
          ],
        };
      return undefined;
    }, trelloOk);
    const w = await world({ trello: true });
    await deliver()({ orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" });
    expect(net.count("POST", /^\/1\/labels$/)).toBe(0);
  });

  it("uses the labels the customer chose, and no label where they chose none (ADR 0013)", async () => {
    net.reset();
    net.routes.push(({ method, url }) => {
      if (method === "GET" && url.pathname.endsWith("/labels"))
        return {
          body: [
            { id: "high", name: "High", color: "red" },
            { id: "issue", name: "Issue", color: "blue" },
          ],
        };
      return undefined;
    }, trelloOk);
    // Priority 4 (High) -> the board's own "High" label; bug -> "Issue".
    const w = await world({
      trello: true,
      labelMap: { priorities: { "5": "high", "4": "high" }, types: { bug: "issue" } },
    });
    await deliver()({ orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" });
    expect(net.count("POST", /^\/1\/labels$/)).toBe(0);
    const card = JSON.parse(String(net.calls.find((c) => c.url.pathname === "/1/cards")?.body));
    expect(card.idLabels.split(",").sort()).toEqual(["high", "issue"]);

    // "No label" for priorities, default for types.
    net.reset();
    net.routes.push(trelloOk);
    const w2 = await world({ trello: true, labelMap: { priorities: { "4": null } } });
    await deliver()({ orgId, issueId: w2.issue?.id ?? "", destinationId: w2.trello?.dest ?? "" });
    expect(net.count("POST", /^\/1\/labels$/)).toBe(1); // only the default type label
    const card2 = JSON.parse(String(net.calls.find((c) => c.url.pathname === "/1/cards")?.body));
    expect(card2.idLabels.split(",")).toHaveLength(1);
  });

  it("a chosen label deleted from the board is skipped; the card is still created", async () => {
    net.reset();
    net.routes.push(trelloOk); // the board has no labels any more
    const w = await world({
      trello: true,
      labelMap: { priorities: { "4": "gone" }, types: { bug: "gone-too" } },
    });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" };
    await deliver()(p);
    const card = JSON.parse(String(net.calls.find((c) => c.url.pathname === "/1/cards")?.body));
    expect(card.idLabels ?? "").toBe("");
    expect(await ticket(p.issueId, p.destinationId)).toMatchObject({ status: "ok" });
  });

  it("uploads screenshots from Crisp storage, links oversize ones, and drops other hosts", async () => {
    net.reset();
    net.routes.push(trelloOk);
    net.files.set("/ok.png", new Uint8Array([1, 2, 3]));
    net.files.set("/big.png", new Uint8Array(11 * 1024 * 1024));
    conversation = conv([
      {
        fingerprint: "f1",
        timestamp: 1,
        role: "customer",
        kind: "file",
        file: { name: "ok.png", url: "https://storage.crisp.chat/ok.png", mime: "image/png" },
      },
      {
        fingerprint: "f2",
        timestamp: 2,
        role: "customer",
        kind: "file",
        file: { name: "big.png", url: "https://storage.crisp.chat/big.png", mime: "image/png" },
      },
      {
        fingerprint: "f3",
        timestamp: 3,
        role: "customer",
        kind: "file",
        file: { name: "evil.png", url: "https://evil.example.com/x.png", mime: "image/png" },
      },
      {
        fingerprint: "f4",
        timestamp: 4,
        role: "customer",
        kind: "file",
        file: {
          name: "unrelated.png",
          url: "https://storage.crisp.chat/ok.png",
          mime: "image/png",
        },
      },
    ]);
    const w = await world({ trello: true, attachmentIds: ["f1", "f2", "f3"] });
    await deliver()({ orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" });

    const posts = net.calls.filter(
      (c) => c.method === "POST" && c.url.pathname === "/1/cards/card1/attachments",
    );
    expect(posts).toHaveLength(2); // one upload + one link
    expect(posts.filter((c) => c.body instanceof FormData)).toHaveLength(1);
    const link = posts.find((c) => typeof c.body === "string");
    expect(JSON.parse(String(link?.body)).url).toBe("https://storage.crisp.chat/big.png");
    expect(net.calls.some((c) => c.url.hostname === "evil.example.com")).toBe(false);
    expect(await kinds(w.thread?.id ?? "")).toContain("attachment_linked");
    conversation = conv();
  });

  it("a deleted list marks the ticket broken and is never recreated", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "POST" && url.pathname === "/1/cards" ? { status: 404 } : undefined,
      trelloOk,
    );
    const w = await world({ trello: true });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" };
    await deliver()(p);
    expect((await ticket(p.issueId, p.destinationId))?.status).toBe("broken");
    net.reset();
    net.routes.push(trelloOk);
    await deliver()(p);
    expect(net.count("POST", /^\/1\/cards$/)).toBe(0);
  });

  it("a revoked token pauses the connection and does not retry", async () => {
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "POST" && url.pathname === "/1/cards" ? { status: 401 } : undefined,
      trelloOk,
    );
    const w = await world({ trello: true });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" };
    await deliver()(p);
    expect((await ticket(p.issueId, p.destinationId))?.status).toBe("failed");
    const [conn] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.id, w.trello?.conn ?? "")),
    );
    expect(conn?.status).toBe("revoked");
  });
});

describe("Jira delivery", () => {
  it("creates the issue, then sets priority and due date by editing", async () => {
    net.reset();
    net.routes.push(jiraOk);
    const w = await world({ jira: true, dueDate: "2026-11-02" });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.jira?.dest ?? "" };
    await deliver()(p);

    const create = JSON.parse(
      String(net.calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/issue"))?.body),
    );
    expect(create.fields).toMatchObject({
      project: { key: "TF" },
      issuetype: { id: "10001" },
      labels: ["from-chat", "bug"],
    });
    expect(create.fields.description.type).toBe("doc");
    const edits = net.calls
      .filter((c) => c.method === "PUT")
      .map((c) => JSON.parse(String(c.body)));
    expect(edits).toContainEqual({ fields: { priority: { id: "2" } } });
    expect(edits).toContainEqual({ fields: { duedate: "2026-11-02" } });
    expect(await ticket(p.issueId, p.destinationId)).toMatchObject({
      status: "ok",
      externalKey: "TF-7",
      url: "https://x.atlassian.net/browse/TF-7",
    });
  });

  it("uses the customer's label for the type, or none (ADR 0013)", async () => {
    net.reset();
    net.routes.push(jiraOk);
    const w = await world({ jira: true, typeLabels: { bug: "customer-bug" } });
    await deliver()({ orgId, issueId: w.issue?.id ?? "", destinationId: w.jira?.dest ?? "" });
    const body = (calls: typeof net.calls) =>
      JSON.parse(
        String(calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/issue"))?.body),
      );
    expect(body(net.calls).fields.labels).toEqual(["from-chat", "customer-bug"]);

    net.reset();
    net.routes.push(jiraOk);
    const w2 = await world({ jira: true, typeLabels: { bug: null } });
    await deliver()({ orgId, issueId: w2.issue?.id ?? "", destinationId: w2.jira?.dest ?? "" });
    expect(body(net.calls).fields.labels).toEqual(["from-chat"]);
  });

  it("falls back to a label when the project refuses a priority", async () => {
    net.reset();
    net.routes.push(
      ({ method, body }) =>
        method === "PUT" && String(body).includes('"priority"') ? { status: 400 } : undefined,
      jiraOk,
    );
    const w = await world({ jira: true });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.jira?.dest ?? "" };
    await deliver()(p);
    expect((await ticket(p.issueId, p.destinationId))?.status).toBe("ok");
    expect(net.calls.some((c) => c.method === "PUT" && String(c.body).includes("priority-4"))).toBe(
      true,
    );
    expect(await kinds(w.thread?.id ?? "")).toContain("priority_label");
  });

  it("an unmapped issue type fails clearly without calling Jira", async () => {
    net.reset();
    net.routes.push(jiraOk);
    const w = await world({ jira: true });
    await withOrg(db, orgId, (tx) =>
      tx
        .update(schema.issues)
        .set({ type: "security" })
        .where(eq(schema.issues.id, w.issue?.id ?? "")),
    );
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.jira?.dest ?? "" };
    await deliver()(p);
    expect((await ticket(p.issueId, p.destinationId))?.status).toBe("failed");
    expect(net.calls.some((c) => c.url.pathname.endsWith("/issue"))).toBe(false);
  });
});

describe("Linear delivery", () => {
  it("creates one issue in the Triage inbox with priority, due date and labels (ADR 0016)", async () => {
    net.reset();
    net.routes.push(linearOk());
    const w = await world({ linear: {}, dueDate: "2026-12-04" });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.linear?.dest ?? "" };
    await deliver()(p);
    await deliver()(p); // a retried job never creates a second issue

    expect(net.calls.filter((c) => String(c.body).includes("issueCreate"))).toHaveLength(1);
    const input = linearCreate();
    expect(input).toMatchObject({
      teamId: "TEAM",
      title: "Checkout fails on Safari",
      priority: 2, // P4 -> High
      dueDate: "2026-12-04",
      stateId: "S-triage",
    });
    // "from-chat" already existed; the "Bug" type label was created on the team.
    expect(input.labelIds).toEqual(["L-chat", "L-Bug"]);
    expect(input).not.toHaveProperty("projectId");
    expect(await ticket(p.issueId, p.destinationId)).toMatchObject({
      status: "ok",
      externalId: "ISS",
      externalKey: "ACME-12",
      url: "https://linear.app/acme/issue/ACME-12",
    });
  });

  it("uses the chosen state, project and type label; no triage means Linear's default", async () => {
    net.reset();
    net.routes.push(linearOk());
    const w = await world({
      linear: { stateId: "S-backlog", projectId: "P1", typeLabels: { bug: "from-chat" } },
    });
    await deliver()({ orgId, issueId: w.issue?.id ?? "", destinationId: w.linear?.dest ?? "" });
    expect(linearCreate()).toMatchObject({
      stateId: "S-backlog",
      projectId: "P1",
      labelIds: ["L-chat"],
    });

    net.reset();
    net.routes.push(linearOk({ triage: false }));
    const w2 = await world({ linear: { projectId: "gone", typeLabels: { bug: null } } });
    await deliver()({ orgId, issueId: w2.issue?.id ?? "", destinationId: w2.linear?.dest ?? "" });
    const input = linearCreate();
    expect(input).not.toHaveProperty("stateId");
    expect(input).not.toHaveProperty("projectId"); // a project that no longer exists is skipped
    expect(input.labelIds).toEqual(["L-chat"]);
  });

  it("uploads the customer's screenshot server side and posts it in one comment", async () => {
    net.reset();
    net.routes.push(linearOk());
    net.files.set("/shot.png", new Uint8Array([1, 2, 3]));
    conversation = conv([
      {
        fingerprint: "s1",
        timestamp: 1,
        role: "customer",
        kind: "file",
        file: { name: "shot.png", url: "https://storage.crisp.chat/shot.png", mime: "image/png" },
      },
    ]);
    const w = await world({ linear: {}, attachmentIds: ["s1"] });
    await deliver()({ orgId, issueId: w.issue?.id ?? "", destinationId: w.linear?.dest ?? "" });
    conversation = conv();
    const put = net.calls.find((c) => c.url.hostname === "uploads.example");
    expect(put?.method).toBe("PUT");
    const comment = net.calls.find((c) => String(c.body).includes("commentCreate"));
    expect(String(comment?.body)).toContain("![shot.png](https://uploads.linear.app/asset-1)");
  });

  it("a refused token pauses the Linear connection and tells the owner", async () => {
    net.reset();
    net.routes.push((r) =>
      r.url.hostname === "api.linear.app"
        ? {
            status: 400,
            body: { errors: [{ message: "auth", extensions: { code: "AUTHENTICATION_ERROR" } }] },
          }
        : undefined,
    );
    const w = await world({ linear: {} });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.linear?.dest ?? "" };
    await deliver()(p);
    expect((await ticket(p.issueId, p.destinationId))?.status).toBe("failed");
    const [conn] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.id, w.linear?.conn ?? "")),
    );
    expect(conn?.status).toBe("revoked");
    expect(revoked.some((r) => r.id === w.linear?.conn)).toBe(true);
  });
});

describe("fan-out and gating", () => {
  it("Trello down does not stop Jira; only the failed one is retried", async () => {
    net.reset();
    net.routes.push(
      ({ url }) => (url.hostname === "api.trello.com" ? { status: 503 } : undefined),
      jiraOk,
    );
    const w = await world({ trello: true, jira: true });
    const issueId = w.issue?.id ?? "";
    const trelloP = { orgId, issueId, destinationId: w.trello?.dest ?? "" };
    const jiraP = { orgId, issueId, destinationId: w.jira?.dest ?? "" };

    await expect(deliver()(trelloP)).rejects.toThrow(); // retried by the queue
    await deliver()(jiraP);
    expect((await ticket(issueId, jiraP.destinationId))?.status).toBe("ok");
    expect((await ticket(issueId, trelloP.destinationId))?.status).not.toBe("ok");

    net.reset();
    net.routes.push(trelloOk);
    await deliver()(trelloP); // the retry
    expect((await ticket(issueId, trelloP.destinationId))?.status).toBe("ok");
    expect(net.count("POST", /\/issue$/)).toBe(0); // Jira was not touched again
  });

  it("gives up after the final attempt and records why", async () => {
    net.reset();
    net.routes.push(({ url }) => (url.hostname === "api.trello.com" ? { status: 503 } : undefined));
    const w = await world({ trello: true });
    const p = { orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" };
    await expect(deliver()(p, { finalAttempt: true })).rejects.toThrow();
    const row = await ticket(p.issueId, p.destinationId);
    expect(row?.status).toBe("failed");
    expect(await kinds(w.thread?.id ?? "")).toContain("delivery_failed");
  });

  it("does not deliver issues waiting for review", async () => {
    net.reset();
    net.routes.push(trelloOk);
    const w = await world({ trello: true, status: "pending_review" });
    await deliver()({ orgId, issueId: w.issue?.id ?? "", destinationId: w.trello?.dest ?? "" });
    expect(net.calls).toHaveLength(0);
  });

  it("will not use another automation's destination", async () => {
    net.reset();
    net.routes.push(trelloOk);
    const a = await world({ trello: true });
    const b = await world({ trello: true });
    await deliver()({ orgId, issueId: a.issue?.id ?? "", destinationId: b.trello?.dest ?? "" });
    expect(net.calls).toHaveLength(0);
  });
});

describe("revoking a tool in the middle of a run", () => {
  it("pauses cleanly: the owner is told once, nothing is lost, and a retry after reconnecting finishes the job", async () => {
    net.reset();
    net.routes.push(trelloOk);
    revoked.length = 0;
    const w = await world({ trello: true });
    const dest = w.trello?.dest ?? "";
    const first = { orgId, issueId: w.issue?.id ?? "", destinationId: dest };
    await deliver()(first); // delivered before the revocation
    expect((await ticket(first.issueId, dest))?.status).toBe("ok");

    // A second ticket from the same automation, and then Trello stops accepting our token.
    const [second] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.issues)
        .values({
          orgId,
          automationId: w.issue?.automationId ?? "",
          originThreadId: w.thread?.id ?? "",
          title: "Second bug",
          summary: "s",
          bodyMd: "## Summary\nx",
          type: "bug",
          priority: 2,
          confidence: 0.9,
        })
        .returning(),
    );
    const secondP = { orgId, issueId: second?.id ?? "", destinationId: dest };
    net.reset();
    net.routes.push(
      ({ method, url }) =>
        method === "POST" && url.pathname === "/1/cards" ? { status: 401 } : undefined,
      trelloOk,
    );
    await deliver()(secondP);
    await deliver()({ ...secondP }); // running it again must not tell the owner a second time

    expect((await ticket(secondP.issueId, dest))?.status).toBe("failed");
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({ orgId, id: w.trello?.conn, provider: "trello" });
    const [conn] = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.id, w.trello?.conn ?? "")),
    );
    expect(conn?.status).toBe("revoked");

    // The person reconnects; "try again" sends the ticket that did not arrive, and the first one is untouched.
    await withOrg(db, orgId, (tx) =>
      tx
        .update(schema.connections)
        .set({ status: "active", statusDetail: null })
        .where(eq(schema.connections.id, w.trello?.conn ?? "")),
    );
    net.reset();
    net.routes.push(trelloOk);
    await deliver()(secondP);
    expect((await ticket(secondP.issueId, dest))?.status).toBe("ok");
    expect(net.count("POST", /^\/1\/cards$/)).toBe(1); // only the second ticket was created now
  });
});

import { randomUUID } from "node:crypto";
import { generateKeyPair, openSecret, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { createDb, eq, schema, withOrg } from "@triagefox/db";
import { RpcError } from "@triagefox/rpc";
import type { RpcHandlers } from "@triagefox/rpc/server";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "./context";
import { createHandlers } from "./handlers";

const db = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
const orgA = `org_a_${randomUUID()}`;
const orgB = `org_b_${randomUUID()}`;
let keyring: PrivateKeyring;

type Routes = (url: URL, init: RequestInit) => { status?: number; body?: unknown } | undefined;
function fakeFetch(routes: Routes) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = routes(url, init) ?? { status: 404, body: {} };
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
    });
  }) as typeof fetch;
  return { fn, calls };
}

function makeHandlers(fetchImpl: typeof fetch): RpcHandlers {
  const ctx: Ctx = {
    db,
    redis,
    keyring,
    fetch: fetchImpl,
    log: { info() {}, warn() {}, error() {} },
    config: {
      NODE_ENV: "test",
      APP_MODE: "hosted",
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "",
      REDIS_URL: "",
      CRYPTO_PUBLIC_KEYS: "{}",
      CRYPTO_CURRENT_VERSION: 1,
      CRYPTO_PRIVATE_KEYS: "{}",
      AI_MODEL_DEFAULT: "a",
      AI_MODEL_ESCALATION: "b",
      AI_MODEL_EMBEDDING: "c",
      TRELLO_API_KEY: "TRELLO_APP_KEY",
      ATLASSIAN_CLIENT_ID: "cid",
      ATLASSIAN_CLIENT_SECRET: "csecret",
      LINEAR_CLIENT_ID: "lid",
      LINEAR_CLIENT_SECRET: "lsecret",
      CRISP_PLUGIN_ID: "ident",
      CRISP_PLUGIN_KEY: "pkey",
      CRISP_PLUGIN_UUID: "plugin-uuid",
      keyring,
    } as Ctx["config"],
  };
  return createHandlers(ctx);
}

async function insertConnection(
  orgId: string,
  provider: "trello" | "jira" | "linear" | "crisp",
  creds: unknown | null,
  extra: Partial<typeof schema.connections.$inferInsert> = {},
) {
  const id = randomUUID();
  const sealed = creds
    ? await sealSecret(
        JSON.stringify(creds),
        { orgId, recordId: id, purpose: "connection.credentials" },
        keyring,
      )
    : null;
  await withOrg(db, orgId, (tx) =>
    tx.insert(schema.connections).values({
      id,
      orgId,
      provider,
      authType: "token",
      credentialsSealed: sealed,
      status: "pending",
      ...extra,
    }),
  );
  return id;
}
const getConn = (orgId: string, id: string) =>
  withOrg(db, orgId, (tx) =>
    tx.select().from(schema.connections).where(eq(schema.connections.id, id)),
  ).then((r) => r[0]);

beforeAll(async () => {
  const kp = await generateKeyPair();
  keyring = {
    currentVersion: 1,
    publicKeys: { 1: kp.publicKey },
    privateKeys: { 1: kp.privateKey },
  };
});
afterAll(async () => {
  for (const org of [orgA, orgB]) await withOrg(db, org, (tx) => tx.delete(schema.connections));
  await db.$client.end();
  redis.disconnect();
});

describe("trello", () => {
  it("verifies a token, activates the connection and keeps the token out of metadata", async () => {
    const id = await insertConnection(orgA, "trello", { token: "TRELLO-SECRET-TOKEN" });
    const f = fakeFetch((url) =>
      url.pathname === "/1/members/me"
        ? { body: { id: "m1", username: "kartik", fullName: "Kartik" } }
        : undefined,
    );
    const out = await makeHandlers(f.fn)["trello.verify"]({ orgId: orgA, connectionId: id });
    expect(out).toEqual({ username: "kartik", fullName: "Kartik" });
    const row = await getConn(orgA, id);
    expect(row?.status).toBe("active");
    expect(JSON.stringify(row?.metadata)).not.toContain("TRELLO-SECRET-TOKEN");
    expect(row?.credentialsSealed).not.toContain("TRELLO-SECRET-TOKEN");
    // the call used our platform key + the decrypted customer token
    expect(f.calls[0]?.url.searchParams.get("token")).toBe("TRELLO-SECRET-TOKEN");
    expect(f.calls[0]?.url.searchParams.get("key")).toBe("TRELLO_APP_KEY");
  });

  it("deletes a pending connection whose token Trello rejects", async () => {
    const id = await insertConnection(orgA, "trello", { token: "bad" });
    const f = fakeFetch(() => ({ status: 401, body: {} }));
    await expect(
      makeHandlers(f.fn)["trello.verify"]({ orgId: orgA, connectionId: id }),
    ).rejects.toMatchObject({ code: "auth_expired" });
    expect(await getConn(orgA, id)).toBeUndefined();
  });

  it("marks an active connection revoked when Trello stops accepting the token", async () => {
    const id = await insertConnection(orgA, "trello", { token: "t" }, { status: "active" });
    const f = fakeFetch(() => ({ status: 401, body: {} }));
    await expect(
      makeHandlers(f.fn)["trello.listBoards"]({ orgId: orgA, connectionId: id }),
    ).rejects.toMatchObject({ code: "auth_expired" });
    expect((await getConn(orgA, id))?.status).toBe("revoked");
  });

  it("lists open boards", async () => {
    const id = await insertConnection(orgA, "trello", { token: "t" }, { status: "active" });
    const f = fakeFetch((url) =>
      url.pathname.endsWith("/boards")
        ? {
            body: [
              { id: "b1", name: "TriageFox", closed: false },
              { id: "b2", name: "Old", closed: true },
            ],
          }
        : undefined,
    );
    expect(
      await makeHandlers(f.fn)["trello.listBoards"]({ orgId: orgA, connectionId: id }),
    ).toEqual({ boards: [{ id: "b1", name: "TriageFox" }] });
  });

  it("another workspace cannot use this connection", async () => {
    const id = await insertConnection(orgA, "trello", { token: "t" }, { status: "active" });
    const f = fakeFetch(() => ({ body: [] }));
    await expect(
      makeHandlers(f.fn)["trello.listBoards"]({ orgId: orgB, connectionId: id }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.calls).toHaveLength(0); // never even reached Trello
  });

  it("disconnect revokes the token at Trello and deletes our copy", async () => {
    const id = await insertConnection(orgA, "trello", { token: "REVOKE-ME" }, { status: "active" });
    const f = fakeFetch(() => ({ body: "" }));
    expect(
      await makeHandlers(f.fn)["connection.disconnect"]({ orgId: orgA, connectionId: id }),
    ).toEqual({ revoked: true });
    expect(f.calls[0]?.init.method).toBe("DELETE");
    expect(f.calls[0]?.url.pathname).toBe("/1/tokens/REVOKE-ME");
    expect(await getConn(orgA, id)).toBeUndefined();
  });

  it("disconnect still deletes our copy when Trello is unreachable", async () => {
    const id = await insertConnection(orgA, "trello", { token: "t" }, { status: "active" });
    const f = fakeFetch(() => ({ status: 503, body: {} }));
    expect(
      await makeHandlers(f.fn)["connection.disconnect"]({ orgId: orgA, connectionId: id }),
    ).toEqual({ revoked: false });
    expect(await getConn(orgA, id)).toBeUndefined();
  });
});

describe("jira", () => {
  const atlassian =
    (state: { refreshes: number }): Routes =>
    (url, init) => {
      if (url.pathname === "/oauth/token") {
        const body = JSON.parse(String(init.body));
        if (body.grant_type === "authorization_code")
          return {
            body: { access_token: "ACCESS-1", refresh_token: "REFRESH-1", expires_in: 3600 },
          };
        state.refreshes++;
        return {
          body: {
            access_token: `ACCESS-${state.refreshes + 1}`,
            refresh_token: `REFRESH-${state.refreshes + 1}`,
            expires_in: 3600,
          },
        };
      }
      if (url.pathname === "/oauth/token/accessible-resources")
        return { body: [{ id: "cloud-1", name: "Acme", url: "https://acme.atlassian.net" }] };
      if (url.pathname.endsWith("/project/search"))
        return { body: { values: [{ id: "1", key: "KAN", name: "Kanban" }], isLast: true } };
      return undefined;
    };

  it("exchanges the one-time code, seals the tokens and lists the site", async () => {
    const id = await insertConnection(orgA, "jira", { code: "ONE-TIME-CODE" });
    const state = { refreshes: 0 };
    const out = await makeHandlers(fakeFetch(atlassian(state)).fn)["jira.complete"]({
      orgId: orgA,
      connectionId: id,
    });
    expect(out.sites[0]?.name).toBe("Acme");
    const row = await getConn(orgA, id);
    expect(row?.status).toBe("active");
    expect(row?.metadata.cloudId).toBe("cloud-1");
    expect(JSON.stringify(row?.metadata)).not.toMatch(/ACCESS-1|REFRESH-1/);
    const tokens = JSON.parse(
      await openSecret(
        row?.credentialsSealed ?? "",
        { orgId: orgA, recordId: id, purpose: "connection.credentials" },
        keyring,
      ),
    );
    expect(tokens.refreshToken).toBe("REFRESH-1");
  });

  it("removes the connection when the code exchange fails", async () => {
    const id = await insertConnection(orgA, "jira", { code: "bad" });
    const f = fakeFetch(() => ({ status: 403, body: {} }));
    await expect(
      makeHandlers(f.fn)["jira.complete"]({ orgId: orgA, connectionId: id }),
    ).rejects.toBeInstanceOf(RpcError);
    expect(await getConn(orgA, id)).toBeUndefined();
  });

  it("refreshes an expired token once, even when requests arrive together, and keeps the newest refresh token", async () => {
    const id = await insertConnection(
      orgA,
      "jira",
      { accessToken: "OLD", refreshToken: "REFRESH-0", expiresAt: Date.now() - 1000 },
      {
        status: "active",
        metadata: { sites: [{ id: "cloud-1", name: "Acme", url: "u" }], cloudId: "cloud-1" },
      },
    );
    const state = { refreshes: 0 };
    const h = makeHandlers(fakeFetch(atlassian(state)).fn);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        h["jira.listProjects"]({ orgId: orgA, connectionId: id, cloudId: "cloud-1" }),
      ),
    );
    expect(results.every((r) => r.projects[0]?.key === "KAN")).toBe(true);
    expect(state.refreshes).toBe(1); // rotating refresh tokens must never be used twice
    const row = await getConn(orgA, id);
    const tokens = JSON.parse(
      await openSecret(
        row?.credentialsSealed ?? "",
        { orgId: orgA, recordId: id, purpose: "connection.credentials" },
        keyring,
      ),
    );
    expect(tokens.refreshToken).toBe("REFRESH-2");
  });

  it("marks the connection revoked when Atlassian refuses the refresh token", async () => {
    const id = await insertConnection(
      orgA,
      "jira",
      { accessToken: "OLD", refreshToken: "dead", expiresAt: Date.now() - 1000 },
      { status: "active", metadata: { sites: [{ id: "cloud-1", name: "A", url: "u" }] } },
    );
    const f = fakeFetch(() => ({ status: 403, body: {} }));
    await expect(
      makeHandlers(f.fn)["jira.listProjects"]({
        orgId: orgA,
        connectionId: id,
        cloudId: "cloud-1",
      }),
    ).rejects.toMatchObject({ code: "auth_expired" });
    expect((await getConn(orgA, id))?.status).toBe("revoked");
  });

  it("refuses a site that is not part of the connection", async () => {
    const id = await insertConnection(
      orgA,
      "jira",
      { accessToken: "A", refreshToken: "R", expiresAt: Date.now() + 3_600_000 },
      { status: "active", metadata: { sites: [{ id: "cloud-1" }] } },
    );
    await expect(
      makeHandlers(fakeFetch(() => undefined).fn)["jira.listProjects"]({
        orgId: orgA,
        connectionId: id,
        cloudId: "someone-elses",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("linear", () => {
  const linear =
    (calls: string[]): Routes =>
    (url, init) => {
      if (url.pathname === "/oauth/token")
        return { body: { access_token: "LA-1", refresh_token: "LR-1", expires_in: 86399 } };
      if (url.pathname === "/oauth/revoke") {
        calls.push(String(init.body));
        return { body: {} };
      }
      if (url.pathname === "/graphql") {
        const q = String(init.body);
        if (q.includes("organization"))
          return { body: { data: { organization: { id: "O", name: "Acme", urlKey: "acme" } } } };
        if (q.includes("viewer")) return { body: { data: { viewer: { id: "APPUSER" } } } };
      }
      return undefined;
    };

  it("exchanges the one-time code, seals the tokens and remembers its own app user", async () => {
    const id = await insertConnection(orgA, "linear", { code: "ONE-TIME-CODE" });
    const out = await makeHandlers(fakeFetch(linear([])).fn)["linear.complete"]({
      orgId: orgA,
      connectionId: id,
    });
    expect(out).toEqual({ workspaceName: "Acme", urlKey: "acme" });
    const row = await getConn(orgA, id);
    expect(row?.status).toBe("active");
    expect(row?.metadata).toMatchObject({ workspaceName: "Acme", appUserId: "APPUSER" });
    expect(JSON.stringify(row?.metadata)).not.toMatch(/LA-1|LR-1/);
    const tokens = JSON.parse(
      await openSecret(
        row?.credentialsSealed ?? "",
        { orgId: orgA, recordId: id, purpose: "connection.credentials" },
        keyring,
      ),
    );
    expect(tokens).toMatchObject({ accessToken: "LA-1", refreshToken: "LR-1" });
  });

  it("removes the connection when Linear refuses the code (e.g. not an admin)", async () => {
    const id = await insertConnection(orgA, "linear", { code: "bad" });
    const f = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await expect(
      makeHandlers(f.fn)["linear.complete"]({ orgId: orgA, connectionId: id }),
    ).rejects.toBeInstanceOf(RpcError);
    expect(await getConn(orgA, id)).toBeUndefined();
  });

  it("disconnect revokes the grant at Linear and deletes our copy", async () => {
    const id = await insertConnection(
      orgA,
      "linear",
      { accessToken: "LA", refreshToken: "LR-9", expiresAt: Date.now() + 60_000_000 },
      { status: "active" },
    );
    const calls: string[] = [];
    const out = await makeHandlers(fakeFetch(linear(calls)).fn)["connection.disconnect"]({
      orgId: orgA,
      connectionId: id,
    });
    expect(out.revoked).toBe(true);
    expect(calls[0]).toContain("token=LR-9");
    expect(await getConn(orgA, id)).toBeUndefined();
  });
});

describe("crisp", () => {
  it("accepts the token Crisp issued and rejects any other", async () => {
    const f = fakeFetch((url) => {
      if (url.pathname.endsWith("/settings"))
        return { body: { data: { token: "the-real-token" } } };
      if (url.pathname.startsWith("/v1/website/"))
        return { body: { data: { name: "TriageFox Dev" } } };
      return undefined;
    });
    const h = makeHandlers(f.fn);
    expect(await h["crisp.verifyWebsite"]({ websiteId: "w", token: "the-real-token" })).toEqual({
      valid: true,
      websiteName: "TriageFox Dev",
    });
    expect(await h["crisp.verifyWebsite"]({ websiteId: "w", token: "forged-token!" })).toEqual({
      valid: false,
    });
  });

  it("reports not-installed websites as invalid, and Crisp outages as errors", async () => {
    expect(
      await makeHandlers(fakeFetch(() => ({ status: 404, body: {} })).fn)["crisp.verifyWebsite"]({
        websiteId: "w",
        token: "x",
      }),
    ).toEqual({ valid: false });
    await expect(
      makeHandlers(fakeFetch(() => ({ status: 500, body: {} })).fn)["crisp.verifyWebsite"]({
        websiteId: "w",
        token: "x",
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("connection.check marks a Crisp link revoked once the plugin is uninstalled", async () => {
    const id = await insertConnection(orgA, "crisp", null, {
      status: "active",
      authType: "plugin_install",
      metadata: { websiteId: `site-${randomUUID()}` },
    });
    const out = await makeHandlers(fakeFetch(() => ({ status: 404, body: {} })).fn)[
      "connection.check"
    ]({ orgId: orgA, connectionId: id });
    expect(out.status).toBe("revoked");
    expect((await getConn(orgA, id))?.status).toBe("revoked");
  });
});

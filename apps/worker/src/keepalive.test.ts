import { randomUUID } from "node:crypto";
import { generateKeyPair, openSecret, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { createDb, eq, schema, withOrg } from "@triagefox/db";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keepConnectionsAlive } from "./keepalive";
import type { Ctx } from "./rpc/context";

const db = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
const org = `org_keepalive_${randomUUID()}`;
const DAY = 24 * 60 * 60 * 1000;
let keyring: PrivateKeyring;

beforeAll(async () => {
  const kp = await generateKeyPair();
  keyring = {
    currentVersion: 1,
    publicKeys: { 1: kp.publicKey },
    privateKeys: { 1: kp.privateKey },
  };
});
afterAll(async () => {
  await withOrg(db, org, (tx) => tx.delete(schema.connections));
  await db.$client.end();
  redis.disconnect();
});

/** Atlassian stand-in: refuses the refresh token "dead", rotates every other one. */
function atlassian() {
  const used: string[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname !== "/oauth/token") return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init.body));
    used.push(body.refresh_token);
    if (body.refresh_token === "dead") return new Response("{}", { status: 403 });
    return new Response(
      JSON.stringify({
        access_token: "NEW",
        refresh_token: `${body.refresh_token}-next`,
        expires_in: 3600,
      }),
    );
  }) as typeof fetch;
  return { fn, used };
}

function makeCtx(fetchImpl: typeof fetch, revoked: string[]): Ctx {
  return {
    db,
    redis,
    keyring,
    fetch: fetchImpl,
    log: { info() {}, warn() {}, error() {} },
    onRevoked: async (c) => {
      revoked.push(c.id);
    },
    config: {
      APP_URL: "http://localhost:3000",
      ATLASSIAN_CLIENT_ID: "cid",
      ATLASSIAN_CLIENT_SECRET: "csecret",
      keyring,
    } as Ctx["config"],
  };
}

async function jira(tokens: Record<string, unknown>, status: "active" | "revoked" = "active") {
  const id = randomUUID();
  const sealed = await sealSecret(
    JSON.stringify(tokens),
    { orgId: org, recordId: id, purpose: "connection.credentials" },
    keyring,
  );
  await withOrg(db, org, (tx) =>
    tx.insert(schema.connections).values({
      id,
      orgId: org,
      provider: "jira",
      authType: "oauth",
      credentialsSealed: sealed,
      status,
    }),
  );
  return id;
}

async function stored(id: string) {
  const [row] = await withOrg(db, org, (tx) =>
    tx.select().from(schema.connections).where(eq(schema.connections.id, id)),
  );
  const tokens = JSON.parse(
    await openSecret(
      row?.credentialsSealed ?? "",
      { orgId: org, recordId: id, purpose: "connection.credentials" },
      keyring,
    ),
  );
  return { status: row?.status, tokens };
}

describe("connection keep-alive", () => {
  it("refreshes week-old and legacy Jira tokens, leaves recent ones, and revokes refused ones", async () => {
    const fresh = Date.now() + 30 * 60 * 1000; // access token still valid
    const old = await jira({
      accessToken: "A",
      refreshToken: "old",
      expiresAt: fresh,
      refreshedAt: Date.now() - 8 * DAY,
    });
    const legacy = await jira({ accessToken: "A", refreshToken: "legacy", expiresAt: fresh });
    const recent = await jira({
      accessToken: "A",
      refreshToken: "recent",
      expiresAt: fresh,
      refreshedAt: Date.now() - DAY,
    });
    const dead = await jira({
      accessToken: "A",
      refreshToken: "dead",
      expiresAt: fresh,
      refreshedAt: Date.now() - 8 * DAY,
    });
    const off = await jira(
      { accessToken: "A", refreshToken: "off", expiresAt: fresh, refreshedAt: 0 },
      "revoked",
    );

    const fake = atlassian();
    const revoked: string[] = [];
    await keepConnectionsAlive(makeCtx(fake.fn, revoked));

    for (const id of [old, legacy]) {
      const s = await stored(id);
      expect(s.status).toBe("active");
      expect(s.tokens.refreshToken).toMatch(/-next$/); // the rotated token is the one kept
      expect(s.tokens.refreshedAt).toBeGreaterThan(Date.now() - 60_000);
    }
    expect((await stored(recent)).tokens.refreshToken).toBe("recent");
    expect(fake.used).not.toContain("recent");
    expect(fake.used).not.toContain("off"); // revoked connections are left alone
    expect((await stored(dead)).status).toBe("revoked");
    expect(revoked).toContain(dead); // the owners are told once, via the usual path
  });

  it("does not refresh again on the next day's run", async () => {
    const id = await jira({
      accessToken: "A",
      refreshToken: "again",
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    const fake = atlassian();
    await keepConnectionsAlive(makeCtx(fake.fn, []));
    await keepConnectionsAlive(makeCtx(fake.fn, []));
    expect(fake.used.filter((t) => t.startsWith("again"))).toEqual(["again"]);
    expect((await stored(id)).tokens.refreshToken).toBe("again-next");
  });
});

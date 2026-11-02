import { createHmac } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { CrispPluginClient } from "@triagefox/connectors";
import { eq, schema } from "@triagefox/db";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  closeOwnerDb,
  crispWebsiteInRealUse,
  ownerDb,
  REAL_USE_REASON,
  removeTestCrispLinks,
} from "./db";
import { newUser, signUpWithWorkspace } from "./helpers";

const env = process.env;
const SECRET = env.CRISP_HOOK_SECRET as string;
const hasCrisp = !!(
  env.CRISP_PLUGIN_ID &&
  env.CRISP_PLUGIN_KEY &&
  env.CRISP_PLUGIN_UUID &&
  env.CRISP_WEBSITE_ID
);

test.describe.configure({ mode: "serial" });

let orgId: string;
const redis = new Redis(env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
const queue = new Queue("pipeline", { connection: redis });
const seededWebsites: string[] = [];

const sign = (ts: string, body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(`[${ts};${body}]`).digest("hex");

/** POST a hook the way Crisp does (raw JSON body, millisecond timestamp header, HMAC signature). */
async function sendHook(
  request: APIRequestContext,
  payload: { website: string; event: string; data: Record<string, unknown> },
  opts: { ts?: number; secret?: string; tamper?: boolean; omitSignature?: boolean } = {},
) {
  const ts = String(opts.ts ?? Date.now());
  const body = JSON.stringify({
    website_id: payload.website,
    event: payload.event,
    data: payload.data,
    timestamp: Number(ts),
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-crisp-request-timestamp": ts,
  };
  if (!opts.omitSignature) headers["x-crisp-signature"] = sign(ts, body, opts.secret);
  return request.post("/api/webhooks/crisp", { data: opts.tamper ? `${body} ` : body, headers });
}

const visitorMessage = (website: string, session: string, fp: number) => ({
  website,
  event: "message:send",
  data: {
    from: "user",
    type: "text",
    session_id: session,
    fingerprint: fp,
    content: "this text must never be stored",
  },
});

async function seedWebsite(websiteId: string, quietSec: number) {
  const db = ownerDb();
  const [conn] = await db
    .insert(schema.connections)
    .values({
      orgId,
      provider: "crisp",
      authType: "plugin_install",
      status: "active",
      metadata: { websiteId },
    })
    .returning();
  const [auto] = await db
    .insert(schema.automations)
    .values({
      orgId,
      sourceConnectionId: conn?.id ?? "",
      name: "e2e",
      enabled: true,
      settings: {
        includeSourceLink: false,
        includeCustomerNames: false,
        minConfidence: 0.7,
        quietWindowSec: quietSec,
        timezone: "UTC",
        language: "en",
      },
    })
    .returning();
  seededWebsites.push(websiteId);
  return { connectionId: conn?.id ?? "", automationId: auto?.id ?? "" };
}

const eventsFor = (websiteId: string) =>
  ownerDb()
    .select()
    .from(schema.sourceEvents)
    .where(eq(schema.sourceEvents.orgId, orgId))
    .then((rows) => rows.filter((r) => (r.meta as { websiteId?: string }).websiteId === websiteId));
const threadsOf = (session: string) =>
  ownerDb().select().from(schema.threads).where(eq(schema.threads.sourceId, session));

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const workspace = `Hooks ${Date.now()}`;
  await signUpWithWorkspace(page, newUser("Hooks"), workspace);
  const [org] = await ownerDb()
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.name, workspace));
  if (!org) throw new Error("workspace not found");
  orgId = org.id;
});

test.afterAll(async () => {
  // Remove what the tests created (connections cascade to automations, threads and events) and any pending jobs.
  const threads = await ownerDb()
    .select()
    .from(schema.threads)
    .where(eq(schema.threads.orgId, orgId));
  for (const t of threads) await (await queue.getJob(`evaluate_${t.id}`))?.remove().catch(() => {});
  await ownerDb().delete(schema.connections).where(eq(schema.connections.orgId, orgId));
  await queue.close();
  redis.disconnect();
  await closeOwnerDb();
});

test("the hook endpoint refuses anything that isn't a fresh, correctly signed Crisp delivery", async ({
  request,
}) => {
  const site = crypto.randomUUID();
  await seedWebsite(site, 600);
  const session = `session_${crypto.randomUUID()}`;
  const msg = visitorMessage(site, session, 1);

  expect((await sendHook(request, msg, { omitSignature: true })).status()).toBe(401);
  expect((await sendHook(request, msg, { secret: "not-the-secret" })).status()).toBe(401);
  expect((await sendHook(request, msg, { tamper: true })).status()).toBe(401);
  expect((await sendHook(request, msg, { ts: Date.now() - 10 * 60_000 })).status()).toBe(401); // replay of an old delivery
  expect((await sendHook(request, msg, { ts: Math.floor(Date.now() / 1000) })).status()).toBe(401); // seconds instead of ms
  const huge = await request.post("/api/webhooks/crisp", {
    data: "x".repeat(300_000),
    headers: { "content-type": "application/json" },
  });
  expect(huge.status()).toBe(413);

  // None of them left a trace.
  expect(await eventsFor(site)).toHaveLength(0);
  expect(await threadsOf(session)).toHaveLength(0);
  // The refusal says nothing about why.
  const bad = await sendHook(request, msg, { secret: "nope" });
  expect(await bad.json()).toEqual({ ok: false });
});

test("a signed hook for a website nobody linked is acknowledged and stores nothing", async ({
  request,
}) => {
  const stranger = crypto.randomUUID();
  const res = await sendHook(
    request,
    visitorMessage(stranger, `session_${crypto.randomUUID()}`, 1),
  );
  expect(res.status()).toBe(200);
  expect(await eventsFor(stranger)).toHaveLength(0);
});

test("a customer message becomes one waiting evaluation, however often Crisp delivers it", async ({
  request,
}) => {
  const site = crypto.randomUUID();
  const { automationId } = await seedWebsite(site, 600);
  const session = `session_${crypto.randomUUID()}`;
  const msg = visitorMessage(site, session, 42);
  const ts = Date.now();

  for (let i = 0; i < 3; i++) expect((await sendHook(request, msg, { ts })).status()).toBe(200); // identical redeliveries
  const events = await eventsFor(site);
  expect(events).toHaveLength(1);
  expect(events[0]?.status).toBe("received");

  const [thread] = await threadsOf(session);
  expect(thread?.automationId).toBe(automationId);
  expect(thread?.orgId).toBe(orgId);
  const job = await queue.getJob(`evaluate_${thread?.id}`);
  expect(await job?.getState()).toBe("delayed");
  expect(job?.delay).toBe(600_000);

  // More messages in the same conversation keep one thread and one pending job.
  for (const fp of [43, 44, 45]) await sendHook(request, visitorMessage(site, session, fp));
  expect(await threadsOf(session)).toHaveLength(1);
  expect((await queue.getDelayed()).filter((j) => j.id === `evaluate_${thread?.id}`)).toHaveLength(
    1,
  );

  // An operator reply is context only: recorded, but it does not schedule or postpone anything.
  const reply = await sendHook(request, {
    website: site,
    event: "message:received",
    data: { from: "operator", type: "text", session_id: session, fingerprint: 50 },
  });
  expect(reply.status()).toBe(200);
  expect(
    (await eventsFor(site)).find((e) => (e.meta as { fingerprint?: string }).fingerprint === "50")
      ?.status,
  ).toBe("ignored");
});

test("only identifiers are stored: the message text is nowhere in the database", async ({
  request,
}) => {
  const site = crypto.randomUUID();
  await seedWebsite(site, 600);
  const session = `session_${crypto.randomUUID()}`;
  await sendHook(request, visitorMessage(site, session, 1));
  const everything = JSON.stringify([await eventsFor(site), await threadsOf(session)]);
  expect(everything).not.toContain("must never be stored");
  expect((await eventsFor(site))[0]?.meta).toMatchObject({
    websiteId: site,
    sessionId: session,
    event: "message:send",
    fingerprint: "1",
  });
});

test("live Crisp: a hook makes the worker fetch the real conversation, and reconcile recovers one whose hook was lost", async ({
  request,
}) => {
  test.skip(!hasCrisp, "no Crisp plugin credentials");
  test.skip(await crispWebsiteInRealUse(env.CRISP_WEBSITE_ID), REAL_USE_REASON);
  test.setTimeout(120_000);
  const websiteId = env.CRISP_WEBSITE_ID as string;
  const crisp = new CrispPluginClient({
    identifier: env.CRISP_PLUGIN_ID as string,
    key: env.CRISP_PLUGIN_KEY as string,
    pluginId: env.CRISP_PLUGIN_UUID as string,
  });

  // Real conversations of the dev website: one with a customer message (hook path), another (reconcile path).
  const convs: {
    sessionId: string;
    latest: string;
    state: string;
    customerText?: string;
    texts: string[];
  }[] = [];
  for (const ref of await crisp.listConversations(websiteId, 1)) {
    const c = await crisp.fetchConversation(websiteId, ref.sessionId);
    const latest = c.messages.filter((m) => m.role !== "note").at(-1)?.fingerprint;
    if (!latest) continue;
    convs.push({
      sessionId: ref.sessionId,
      latest,
      state: c.state,
      customerText: c.messages.find((m) => m.role === "customer" && m.text)?.text,
      texts: c.messages.flatMap((m) => (m.text ? [m.text] : [])),
    });
  }
  const viaHook = convs.find((c) => c.customerText);
  const viaReconcile = convs.find((c) => c !== viaHook);
  test.skip(
    !viaHook || !viaReconcile,
    "the dev Crisp website needs a conversation with a customer message plus one more",
  );
  if (!viaHook || !viaReconcile) return;

  await removeTestCrispLinks(); // one workspace per website (test workspaces only)
  await seedWebsite(websiteId, 1);

  // (1) A real hook for a real conversation.
  const res = await sendHook(request, {
    website: websiteId,
    event: "message:send",
    data: { from: "user", type: "text", session_id: viaHook.sessionId, fingerprint: 1 },
  });
  expect(res.status()).toBe(200);
  let hooked = (await threadsOf(viaHook.sessionId))[0];
  for (let i = 0; i < 100 && hooked?.evaluationCount !== 1; i++) {
    await new Promise((r) => setTimeout(r, 300));
    hooked = (await threadsOf(viaHook.sessionId))[0];
  }
  expect(hooked?.evaluationCount).toBe(1);
  expect(hooked?.lastProcessedMessageId).toBe(viaHook.latest); // the worker read the real latest message
  expect(hooked?.lastEvaluatedState).toBe(viaHook.state);
  expect(hooked?.lastError).toBeNull();

  // (2) No hook at all for the second conversation: the reconcile job finds it by itself.
  expect(await threadsOf(viaReconcile.sessionId)).toHaveLength(0);
  await queue.add("crisp.reconcile", {});
  let recovered = (await threadsOf(viaReconcile.sessionId))[0];
  for (let i = 0; i < 150 && !recovered?.lastProcessedMessageId; i++) {
    await new Promise((r) => setTimeout(r, 300));
    recovered = (await threadsOf(viaReconcile.sessionId))[0];
  }
  expect(recovered?.lastProcessedMessageId).toBe(viaReconcile.latest); // found and processed without any hook
  expect(recovered?.lastError).toBeNull();
  // The conversation handled through its hook was already up to date, so reconcile left it alone.
  expect((await threadsOf(viaHook.sessionId))[0]?.evaluationCount).toBe(1);

  // And none of the real conversation text was stored.
  const everything = JSON.stringify([
    await ownerDb().select().from(schema.threads),
    await ownerDb().select().from(schema.sourceEvents),
  ]);
  for (const text of [...viaHook.texts, ...viaReconcile.texts])
    expect(everything).not.toContain(text);
});

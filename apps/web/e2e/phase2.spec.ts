import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { CrispPluginClient, refreshJiraTokens } from "@triagefox/connectors";
import { keyringFromEnv, openSecret, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { and, eq, schema } from "@triagefox/db";
import { closeOwnerDb, ownerDb } from "./db";
import { BASE, inviteMember, newUser, signUp, signUpWithWorkspace } from "./helpers";

const env = process.env;
const repoRoot = join(import.meta.dirname, "..", "..", "..");
const jiraTokenFile = join(repoRoot, "spikes", ".tokens.json");

// Live checks use your real accounts when their credentials exist, and are skipped otherwise (e.g. in CI).
const hasCrisp = !!(
  env.CRISP_PLUGIN_ID &&
  env.CRISP_PLUGIN_KEY &&
  env.CRISP_PLUGIN_UUID &&
  env.CRISP_WEBSITE_ID
);
const hasTrello = !!(env.TRELLO_API_KEY && env.TRELLO_TOKEN);
const hasJira = !!(
  env.ATLASSIAN_CLIENT_ID &&
  env.ATLASSIAN_CLIENT_SECRET &&
  env.JIRA_PROJECT_KEY &&
  existsSync(jiraTokenFile)
);
const hasOpenAi = !!env.OPENAI_API_KEY;
const privateKeyring = (): PrivateKeyring =>
  keyringFromEnv({
    CRYPTO_PUBLIC_KEYS: env.CRYPTO_PUBLIC_KEYS ?? "{}",
    CRYPTO_CURRENT_VERSION: Number(env.CRYPTO_CURRENT_VERSION),
    CRYPTO_PRIVATE_KEYS: env.CRYPTO_PRIVATE_KEYS,
  }) as PrivateKeyring;

test.describe.configure({ mode: "serial" });

const owner = newUser("Owner");
const wsName = `Acme ${Date.now()}`;
let page: Page;
let orgId: string;

async function connectionsFor(org: string, provider?: "crisp" | "trello" | "jira") {
  const rows = await ownerDb()
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.orgId, org));
  return provider ? rows.filter((r) => r.provider === provider) : rows;
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(page, owner, wsName);
  const [org] = await ownerDb()
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.name, wsName));
  if (!org) throw new Error("workspace not found");
  orgId = org.id;
  if (hasCrisp)
    // a previous interrupted run must not leave the Crisp website linked
    await ownerDb()
      .delete(schema.connections)
      .where(and(eq(schema.connections.provider, "crisp")));
});

test.afterAll(async () => {
  await closeOwnerDb();
});

test("connections page shows each provider, empty at first", async () => {
  await page.goto("/app/connections");
  for (const name of ["Crisp", "Trello", "Jira Cloud"]) {
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  }
  await expect(page.getByText("Not connected yet.")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "AI key" })).toBeVisible();
});

test("the Crisp page rejects forged tokens and is the only page Crisp may frame", async () => {
  const forged = await page.request.get(
    `/crisp/link?website_id=${crypto.randomUUID()}&token=forged-token-value`,
  );
  const text = await forged.text();
  expect(text).not.toContain("Continue in TriageFox");
  expect(forged.headers()["content-security-policy"]).toContain(
    "frame-ancestors https://app.crisp.chat",
  );
  const home = await page.request.get("/");
  expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

  // Issuing a link ticket requires a real Crisp token and a same-origin request.
  const noOrigin = await page.request.post("/api/crisp/link-ticket", {
    form: { website_id: crypto.randomUUID(), token: "x" },
    maxRedirects: 0,
  });
  expect(noOrigin.status()).toBe(403);
  const bad = await page.request.post("/api/crisp/link-ticket", {
    form: { website_id: crypto.randomUUID(), token: "forged" },
    headers: { origin: BASE },
    maxRedirects: 0,
  });
  expect([403, 503]).toContain(bad.status());
  expect(bad.headers().location).toBeUndefined();
});

test("an unknown or expired Crisp link ticket links nothing", async () => {
  await page.goto("/app/connections/crisp/link?ticket=does-not-exist");
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
});

test("Jira connect: a forged OAuth state is rejected and a failed exchange leaves nothing behind", async () => {
  test.skip(!env.ATLASSIAN_CLIENT_ID, "Jira is not configured");
  // Step 1 (what the Connect button does): our server issues a state cookie and redirects to Atlassian.
  const start = await page.request.get("/api/connections/jira/start", { maxRedirects: 0 });
  expect(start.status()).toBe(307);
  const authorize = new URL(start.headers().location ?? "");
  expect(authorize.origin).toBe("https://auth.atlassian.com");
  const state = authorize.searchParams.get("state") ?? "";
  expect(state.length).toBeGreaterThan(20);
  expect(authorize.searchParams.get("scope")).toBe(
    "read:jira-work write:jira-work read:jira-user offline_access",
  );
  expect(authorize.searchParams.get("redirect_uri")).toBe(`${BASE}/api/connections/jira/callback`);

  // Step 2: Atlassian sends the browser back. A state that doesn't match what we issued is refused.
  await page.goto("/api/connections/jira/callback?code=fake-code-1234567&state=FORGED-STATE");
  await expect(page).toHaveURL(/error=jira_state/);
  await expect(page.getByText("expired or was invalid")).toBeVisible();

  // The state is single-use: replaying the right value after a failed attempt no longer works.
  await page.goto(`/api/connections/jira/callback?code=fake-code-1234567&state=${state}`);
  await expect(page).toHaveURL(/error=jira_state/);

  // Correct state but a code Atlassian doesn't know: the worker's exchange fails, nothing is left behind.
  const again = await page.request.get("/api/connections/jira/start", { maxRedirects: 0 });
  const goodState = new URL(again.headers().location ?? "").searchParams.get("state") ?? "";
  await page.goto(`/api/connections/jira/callback?code=fake-code-1234567&state=${goodState}`);
  await expect(page).toHaveURL(/error=jira_failed/);
  expect(await connectionsFor(orgId, "jira")).toHaveLength(0);
});

test("Trello connect needs a flow started from our app", async () => {
  const res = await page.request.post("/api/connections/trello", {
    data: { token: "a".repeat(40) },
    headers: { origin: BASE, "content-type": "application/json" },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toContain("expired");
  expect(await connectionsFor(orgId, "trello")).toHaveLength(0);
});

test("OpenAI key: bad keys are rejected and never stored", async () => {
  await page.goto("/app/settings/ai");
  await page.getByLabel("OpenAI API key").fill("not-a-key");
  await page.getByRole("button", { name: "Verify and save" }).click();
  await expect(page.locator("p[role=alert]")).toBeVisible();

  await page.getByLabel("OpenAI API key").fill(`sk-${"x".repeat(48)}`);
  await page.getByRole("button", { name: "Verify and save" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(/rejected|reach OpenAI|doesn't look/i);
  const rows = await ownerDb()
    .select()
    .from(schema.aiSettings)
    .where(eq(schema.aiSettings.orgId, orgId));
  expect(rows).toHaveLength(0);
});

test("OpenAI key: a real key is verified, sealed, write-only and removable", async () => {
  test.skip(!hasOpenAi, "no OPENAI_API_KEY");
  const key = env.OPENAI_API_KEY as string;
  await page.goto("/app/settings/ai");
  await page.getByLabel("OpenAI API key").fill(key);
  await page.getByRole("button", { name: "Verify and save" }).click();
  await expect(page.getByText("Key verified and saved.")).toBeVisible();
  await expect(page.getByLabel("Replace key")).toHaveValue(""); // the typed key does not linger in the form

  const hint = `sk-…${key.slice(-4)}`;
  await expect(page.getByText(hint, { exact: true })).toBeVisible();
  expect(await page.content()).not.toContain(key); // never rendered anywhere on the page

  const [row] = await ownerDb()
    .select()
    .from(schema.aiSettings)
    .where(eq(schema.aiSettings.orgId, orgId));
  expect(row?.keyHint).toBe(hint);
  expect(row?.keySealed).toMatch(/^v1:/);
  expect(row?.keySealed).not.toContain(key);
  // Only the worker's private key can open it, and only for this workspace's record.
  expect(
    await openSecret(
      row?.keySealed ?? "",
      { orgId, recordId: orgId, purpose: "ai.key" },
      privateKeyring(),
    ),
  ).toBe(key);
  await expect(
    openSecret(
      row?.keySealed ?? "",
      { orgId: "someone-else", recordId: "someone-else", purpose: "ai.key" },
      privateKeyring(),
    ),
  ).rejects.toThrow();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove key" }).click();
  await expect(page.getByText("No key saved.")).toBeVisible();
  expect(
    await ownerDb().select().from(schema.aiSettings).where(eq(schema.aiSettings.orgId, orgId)),
  ).toHaveLength(0);
});

test("Trello (live): connect, choose a board and list, token never exposed", async () => {
  test.skip(!hasTrello, "no Trello credentials");
  const token = env.TRELLO_TOKEN as string;
  // Start the flow like the Connect button does (sets our one-time cookie, redirects to Trello).
  const start = await page.request.get("/api/connections/trello/start", { maxRedirects: 0 });
  expect(start.status()).toBe(307);
  const authorize = new URL(start.headers().location ?? "");
  expect(authorize.origin + authorize.pathname).toBe("https://trello.com/1/authorize");
  expect(authorize.searchParams.get("scope")).toBe("read,write");
  expect(authorize.searchParams.get("return_url")).toBe(`${BASE}/app/connections/trello/callback`);
  // Stand in for Trello's consent screen: it sends the browser back with the token in the URL fragment.
  await page.goto(`/app/connections/trello/callback#token=${token}`);
  await expect(page).toHaveURL(/\/app\/connections\/[0-9a-f-]{36}\?connected=trello/, {
    timeout: 30_000,
  });
  await expect(
    page.getByText("Connected. Next, choose where new tickets should go."),
  ).toBeVisible();

  expect(page.url()).not.toContain(token);
  expect(await page.content()).not.toContain(token);
  const [row] = await connectionsFor(orgId, "trello");
  expect(row?.status).toBe("active");
  expect(JSON.stringify(row)).not.toContain(token);
  expect(row?.credentialsSealed).toMatch(/^v1:/);

  await page.getByLabel("Board").selectOption({ label: "TriageFox" });
  await page.getByLabel("List for new cards").selectOption({ label: "To Do" });
  await page.getByRole("button", { name: "Save target" }).click();
  await expect(page.getByText("Saved. New cards will be created here.")).toBeVisible();

  await page.goto("/app/connections");
  await expect(page.getByText("TriageFox › To Do")).toBeVisible();
  // Cleanup without revoking: that token is also used by your other tests and scripts.
  await ownerDb().delete(schema.connections).where(eq(schema.connections.orgId, orgId));
});

test("Jira (live): choose a project, see type and priority mappings, save", async () => {
  test.skip(!hasJira, "no Jira credentials");
  const saved = JSON.parse(readFileSync(jiraTokenFile, "utf8")) as { refresh_token: string };
  // Exchange the stored refresh token (Atlassian rotates it), keep the new one for the next run, and seed a connection.
  const tokens = await refreshJiraTokens({
    clientId: env.ATLASSIAN_CLIENT_ID as string,
    clientSecret: env.ATLASSIAN_CLIENT_SECRET as string,
    refreshToken: saved.refresh_token,
  });
  writeFileSync(
    jiraTokenFile,
    JSON.stringify({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken }),
  );
  const sites = (await (
    await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
  ).json()) as { id: string; name: string; url: string }[];
  const id = crypto.randomUUID();
  const ring = privateKeyring();
  await ownerDb()
    .insert(schema.connections)
    .values({
      id,
      orgId,
      provider: "jira",
      authType: "oauth",
      status: "active",
      credentialsSealed: await sealSecret(
        JSON.stringify(tokens),
        { orgId, recordId: id, purpose: "connection.credentials" },
        ring,
      ),
      metadata: { sites, cloudId: sites[0]?.id, siteName: sites[0]?.name, siteUrl: sites[0]?.url },
    });

  try {
    await page.goto(`/app/connections/${id}`);
    await page.getByLabel("Project for new issues").selectOption(env.JIRA_PROJECT_KEY as string);
    await expect(page.getByText("Issue type for each kind of ticket")).toBeVisible({
      timeout: 30_000,
    });
    // Suggested mappings are pre-filled: bugs map to the Bug issue type, P5 to Highest.
    await expect(page.getByLabel("Bug", { exact: true })).not.toHaveValue("");
    await expect(page.getByLabel(/P5/)).not.toHaveValue("");
    await page.getByRole("button", { name: "Save target" }).click();
    await expect(
      page.getByText("Saved. New issues will be created in this project."),
    ).toBeVisible();

    const [row] = await connectionsFor(orgId, "jira");
    const d = (
      row?.metadata as {
        defaults?: {
          projectKey: string;
          setupOk: boolean;
          issueTypeMap: Record<string, string>;
          priorityMap: Record<string, string>;
        };
      }
    ).defaults;
    expect(d?.projectKey).toBe(env.JIRA_PROJECT_KEY);
    expect(d?.setupOk).toBe(true);
    expect(Object.keys(d?.issueTypeMap ?? {})).toHaveLength(8);
    expect(Object.keys(d?.priorityMap ?? {})).toHaveLength(5);
    expect(JSON.stringify(row?.metadata)).not.toContain(tokens.accessToken);
  } finally {
    // Tokens may have been refreshed by the worker: keep the newest refresh token for the next run.
    const [row] = await ownerDb()
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, id));
    if (row?.credentialsSealed) {
      const latest = JSON.parse(
        await openSecret(
          row.credentialsSealed,
          { orgId, recordId: id, purpose: "connection.credentials" },
          ring,
        ),
      ) as { accessToken: string; refreshToken: string };
      writeFileSync(
        jiraTokenFile,
        JSON.stringify({ access_token: latest.accessToken, refresh_token: latest.refreshToken }),
      );
    }
    await ownerDb().delete(schema.connections).where(eq(schema.connections.id, id));
  }
});

test("Crisp (live): link a real website from inside the Crisp page, once only", async ({
  browser,
}) => {
  test.skip(!hasCrisp, "no Crisp plugin credentials");
  const websiteId = env.CRISP_WEBSITE_ID as string;
  // Crisp gives the iframe page this per-website token; we read the same value from Crisp's API.
  const crisp = new CrispPluginClient({
    identifier: env.CRISP_PLUGIN_ID as string,
    key: env.CRISP_PLUGIN_KEY as string,
    pluginId: env.CRISP_PLUGIN_UUID as string,
  });
  const token = await crisp.getSubscriptionToken(websiteId);
  const linkPage = `/crisp/link?website_id=${websiteId}&token=${token}&locale=en`;

  await page.goto(linkPage);
  await expect(page.getByRole("button", { name: "Continue in TriageFox" })).toBeVisible();
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Continue in TriageFox" }).click(),
  ]);
  await expect(popup.getByRole("heading", { name: "Link this Crisp website?" })).toBeVisible();
  const ticketUrl = popup.url();
  expect(ticketUrl).toContain("ticket=");
  await popup.getByRole("button", { name: new RegExp(`Link to ${wsName}`) }).click();
  await expect(popup).toHaveURL(/\/app\/connections\/[0-9a-f-]{36}\?connected=crisp/);
  await expect(popup.getByText(/Connected/).first()).toBeVisible();
  const [row] = await connectionsFor(orgId, "crisp");
  expect((row?.metadata as { websiteId: string }).websiteId).toBe(websiteId);
  expect(row?.credentialsSealed).toBeNull(); // nothing secret is stored for Crisp
  await popup.close();

  // The ticket is single-use.
  await page.goto(ticketUrl.replace(BASE, ""));
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();

  // A different workspace cannot link the same Crisp website.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await signUpWithWorkspace(other, newUser("Other"), `Other ${Date.now()}`);
  await other.goto(linkPage);
  const [popup2] = await Promise.all([
    other.waitForEvent("popup"),
    other.getByRole("button", { name: "Continue in TriageFox" }).click(),
  ]);
  await popup2.getByRole("button", { name: /^Link to/ }).click();
  await expect(popup2).toHaveURL(/error=crisp_taken/);
  await expect(popup2.getByText("already linked to another workspace")).toBeVisible();
  await ctx.close();

  // Health check: the plugin is still installed, so the link stays active.
  await page.goto("/app/connections");
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText("Connection is working.")).toBeVisible();
  await ownerDb()
    .delete(schema.connections)
    .where(and(eq(schema.connections.orgId, orgId), eq(schema.connections.provider, "crisp")));
});

test("connections are private to their workspace, and members cannot manage them", async ({
  browser,
}) => {
  // A connection belonging to this workspace (no credentials needed to test access rules).
  const id = crypto.randomUUID();
  await ownerDb()
    .insert(schema.connections)
    .values({
      id,
      orgId,
      provider: "trello",
      authType: "token",
      status: "active",
      metadata: { username: "acme" },
    });

  // Another workspace's owner: cannot see, change, check or disconnect it.
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signUpWithWorkspace(b, newUser("Rival"), `Rival ${Date.now()}`);
  await b.goto("/app/connections");
  await expect(b.getByText("@acme")).toHaveCount(0);
  const headers = { origin: BASE };
  expect((await b.request.delete(`/api/connections/${id}`, { headers })).status()).toBe(404);
  expect((await b.request.post(`/api/connections/${id}/check`, { headers })).status()).toBe(404);
  expect((await b.request.get(`/api/connections/${id}/targets?kind=boards`)).status()).toBe(404);
  expect(
    (
      await b.request.put(`/api/connections/${id}/targets`, {
        headers,
        data: { boardId: "x", listId: "y" },
      })
    ).status(),
  ).toBe(404);
  await b.goto(`/app/connections/${id}`);
  await expect(b.getByText(/404|could not be found|not found/i).first()).toBeVisible();
  await ctxB.close();

  // A plain member of the workspace: sees the page but cannot connect, change keys or disconnect.
  const member = newUser("Member");
  const invitePath = await inviteMember(page, member.email, "member");
  const ctxM = await browser.newContext();
  const m = await ctxM.newPage();
  await m.goto(invitePath);
  await signUp(m, member, invitePath);
  await m.getByRole("button", { name: "Accept invitation" }).click();
  await expect(m.getByRole("heading", { name: wsName })).toBeVisible();
  await m.goto("/app/connections");
  await expect(m.getByText("Only owners and admins can add or change connections.")).toBeVisible();
  await expect(m.getByRole("link", { name: /^Connect (Trello|Jira Cloud|another)/ })).toHaveCount(
    0,
  );
  expect((await m.request.delete(`/api/connections/${id}`, { headers })).status()).toBe(403);
  expect(
    (
      await m.request.post("/api/ai-key", { headers, data: { key: `sk-${"y".repeat(48)}` } })
    ).status(),
  ).toBe(403);
  expect((await m.request.get("/api/connections/trello/start", { maxRedirects: 0 })).status()).toBe(
    307,
  );
  // Cross-site requests are refused even with valid cookies.
  expect(
    (
      await page.request.delete(`/api/connections/${id}`, {
        headers: { origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  await ctxM.close();

  expect((await connectionsFor(orgId, "trello")).some((r) => r.id === id)).toBe(true); // nothing was deleted
  await ownerDb().delete(schema.connections).where(eq(schema.connections.id, id));
});

test("a connection Trello no longer accepts shows 'Reconnect needed'; disconnecting removes it", async () => {
  test.skip(!env.TRELLO_API_KEY, "Trello is not configured");
  // A token Trello does not know (safe: nothing real is revoked). Sealed exactly like a real one.
  const id = crypto.randomUUID();
  await ownerDb()
    .insert(schema.connections)
    .values({
      id,
      orgId,
      provider: "trello",
      authType: "token",
      status: "active",
      metadata: { username: "olduser" },
      credentialsSealed: await sealSecret(
        JSON.stringify({ token: "0".repeat(64) }),
        { orgId, recordId: id, purpose: "connection.credentials" },
        privateKeyring(),
      ),
    });

  await page.goto("/app/connections");
  await expect(page.getByText("@olduser")).toBeVisible();
  await page.getByRole("button", { name: "Check connection" }).click();
  await expect(page.getByText(/no longer accepts this connection/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Reconnect needed")).toBeVisible();
  expect((await connectionsFor(orgId, "trello"))[0]?.status).toBe("revoked");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("@olduser")).toHaveCount(0, { timeout: 20_000 });
  expect(await connectionsFor(orgId, "trello")).toHaveLength(0);
  // The audit trail recorded it (ids only), through row-level security.
  const audit = await ownerDb()
    .select()
    .from(schema.auditLog)
    .where(eq(schema.auditLog.orgId, orgId));
  expect(audit.map((a) => a.action)).toContain("connection.removed");
  expect(JSON.stringify(audit)).not.toContain("0".repeat(64));
});

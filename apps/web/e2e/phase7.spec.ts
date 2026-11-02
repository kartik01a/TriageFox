import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { keyringFromEnv, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { eq, schema } from "@triagefox/db";
import { closeOwnerDb, ownerDb } from "./db";
import { BASE, newUser, signUpWithWorkspace } from "./helpers";

const env = process.env;
const keyring = (): PrivateKeyring =>
  keyringFromEnv({
    CRYPTO_PUBLIC_KEYS: env.CRYPTO_PUBLIC_KEYS ?? "{}",
    CRYPTO_CURRENT_VERSION: Number(env.CRYPTO_CURRENT_VERSION),
    CRYPTO_PRIVATE_KEYS: env.CRYPTO_PRIVATE_KEYS,
  }) as PrivateKeyring;

test.describe.configure({ mode: "serial" });

const owner = newUser("Owner");
const wsName = `Dash ${Date.now()}`;
let page: Page;
let orgId = "";
let automationId = "";
let threadId = "";
let trelloConnId = "";

const db = () => ownerDb();

async function seedIssue(title: string) {
  const [issue] = await db()
    .insert(schema.issues)
    .values({
      orgId,
      automationId,
      originThreadId: threadId,
      title,
      summary: "Customers cannot pay.",
      bodyMd:
        "## Summary\nCustomers cannot pay.\n\n---\nType: Bug · Priority: 3 (Medium) — Workaround exists.\nReported by 1 customer\nCreated by TriageFox",
      type: "bug",
      priority: 3,
      confidence: 0.5,
      status: "pending_review",
    })
    .returning();
  return issue?.id ?? "";
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(page, owner, wsName);
  const [org] = await db()
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.name, wsName));
  orgId = org?.id ?? "";
});

test.afterAll(async () => {
  if (orgId) await db().delete(schema.connections).where(eq(schema.connections.orgId, orgId));
  await closeOwnerDb();
});

test("a new workspace is told to set up, and the setup page shows where it stands", async () => {
  await page.goto("/app");
  await expect(page.getByText("Set up your first automation")).toBeVisible();
  await page.getByRole("link", { name: "Start setup" }).click();
  await expect(page.getByRole("heading", { name: "Connect Crisp" })).toBeVisible();
  await expect(page.getByText("Waiting for Crisp…")).toBeVisible();
});

test("once Crisp and Trello are connected the checklist moves on, and settings preview reacts", async () => {
  const [crisp] = await db()
    .insert(schema.connections)
    .values({
      orgId,
      provider: "crisp",
      authType: "plugin_install",
      status: "active",
      metadata: { websiteId: `site-${randomUUID()}`, websiteName: "Test site" },
    })
    .returning();
  const [trello] = await db()
    .insert(schema.connections)
    .values({
      orgId,
      provider: "trello",
      authType: "token",
      status: "active",
      metadata: {
        username: "tester",
        defaults: { boardId: "B", boardName: "Bugs", listId: "L", listName: "Inbox" },
      },
    })
    .returning();
  trelloConnId = trello?.id ?? "";
  expect(crisp?.id).toBeTruthy();

  await page.goto("/app/setup");
  await expect(page.getByRole("heading", { name: "Ticket settings" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to settings" }).click();

  // The preview changes as the switches are flipped.
  await expect(page.getByText("Reported by 1 customer")).toBeVisible();
  await page.getByLabel(/Include customer names/).check();
  await expect(page.getByText("Reported by Jane Doe")).toBeVisible();
  await page.getByLabel(/Include a link to the Crisp conversation/).check();
  await expect(page.getByText(/Source: https:\/\/app\.crisp\.chat/)).toBeVisible();
  await page.getByLabel(/Include customer names/).uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  // Saving completes the step: it collapses and the checklist moves on.
  await expect(page.getByRole("heading", { name: /Ticket settings \(done\)/ })).toBeVisible();

  const [automation] = await db()
    .select()
    .from(schema.automations)
    .where(eq(schema.automations.orgId, orgId));
  automationId = automation?.id ?? "";
  expect(automation?.settings.includeSourceLink).toBe(true);
  expect(automation?.settings.includeCustomerNames).toBe(false);
  const dests = await db()
    .select()
    .from(schema.automationDestinations)
    .where(eq(schema.automationDestinations.automationId, automationId));
  expect(dests).toHaveLength(1);
  expect(dests[0]?.config).toMatchObject({ kind: "trello", boardId: "B", listId: "L" });

  const [thread] = await db()
    .insert(schema.threads)
    .values({ orgId, automationId, sourceId: `sess-${randomUUID()}` })
    .returning();
  threadId = thread?.id ?? "";
});

test("turning the automation on and off", async () => {
  await page.goto("/app/automation");
  await expect(page.getByText("Paused. Nothing is created")).toBeVisible();
  await expect(page.getByText("Bugs › Inbox")).toBeVisible();
  await page.getByRole("button", { name: "Turn on automation" }).click();
  await expect(page.getByText("On. New chats are read")).toBeVisible();
  await page.getByRole("button", { name: "Pause automation" }).click();
  await expect(page.getByText("Paused. Nothing is created")).toBeVisible();
});

test("switching off every destination is allowed, with a clear warning", async () => {
  await page.goto("/app/automation");
  await page.getByRole("button", { name: "Turn on automation" }).click();
  await expect(page.getByText("On. New chats are read")).toBeVisible();
  const warning = page.getByText("No tool is receiving tickets.");
  await expect(warning).toHaveCount(0);
  await page.getByLabel("Send tickets to Trello").uncheck();
  await expect(warning).toBeVisible();
  await page.getByLabel("Send tickets to Trello").check();
  await expect(warning).toHaveCount(0);
  await page.getByRole("button", { name: "Pause automation" }).click();
  await expect(page.getByText("Paused. Nothing is created")).toBeVisible();
});

test("enabling needs a working destination", async () => {
  await db()
    .update(schema.automationDestinations)
    .set({ enabled: false })
    .where(eq(schema.automationDestinations.automationId, automationId));
  await page.goto("/app/automation");
  await page.getByRole("button", { name: "Turn on automation" }).click();
  await expect(
    page.getByText(/Connect Trello or Jira and choose where tickets should go/),
  ).toBeVisible();
  await db()
    .update(schema.automationDestinations)
    .set({ enabled: true })
    .where(eq(schema.automationDestinations.automationId, automationId));
});

test("review queue: fix the priority and create; the ticket is handed to delivery", async () => {
  const id = await seedIssue("Checkout fails for everyone");
  await page.goto("/app/review");
  await expect(page.getByRole("link", { name: /Review/ }).first()).toBeVisible();
  const card = page.getByRole("article", { name: "Checkout fails for everyone" });
  await card.getByLabel("Priority").selectOption("5");
  await card.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByText("Nothing to review")).toBeVisible();

  const [issue] = await db().select().from(schema.issues).where(eq(schema.issues.id, id));
  expect(issue?.status).toBe("active");
  expect(issue?.priority).toBe(5);
  expect(issue?.bodyMd).toContain("Priority: 5 (Critical)");

  // The worker tries to deliver; this fake Trello connection has no credentials, so it fails visibly.
  await expect
    .poll(
      async () => {
        const rows = await db()
          .select()
          .from(schema.destinationTickets)
          .where(eq(schema.destinationTickets.issueId, id));
        return rows[0]?.status;
      },
      { timeout: 20_000 },
    )
    .toBe("failed");
  await page.goto("/app/automation");
  await expect(page.getByText("Tickets that didn't arrive")).toBeVisible();
  await expect(page.getByText("Checkout fails for everyone")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("review queue: dismiss, and a second click cannot act twice", async () => {
  const id = await seedIssue("Typo in footer");
  await page.goto("/app/review");
  const card = page.getByRole("article", { name: "Typo in footer" });
  await card.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Nothing to review")).toBeVisible();
  const [issue] = await db().select().from(schema.issues).where(eq(schema.issues.id, id));
  expect(issue?.status).toBe("dismissed");

  const again = await page.request.post(`/api/review/${id}`, {
    data: { action: "create" },
    headers: { origin: BASE },
  });
  expect(again.status()).toBe(409);
});

test("activity log: filters, and a row explains the AI's reason from the sealed output", async () => {
  const runId = randomUUID();
  const sealed = await sealSecret(
    JSON.stringify({
      actions: [
        {
          kind: "no_action",
          title: "",
          summary: "",
          reason: "How-to question, no engineering work",
          priorityReason: "",
          confidence: 0.93,
        },
      ],
    }),
    { orgId, recordId: runId, purpose: "ai_run.output" },
    keyring(),
  );
  await db().insert(schema.aiRuns).values({
    id: runId,
    orgId,
    threadId,
    model: "m",
    keySource: "platform",
    rawOutputSealed: sealed,
  });
  await db()
    .insert(schema.activityLog)
    .values([
      {
        orgId,
        automationId,
        threadId,
        kind: "ai_no_action",
        message: "No ticket needed (question).",
        refs: { aiRunId: runId },
      },
      {
        orgId,
        automationId,
        threadId,
        kind: "ticket_created",
        message: "Created a Trello card.",
        refs: { url: "https://trello.com/c/abc" },
      },
    ]);

  await page.goto("/app/activity");
  await expect(page.getByText("No ticket needed (question).")).toBeVisible();
  await expect(page.getByText("Created a Trello card.")).toBeVisible();

  await page.goto("/app/activity?filter=skipped");
  await expect(page.getByText("No ticket needed (question).")).toBeVisible();
  await expect(page.getByText("Created a Trello card.")).toHaveCount(0);

  await page.getByText("No ticket needed (question).").click();
  await expect(page.getByText("How-to question, no engineering work")).toBeVisible();
  await expect(page.getByText("Confidence 93%")).toBeVisible();

  await page.goto("/app/activity?filter=created");
  await page.getByText("Created a Trello card.").click();
  await expect(page.getByRole("link", { name: "Open the ticket" })).toHaveAttribute(
    "href",
    "https://trello.com/c/abc",
  );
});

test("overview counts this month's activity", async () => {
  await page.goto("/app");
  await expect(page.getByText("Tickets created")).toBeVisible();
  await expect(page.getByText("Chats skipped")).toBeVisible();
  await expect(page.getByText("Trello", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /problem/ })).toBeVisible(); // the failed delivery above
});

test("security page: sessions, audit log, and the workspace 2FA rule needs 2FA first", async () => {
  await page.goto("/app/settings/security");
  await expect(page.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();
  await expect(page.getByText("This device")).toBeVisible();
  await expect(page.getByText(/turned the automation on/i).first()).toBeVisible();

  await page.getByLabel(/Require two-factor sign-in for everyone/).click();
  await expect(page.getByText("Turn on two-factor for your own account first.")).toBeVisible();
});

test("a workspace that requires 2FA closes the app until it is set up", async () => {
  await db().insert(schema.workspaceSettings).values({ orgId, require2fa: true });
  await page.goto("/app/review");
  await expect(page).toHaveURL(/\/app\/settings\/security\?required=1/);
  await expect(page.getByText("This workspace requires two-factor sign-in.")).toBeVisible();
  // API calls are refused too, not just pages.
  const res = await page.request.post(`/api/automation`, {
    headers: { origin: BASE },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe("two_factor_required");
  await db().delete(schema.workspaceSettings).where(eq(schema.workspaceSettings.orgId, orgId));
});

test("sensitive actions ask for the password again after a while", async () => {
  // Age every session of this user so the sign-in is no longer "fresh".
  const [u] = await db().select().from(schema.user).where(eq(schema.user.email, owner.email));
  await db()
    .update(schema.session)
    .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
    .where(eq(schema.session.userId, u?.id ?? ""));
  // Better Auth caches the session in a cookie for a few minutes; drop it so the server reads the aged row.
  await page.context().clearCookies({ name: /session_data/ });
  const res = await page.request.delete(`/api/connections/${trelloConnId}`, {
    headers: { origin: BASE },
  });
  expect(res.status()).toBe(403);
  expect((await res.json()).code).toBe("step_up_required");
});

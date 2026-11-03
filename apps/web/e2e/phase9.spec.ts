import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { FakeProvider } from "@triagefox/billing";
import { eq, schema } from "@triagefox/db";
import { closeOwnerDb, ownerDb } from "./db";
import { BASE, inviteMember, newUser, signUp, signUpWithWorkspace } from "./helpers";

const ADMIN_EMAIL = "e2e-admin@example.test";
const ORIGIN = BASE;
const fake = new FakeProvider();
const db = () => ownerDb();

test.describe.configure({ mode: "serial" });

const owner = newUser("Billing");
const wsName = `Bill ${Date.now()}`;
let page: Page;
let admin: Page;
let orgId = "";
let planId = "";
const slug = `e2e-${randomUUID().slice(0, 8)}`;
const productMonthly = `pdt_m_${slug}`;
const productYearly = `pdt_y_${slug}`;

const webhook = (type: string, data: Record<string, unknown>, id = `evt_${randomUUID()}`) => {
  const { body, headers } = fake.sign({ id, type, data });
  return { body, headers: Object.fromEntries(headers.entries()) };
};
const post = (p: Page, event: ReturnType<typeof webhook>) =>
  p.request.post("/api/webhooks/billing", {
    data: event.body,
    headers: { ...event.headers, "content-type": "application/json" },
  });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(page, owner, wsName);
  const [org] = await db()
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.name, wsName));
  orgId = org?.id ?? "";

  // A public plan with provider product ids for USD and INR.
  const [plan] = await db()
    .insert(schema.plans)
    .values({
      slug,
      name: `E2E Plan ${slug}`,
      prices: { USD: { monthly: 900, yearly: 9000 }, INR: { monthly: 69900, yearly: 699000 } },
      conversationLimit: 300,
      inboxLimit: 1,
      providerPriceIds: { dodo: { USD: { monthly: productMonthly, yearly: productYearly } } },
      isPublic: true,
      sortOrder: -1000,
    })
    .returning();
  planId = plan?.id ?? "";

  // The platform admin: a fixed email (the dev server allows exactly this one), with two-factor switched on.
  const [old] = await db().select().from(schema.user).where(eq(schema.user.email, ADMIN_EMAIL));
  if (old) await db().delete(schema.user).where(eq(schema.user.id, old.id));
  admin = await (await browser.newContext()).newPage();
  await signUp(admin, { name: "Admin Tester", email: ADMIN_EMAIL });
});

test.afterAll(async () => {
  await db().delete(schema.inviteCodes).where(eq(schema.inviteCodes.planId, planId));
  await db()
    .update(schema.subscriptions)
    .set({ planId: null })
    .where(eq(schema.subscriptions.planId, planId));
  await db().delete(schema.plans).where(eq(schema.plans.slug, slug));
  const [u] = await db().select().from(schema.user).where(eq(schema.user.email, ADMIN_EMAIL));
  if (u) await db().delete(schema.user).where(eq(schema.user.id, u.id));
  await closeOwnerDb();
});

test("a new workspace starts a free trial and sees its usage", async () => {
  await page.goto("/app/billing");
  await expect(page.getByText("Free trial").first()).toBeVisible();
  await expect(page.getByText(/7 days left/)).toBeVisible();
  await expect(page.getByText("0 / 50")).toBeVisible();
  await expect(page.getByRole("link", { name: "Billing" }).first()).toBeVisible();
});

test("the public pricing page reads plans from the database and shows the yearly price per month", async ({
  browser,
}) => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/pricing");
  const card = anon.getByRole("article", { name: `E2E Plan ${slug}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText("$7.50"); // $90 a year, shown per month
  await expect(card).toContainText("$90 billed yearly");
  await anon.close();
});

test("INR and monthly views", async ({ browser }) => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/pricing?currency=INR&interval=monthly");
  const card = anon.getByRole("article", { name: `E2E Plan ${slug}` });
  await expect(card).toContainText("₹699");
  await expect(card).toContainText("billed monthly");
  await expect(card).toContainText("300 conversations a month");
  await anon.close();
});

test("a signed payment webhook activates the plan; a bad signature and a repeat change nothing", async () => {
  const bad = webhook("subscription.active", {
    subscription_id: "sub_bad",
    metadata: { org_id: orgId },
    product_id: productYearly,
  });
  const forged = await page.request.post("/api/webhooks/billing", {
    data: `${bad.body} `,
    headers: { ...bad.headers, "content-type": "application/json" },
  });
  expect(forged.status()).toBe(401);

  const subId = `sub_${randomUUID().slice(0, 8)}`;
  const ev = webhook("subscription.active", {
    subscription_id: subId,
    customer: { customer_id: "cus_e2e", email: owner.email },
    product_id: productYearly,
    metadata: { org_id: orgId },
    previous_billing_date: new Date().toISOString(),
    next_billing_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  expect((await post(page, ev)).status()).toBe(200);
  expect((await post(page, ev)).status()).toBe(200); // the same delivery again

  await page.goto("/app/billing");
  await expect(page.getByText(`E2E Plan ${slug}`).first()).toBeVisible();
  await expect(page.getByText(/Active · yearly/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage payment" })).toBeVisible();
  await expect(page.getByText("0 / 300")).toBeVisible();
  // Yearly plans get their allowance every month.
  await expect(page.getByText(/Starts again on .*every month, also on yearly plans/)).toBeVisible();

  // The payment portal opens in a new tab; the app stays where it was.
  await page
    .context()
    .route("https://portal.example.test/**", (r) =>
      r.fulfill({ body: "portal", contentType: "text/html" }),
    );
  const [portal] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Manage payment" }).click(),
  ]);
  await expect.poll(() => portal.url()).toContain("https://portal.example.test/cus_e2e");
  await expect(page).toHaveURL(/\/app\/billing/);
  await portal.close();

  // A failed payment is shown plainly; a later success clears it.
  await post(page, webhook("payment.failed", { subscription_id: subId }));
  await page.goto("/app/billing");
  await expect(page.getByText("Payment failed").first()).toBeVisible();
  await post(page, webhook("payment.succeeded", { subscription_id: subId }));
  await page.goto("/app/billing");
  await expect(page.getByText(/Active · yearly/)).toBeVisible();
});

test("the usage banner appears at 80% and says new conversations wait at 100%", async () => {
  const [sub] = await db()
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, orgId));
  const start = (sub?.currentPeriodStart ?? new Date()).toISOString().slice(0, 10);
  await db()
    .insert(schema.usageCounters)
    .values({ orgId, periodStart: start, conversationsAnalysed: 250 })
    .onConflictDoNothing();
  await page.goto("/app");
  await expect(page.getByText(/used 83% of this month/)).toBeVisible();
  await db()
    .update(schema.usageCounters)
    .set({ conversationsAnalysed: 300 })
    .where(eq(schema.usageCounters.orgId, orgId));
  await page.goto("/app");
  await expect(page.getByText(/used all your conversations/)).toBeVisible();
  await db().delete(schema.usageCounters).where(eq(schema.usageCounters.orgId, orgId));
});

test("only the owner can change billing", async ({ browser }) => {
  const member = newUser("Member");
  const memberPage = await (await browser.newContext()).newPage();
  const path = await inviteMember(page, member.email, "admin");
  await signUp(memberPage, member, path);
  await memberPage.goto(path);
  await memberPage.getByRole("button", { name: "Accept" }).click();
  await expect(memberPage).toHaveURL(/\/app/);
  const res = await memberPage.request.post("/api/billing/checkout", {
    data: { planId, interval: "monthly" },
    headers: { origin: ORIGIN, "content-type": "application/json" },
  });
  expect(res.status()).toBe(403);
  await memberPage.goto("/app/billing");
  await expect(memberPage.getByText("Only the workspace owner can change the plan")).toBeVisible();
  await memberPage.close();
});

test("checkout refuses a plan that is not sold in the chosen currency", async ({ browser }) => {
  // A workspace still on its trial (the main one above already pays, and paying workspaces change
  // plans instead of checking out).
  const p = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(p, newUser("currency"), `Currency ${Date.now()}`);
  const res = await p.request.post("/api/billing/checkout", {
    data: { planId, interval: "monthly", currency: "INR" }, // the plan has product ids for USD only
    headers: { origin: ORIGIN, "content-type": "application/json" },
  });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/isn't available in your currency/);
  await p.close();
});

test("the admin area is a plain 404 for everyone except an admin with two-factor on", async () => {
  expect((await page.request.get("/api/admin/settings")).status()).toBe(404);
  expect((await page.goto("/admin"))?.status()).toBe(404);
  // The admin's email is on the list but two-factor is not on yet.
  expect((await admin.goto("/admin"))?.status()).toBe(404);
  expect((await admin.request.get("/api/admin/plans")).status()).toBe(404);
  await db()
    .update(schema.user)
    .set({ twoFactorEnabled: true })
    .where(eq(schema.user.email, ADMIN_EMAIL));
  await admin.context().clearCookies({ name: /session_data/ });
  expect((await admin.goto("/admin"))?.status()).toBe(200);
  await expect(admin.getByText("TriageFox admin")).toBeVisible();
});

test("admin: a price change creates a new version and the old one stays for subscribers", async ({
  browser,
}) => {
  await admin.goto("/admin/plans");
  await expect(admin.getByText(`E2E Plan ${slug}`).first()).toBeVisible();
  const res = await admin.request.patch(`/api/admin/plans/${planId}`, {
    data: {
      prices: { USD: { monthly: 1000, yearly: 10000 }, INR: { monthly: 69900, yearly: 699000 } },
    },
    headers: { origin: ORIGIN, "content-type": "application/json" },
  });
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, versioned: true });
  expect(body.plan).toMatchObject({ version: 2, isPublic: false });
  const rows = await db().select().from(schema.plans).where(eq(schema.plans.slug, slug));
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.version === 1)?.prices.USD?.monthly).toBe(900);
  // Hidden until product ids exist: the public page no longer lists the newest version.
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/pricing");
  await expect(anon.getByRole("article", { name: `E2E Plan ${slug}` })).toHaveCount(1); // version 1 is still the one on sale
  await anon.close();
  // Making it public without product ids is refused.
  const refused = await admin.request.patch(`/api/admin/plans/${body.plan.id}`, {
    data: { isPublic: true },
    headers: { origin: ORIGIN, "content-type": "application/json" },
  });
  expect(refused.status()).toBe(400);
});

test("admin: settings are validated, saved, and audited", async () => {
  const bad = await admin.request.put("/api/admin/settings", {
    data: { key: "trial", value: { days: -5 } },
    headers: { origin: ORIGIN, "content-type": "application/json" },
  });
  expect(bad.status()).toBe(400);
  const ok = await admin.request.put("/api/admin/settings", {
    data: { key: "reminders", value: { monthlyDays: 4, yearlyDays: 8 } },
    headers: { origin: ORIGIN, "content-type": "application/json" },
  });
  expect(ok.status()).toBe(200);
  const log = await db()
    .select()
    .from(schema.adminAuditLog)
    .where(eq(schema.adminAuditLog.action, "settings.updated"));
  expect(log.some((l) => l.target === "reminders" && l.adminEmail === ADMIN_EMAIL)).toBe(true);
  await db().delete(schema.platformSettings).where(eq(schema.platformSettings.key, "reminders"));
});

test("admin: every admin page renders, and a setting can be edited with plain fields", async () => {
  for (const path of [
    "/admin",
    "/admin/plans",
    "/admin/settings",
    "/admin/workspaces",
    "/admin/invite-codes",
    "/admin/usage",
    "/admin/inbox",
  ])
    expect((await admin.goto(path))?.status(), path).toBe(200);
  await admin.goto("/admin/settings");
  await expect(admin.getByRole("heading", { name: "Free trial" })).toBeVisible();
  await admin.getByLabel("Past due days").fill("9");
  await admin.getByRole("button", { name: /Save grace/i }).click();
  await expect(admin.getByText("Saved.")).toBeVisible();
  const [row] = await db()
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.key, "grace"));
  expect(row?.value).toEqual({ pastDueDays: 9 });
  await db().delete(schema.platformSettings).where(eq(schema.platformSettings.key, "grace"));
});

test("admin: an invite code works once for the right person; the code is never stored", async () => {
  const res = await admin.request.post("/api/admin/invite-codes", {
    data: { email: owner.email, planId, months: 2 },
    headers: { origin: ORIGIN, "content-type": "application/json" },
  });
  const { code } = await res.json();
  expect(code.length).toBeGreaterThanOrEqual(20);
  const stored = JSON.stringify(
    await db().select().from(schema.inviteCodes).where(eq(schema.inviteCodes.planId, planId)),
  );
  expect(stored).not.toContain(code);
  const audit = JSON.stringify(await db().select().from(schema.adminAuditLog));
  expect(audit).not.toContain(code);

  await page.goto("/app/billing");
  await page.getByRole("textbox", { name: "Invite code" }).fill("not-a-real-code-at-all");
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByText("That code isn't valid.")).toBeVisible();
  await page.getByRole("textbox", { name: "Invite code" }).fill(code);
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByText(/free access to/)).toBeVisible();
  await page.goto("/app/billing");
  await expect(page.getByText("Free access").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Invite code" }).fill(code);
  await page.getByRole("button", { name: "Redeem" }).click();
  await expect(page.getByText("That code has already been used.")).toBeVisible();
});

test("admin: workspace actions, free access and pause", async () => {
  const w = await admin.request.get(`/api/admin/workspaces?q=${encodeURIComponent(wsName)}`);
  const list = (await w.json()).workspaces as { id: string; summary: { status: string } }[];
  expect(list.find((x) => x.id === orgId)).toBeTruthy();
  const act = (body: unknown) =>
    admin.request.post(`/api/admin/workspaces/${orgId}`, {
      data: body,
      headers: { origin: ORIGIN, "content-type": "application/json" },
    });
  expect((await act({ action: "pause" })).status()).toBe(200);
  await page.goto("/app/billing");
  await expect(page.getByText(/workspace is paused/).first()).toBeVisible();
  expect((await act({ action: "resume" })).status()).toBe(200);
  expect((await act({ action: "comp", planId, months: 1, reason: "e2e" })).status()).toBe(200);
  expect((await act({ action: "revoke-comp" })).status()).toBe(200);
  expect(
    (await act({ action: "comp", planId, months: null, reason: "open-ended e2e" })).status(),
  ).toBe(200);
  const audit = await db()
    .select()
    .from(schema.adminAuditLog)
    .where(eq(schema.adminAuditLog.target, orgId));
  expect(audit.map((a) => a.action)).toEqual(
    expect.arrayContaining([
      "workspace.pause",
      "workspace.resume",
      "workspace.comp",
      "workspace.revoke-comp",
    ]),
  );
  const [sub] = await db()
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, orgId));
  expect(sub).toMatchObject({ status: "comped", pausedByAdmin: false });
});

test("admin: the support inbox lists items, with identity shown honestly, and updates them", async () => {
  const threadId = randomUUID();
  const [item] = await db()
    .insert(schema.supportItems)
    .values({
      sourceOrgId: orgId,
      threadId,
      category: "refund_request",
      title: `Refund please ${slug}`,
      summary: "Charged twice.",
      customerEmail: "someone@example.test",
      identityVerified: false,
      crispUrl: "https://app.crisp.chat/website/x/inbox/y/",
    })
    .returning();
  await db()
    .insert(schema.supportItems)
    .values({
      sourceOrgId: orgId,
      threadId: randomUUID(),
      category: "praise",
      title: `Love it ${slug}`,
      customerEmail: "fan@example.test",
      identityVerified: true,
    });
  await admin.goto("/admin/inbox");
  const card = admin.getByRole("article", { name: `Refund please ${slug}` });
  await expect(card).toContainText("unverified: check before acting");
  await expect(card.getByRole("link", { name: "Open in Crisp" })).toBeVisible();
  await card.getByLabel("Status").selectOption("done");
  await expect
    .poll(
      async () =>
        (
          await db()
            .select()
            .from(schema.supportItems)
            .where(eq(schema.supportItems.id, item?.id ?? ""))
        )[0]?.status,
    )
    .toBe("done");
  await admin.goto("/admin/inbox?tab=testimonials");
  await expect(admin.getByRole("article", { name: `Love it ${slug}` })).toBeVisible();
  await expect(admin.getByRole("article", { name: `Refund please ${slug}` })).toHaveCount(0);
  await db().delete(schema.supportItems).where(eq(schema.supportItems.sourceOrgId, orgId));
});

test("after the trial the home page leads to Billing, other pages stay open, and the gap is explained", async () => {
  const ended = newUser("ended");
  const p = await (await page.context().browser()?.newContext())?.newPage();
  if (!p) throw new Error("no page");
  await signUpWithWorkspace(p, ended, `Ended ${Date.now()}`);
  const [u] = await db().select().from(schema.user).where(eq(schema.user.email, ended.email));
  const [m] = await db()
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, u?.id ?? ""));
  await db()
    .update(schema.subscriptions)
    .set({ trialEndsAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.subscriptions.orgId, m?.organizationId ?? ""));

  await p.goto("/app");
  await expect(p).toHaveURL(/\/app\/billing\?ended=1/);
  await expect(p.getByText("Choose a plan to keep creating tickets")).toBeVisible();
  await expect(
    p.getByText("Chats that arrive until then won't become tickets.").first(),
  ).toBeVisible();
  // Not locked: other pages open, with the banner and its button.
  await p.goto("/app/activity");
  await expect(p).toHaveURL(/\/app\/activity/);
  await expect(p.getByRole("link", { name: "Choose a plan" })).toBeVisible();
  await p.close();
});

test("a paying workspace upgrades now (prorated) or schedules a downgrade; never a second checkout", async ({
  browser,
}) => {
  const tag = randomUUID().slice(0, 6);
  const ids = (size: string) => ({
    USD: { monthly: `pdt_${size}_m_${tag}`, yearly: `pdt_${size}_y_${tag}` },
  });
  const [small, big] = await db()
    .insert(schema.plans)
    .values([
      {
        slug: `pc-small-${tag}`,
        name: `Small ${tag}`,
        prices: { USD: { monthly: 900, yearly: 9000 } },
        conversationLimit: 300,
        providerPriceIds: { dodo: ids("small") },
        isPublic: true,
        sortOrder: -2000,
      },
      {
        slug: `pc-big-${tag}`,
        name: `Big ${tag}`,
        prices: { USD: { monthly: 2400, yearly: 24000 } },
        conversationLimit: 1500,
        providerPriceIds: { dodo: ids("big") },
        isPublic: true,
        sortOrder: -1999,
      },
    ])
    .returning();
  const p = await (await browser.newContext()).newPage();
  const payer = newUser("payer");
  const name = `Payer ${tag}`;
  await signUpWithWorkspace(p, payer, name);
  const [org] = await db()
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.name, name));
  const payerOrg = org?.id ?? "";
  try {
    const subId = `sub_${tag}`;
    const periodEnd = new Date(Date.now() + 20 * 86_400_000);
    const active = (product: string, periodStart = new Date(Date.now() - 10 * 86_400_000)) =>
      webhook("subscription.active", {
        subscription_id: subId,
        customer: { customer_id: `cus_${tag}`, email: payer.email },
        product_id: product,
        metadata: { org_id: payerOrg },
        previous_billing_date: periodStart.toISOString(),
        next_billing_date: periodEnd.toISOString(),
      });
    expect((await post(p, active(`pdt_small_m_${tag}`))).status()).toBe(200);

    // Already paying: a second checkout is refused.
    const second = await p.request.post("/api/billing/checkout", {
      data: { planId: big?.id, interval: "monthly", currency: "USD" },
      headers: { origin: ORIGIN },
    });
    expect(second.status()).toBe(409);

    await p.goto("/app/billing");
    const smallCard = p.getByRole("article", { name: `Small ${tag}` });
    const bigCard = p.getByRole("article", { name: `Big ${tag}` });
    await expect(smallCard.getByRole("button", { name: "Your plan" })).toBeDisabled();

    // Upgrade: the price for the rest of the period is shown first, then charged.
    await bigCard.getByRole("button", { name: "Upgrade now" }).click();
    await expect(bigCard.getByText("$12.34")).toBeVisible(); // the stand-in provider's preview
    await bigCard.getByRole("button", { name: "Pay and upgrade" }).click();
    await expect(bigCard.getByText(/Upgrading/)).toBeVisible();
    // The plan follows the provider's confirmation, and the page updates by itself (no reload).
    expect((await post(p, active(`pdt_big_m_${tag}`))).status()).toBe(200);
    await expect(bigCard.getByRole("button", { name: "Your plan" })).toBeDisabled({
      timeout: 15_000,
    });
    await expect(bigCard.getByText(/Upgrading/)).toHaveCount(0);
    await expect(
      p.getByText(`Payment received. You're on Big ${tag} (monthly). Thank you!`),
    ).toBeVisible();
    await expect(p.getByText("0 / 1,500").or(p.getByText("0 / 1500"))).toBeVisible();

    // Downgrade: scheduled for the next billing date, shown, and undoable.
    await smallCard.getByRole("button", { name: "Switch at renewal" }).click();
    await expect(smallCard.getByText(/Nothing is charged today/)).toBeVisible();
    await smallCard.getByRole("button", { name: "Schedule change" }).click();
    await expect(p.getByText(new RegExp(`Your plan changes to Small ${tag}`))).toBeVisible();
    await expect(bigCard.getByRole("button", { name: "Your plan" })).toBeDisabled(); // still Big
    await p.getByRole("button", { name: "Keep my current plan" }).click();
    await expect(p.getByText(new RegExp(`Your plan changes to Small ${tag}`))).toHaveCount(0);

    const audit = await db()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.orgId, payerOrg));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "billing.plan_upgraded",
        "billing.plan_change_scheduled",
        "billing.plan_change_cancelled",
      ]),
    );
  } finally {
    await db().delete(schema.subscriptions).where(eq(schema.subscriptions.orgId, payerOrg));
    for (const pl of [small, big])
      if (pl) await db().delete(schema.plans).where(eq(schema.plans.id, pl.id));
    await p.close();
  }
});

test("banners: cancelled (even when Dodo's 'updated' follows the cancellation) and trial ending", async ({
  browser,
}) => {
  const tag = randomUUID().slice(0, 6);
  const p = await (await browser.newContext()).newPage();
  const name = `Banner ${tag}`;
  await signUpWithWorkspace(p, newUser("banner"), name);
  const [org] = await db()
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.name, name));
  const o = org?.id ?? "";
  try {
    // Trial ending tomorrow: a yellow banner on every page.
    await db()
      .update(schema.subscriptions)
      .set({ trialEndsAt: new Date(Date.now() + 20 * 3600_000) })
      .where(eq(schema.subscriptions.orgId, o));
    await p.goto("/app/activity");
    await expect(p.getByText(/Your free trial ends within a day\. Choose a plan/)).toBeVisible();

    // Paid, then cancelled for the end of the period. Dodo sends "cancelled" and "updated" together.
    const subId = `sub_b_${tag}`;
    const end = new Date(Date.now() + 200 * 86_400_000);
    const data = (extra: Record<string, unknown>) => ({
      subscription_id: subId,
      customer: { customer_id: `cus_b_${tag}` },
      product_id: productYearly,
      metadata: { org_id: o },
      previous_billing_date: new Date().toISOString(),
      next_billing_date: end.toISOString(),
      ...extra,
    });
    await post(p, webhook("subscription.active", data({ status: "active" })));
    await post(
      p,
      webhook(
        "subscription.cancelled",
        data({ status: "active", cancel_at_next_billing_date: true }),
      ),
    );
    await post(
      p,
      webhook(
        "subscription.updated",
        data({ status: "active", cancel_at_next_billing_date: true }),
      ),
    );
    await p.goto("/app/activity");
    await expect(
      p.getByText(/Your subscription is cancelled\. TriageFox keeps working until/),
    ).toBeVisible();
    await expect(p.getByRole("link", { name: "Resume or choose a plan" })).toBeVisible();
    await p.goto("/app/billing");
    await expect(p.getByText("Cancelled: access continues until then.")).toBeVisible();
  } finally {
    await db().delete(schema.subscriptions).where(eq(schema.subscriptions.orgId, o));
    await p.close();
  }
});

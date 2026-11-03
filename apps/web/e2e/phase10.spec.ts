import { expect, test } from "@playwright/test";
import { and, eq, schema } from "@triagefox/db";
import { closeOwnerDb, ownerDb } from "./db";
import { BASE, newUser, signUpWithWorkspace } from "./helpers";

test.afterAll(async () => {
  await ownerDb().delete(schema.platformSettings).where(eq(schema.platformSettings.key, "trial"));
  await closeOwnerDb();
});

test("the landing page sells the product and starts a free trial, with no waitlist anywhere", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Perfect tickets out");
  for (const name of [
    "Stop copy-pasting bugs from chat into your tracker",
    "Less copy-paste. Nothing gets lost.",
    "Five minutes to set up",
    "You stay in control",
    "Self-host free forever, or let us host it",
    "Questions",
  ])
    await expect(page.getByRole("heading", { name })).toBeVisible();
  // Six feature cards, each with its own small animation.
  for (const title of [
    "Understands the chat",
    "Priority 1–5 by clear rules",
    "Screenshots attached",
    "Keeps the same ticket updated",
    "Merges duplicates",
    "Never invents due dates",
  ])
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/waitlist/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Start free trial" }).first()).toHaveAttribute(
    "href",
    "/signup",
  );
  // The before/after slider moves.
  const slider = page.getByRole("slider", { name: "Drag to compare" });
  await slider.fill("80");
  await expect(slider).toHaveValue("80");
  // The FAQ opens.
  await page.getByText("What does the AI see?").click();
  await expect(page.getByText(/removed before anything is sent/)).toBeVisible();
});

test("the legal, security and guide pages exist, name the operator and link to each other", async ({
  page,
}) => {
  await page.goto("/legal/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  await expect(page.getByText("Kartik Singh Bisht").first()).toBeVisible();
  await expect(page.getByText(/do not store the chat transcripts/)).toBeVisible();
  await expect(page.getByText("Digital Personal Data Protection Act")).toBeVisible();

  await page.goto("/legal/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of service" })).toBeVisible();
  await expect(page.getByText(/governed by the laws of India/)).toBeVisible();
  await expect(page.getByText("Payments are non-refundable")).toBeVisible();

  await page.goto("/legal/subprocessors");
  await expect(page.getByRole("cell", { name: "OpenAI" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Dodo Payments" })).toBeVisible();

  await page.goto("/security");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your data, handled carefully",
  );
  await expect(page.getByText(/cannot read them back/)).toBeVisible();

  await page.goto("/integrations/crisp-to-jira");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Crisp to Jira");
  expect(await page.locator('script[type="application/ld+json"]').first().textContent()).toContain(
    "FAQPage",
  );
  await page.getByRole("main").getByRole("link", { name: "Crisp to Trello" }).click();
  await expect(page).toHaveURL(/crisp-to-trello/);

  // The footer carries the legal links on every public page.
  await expect(page.getByRole("link", { name: "Privacy" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms" }).first()).toBeVisible();
});

test("search engines get a sitemap and a robots file that keeps the product pages private", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /app");
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain("Sitemap:");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/pricing", "/legal/privacy", "/integrations/crisp-to-trello"])
    expect(sitemap).toContain(p);
  expect(sitemap).not.toContain("/app");
  expect((await request.get("/icon.svg")).status()).toBe(200);
  expect((await request.get("/opengraph-image")).headers()["content-type"]).toBe("image/png");
});

test("the trial length shown to visitors comes from the settings, not from the page", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page.getByText(/Try it free for 7 days/)).toBeVisible();
  await ownerDb()
    .insert(schema.platformSettings)
    .values({
      key: "trial",
      value: { days: 9, conversationCap: 50, cardRequired: false, unlimitedWithOwnKey: true },
    })
    .onConflictDoUpdate({
      target: schema.platformSettings.key,
      set: {
        value: { days: 9, conversationCap: 50, cardRequired: false, unlimitedWithOwnKey: true },
      },
    });
  await page.goto("/pricing");
  await expect(page.getByText(/Try it free for 9 days/)).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(/9-day free trial, no card needed/).first()).toBeVisible();
});

test("sign-in and sign-up forms can never put a password in the address bar", async ({ page }) => {
  for (const path of ["/login", "/signup", "/forgot-password"]) {
    await page.goto(path);
    expect(await page.locator("form").first().getAttribute("method")).toBe("post");
  }
});

test("a flood of changes from one workspace is slowed down, and other workspaces are unaffected", async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signUpWithWorkspace(a, newUser("Flood"), `Flood ${Date.now()}`);
  await signUpWithWorkspace(b, newUser("Calm"), `Calm ${Date.now()}`);
  const hit = (p: typeof a) =>
    p.request.post("/api/automation", { headers: { origin: BASE } }).then((r) => r.status());
  const statuses: number[] = [];
  for (let i = 0; i < 320; i += 40)
    statuses.push(...(await Promise.all(Array.from({ length: 40 }, () => hit(a)))));
  expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  expect(statuses.slice(0, 250).every((s) => s === 400)).toBe(true); // "Connect Crisp first", not limited yet
  expect(await hit(b)).toBe(400); // the other workspace still gets normal answers
  await a.close();
  await b.close();
});

test("the top menu has one Docs link that opens in a new tab, and guide buttons show their text", async ({
  page,
}) => {
  await page.goto("/integrations/crisp-to-jira");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Docs" })).toHaveAttribute("target", "_blank");
  await expect(nav.getByRole("link", { name: /GitHub/ })).toHaveCount(0);
  const cta = page.getByRole("main").getByRole("link", { name: "Start free trial" });
  // Dark text on the orange button, not orange-on-orange.
  const [text, bg] = await cta.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.color, s.backgroundColor];
  });
  expect(text).not.toBe(bg);
});

test("Continue with Google shows on sign-in and sign-up only when Google is configured", async ({
  page,
}) => {
  const on = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  for (const path of ["/signup", "/login"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /with Google/ })).toHaveCount(on ? 1 : 0);
  }
});

test("someone who signed in with Google (no password) can add one, then set up two-factor", async ({
  page,
}) => {
  const user = newUser("nopw");
  await signUpWithWorkspace(page, user, "No Password Co");
  // Make this account look like a Google sign-up: no password sign-in method.
  const row = await ownerDb().query.user.findFirst({ where: eq(schema.user.email, user.email) });
  await ownerDb()
    .delete(schema.account)
    .where(
      and(eq(schema.account.userId, row?.id ?? ""), eq(schema.account.providerId, "credential")),
    );
  await page.goto("/app/settings/security");
  await expect(page.getByText("has no password yet")).toBeVisible();
  await page.getByLabel("New password").fill("a-brand-new-password");
  await page.getByLabel("Repeat it").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("button", { name: "Set up two-factor" })).toBeVisible();
});

test("the security page still opens when the sign-in is older than 15 minutes", async ({
  page,
}) => {
  const user = newUser("oldsession");
  await signUpWithWorkspace(page, user, "Old Session Co");
  const row = await ownerDb().query.user.findFirst({ where: eq(schema.user.email, user.email) });
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  await ownerDb()
    .update(schema.session)
    .set({ createdAt: hourAgo, updatedAt: hourAgo })
    .where(eq(schema.session.userId, row?.id ?? ""));
  // Drop the short-lived session cache cookie so the server reads the (now old) session from the database.
  await page.context().clearCookies({ name: /session_data/ });
  const res = await page.goto("/app/settings/security");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Where you're signed in" })).toBeVisible();
  await expect(page.getByText("This device")).toBeVisible();
});

test("signed-in people skip the landing page, and public pages offer them their workspace", async ({
  page,
}) => {
  await signUpWithWorkspace(page, newUser("home"), "Home Redirect Co");
  await page.goto("/");
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/pricing");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Open your workspace" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Start free trial" })).toHaveCount(0);
});

test("visitors in India see rupee prices, everyone else dollars (Cloudflare's country header)", async ({
  browser,
}) => {
  const visit = async (country: string, path: string) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { "cf-ipcountry": country } });
    const p = await ctx.newPage();
    await p.goto(path);
    const text = (await p.getByRole("main").textContent()) ?? "";
    await ctx.close();
    return text;
  };
  const rupeePrice = /₹[\d,]+(\.\d+)? \/ month/;
  const dollarPrice = /\$[\d,]+(\.\d+)? \/ month/;
  for (const path of ["/", "/pricing"]) {
    const inr = await visit("IN", path);
    test.skip(!rupeePrice.test(inr) && !dollarPrice.test(inr), "no public plans in this database");
    expect(inr).toMatch(rupeePrice);
    expect(inr).not.toMatch(dollarPrice);
    const usd = await visit("US", path);
    expect(usd).toMatch(dollarPrice);
    expect(usd).not.toMatch(rupeePrice);
  }
});

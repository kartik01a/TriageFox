import { expect, type Page, test } from "@playwright/test";
import { PASSWORD, signUp } from "./helpers";
import { waitForLink } from "./mail";

const stamp = Date.now();
// Each run uses its own client address so the waitlist rate limit never trips repeated runs.
const clientIp = `10.${stamp % 250}.${(stamp >> 8) % 250}.${(stamp >> 4) % 250}`;
test.use({ extraHTTPHeaders: { "x-forwarded-for": clientIp } });
const owner = { name: "Olivia Owner", email: `owner-${stamp}@example.test` };
const teammate = { name: "Tim Teammate", email: `tim-${stamp}@example.test` };
let realInvitationPath = "";

test.describe.configure({ mode: "serial" });

test("landing page shows the product and the waitlist works", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Perfect tickets out");
  await expect(page.getByRole("heading", { name: "Understands the chat" })).toBeVisible();

  const email = `wait-${stamp}@example.test`;
  await page.locator("#waitlist-email").first().fill(email);
  await page.getByRole("button", { name: "Join the waitlist" }).first().click();
  await expect(page.getByText("You're on the list").first()).toBeVisible();

  // Duplicate sign-up gets the same answer (no email enumeration); a bad email is rejected.
  const dup = await request.post("/api/waitlist", { data: { email } });
  expect((await dup.json()).ok).toBe(true);
  const bad = await request.post("/api/waitlist", { data: { email: "nope" } });
  expect(bad.status()).toBe(400);
});

test("security headers and CSP nonce are set", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age");
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});

test("sign up, verify email, create a workspace, invite and accept", async ({ page, browser }) => {
  // 1. Owner signs up, must confirm email, then creates a workspace.
  await signUp(page, owner);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill("Acme Inc.");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Acme Inc." })).toBeVisible();

  // 2. Owner invites a teammate.
  await page.goto("/app/members");
  await page.getByLabel("Email").fill(teammate.email);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  await expect(page.getByText(teammate.email)).toBeVisible();

  // 3. Teammate follows the emailed link, signs up, and accepts.
  const inviteLink = await waitForLink(
    teammate.email,
    /http:\/\/localhost:3000\/accept-invitation\/\S+/,
  );
  realInvitationPath = new URL(inviteLink).pathname;
  const ctx = await browser.newContext();
  const tp = await ctx.newPage();
  await tp.goto(inviteLink); // signed out -> /login?next=...
  await expect(tp).toHaveURL(/\/login\?next=/);
  await signUp(tp, teammate, new URL(inviteLink).pathname);
  await expect(tp.getByRole("heading", { name: "Join Acme Inc." })).toBeVisible();
  await tp.getByRole("button", { name: "Accept invitation" }).click();
  await expect(tp.getByRole("heading", { name: "Acme Inc." })).toBeVisible();

  // 4. Owner now sees two members.
  await page.reload();
  await page.goto("/app/members");
  await expect(page.getByRole("heading", { name: "Members (2)" })).toBeVisible();
  await expect(page.getByText(teammate.name)).toBeVisible();
  await ctx.close();
});

test("a stranger cannot use someone else's invitation", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const stranger = { name: "Sam Stranger", email: `sam-${stamp}@example.test` };
  await signUp(page, stranger);
  // A real invitation that was sent to a different email address must not be usable...
  await page.goto(realInvitationPath);
  await expect(page.getByRole("heading", { name: "Invitation not available" })).toBeVisible();
  // ...and neither does an invented one.
  await page.goto("/accept-invitation/does-not-exist");
  await expect(page.getByRole("heading", { name: "Invitation not available" })).toBeVisible();
  await ctx.close();
});

test("wrong password is rejected without revealing which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill("not-the-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});

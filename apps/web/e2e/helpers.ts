import { expect, type Page } from "@playwright/test";
import { waitForLink } from "./mail";

export const PASSWORD = "correct-horse-battery";
export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
/** BASE escaped for use inside a regular expression (links in emails start with it). */
export const BASE_RE = BASE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export interface TestUser {
  name: string;
  email: string;
}

export function newUser(label: string): TestUser {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return { name: `${label} Tester`, email: `${label.toLowerCase()}-${id}@example.test` };
}

/** Waits until React has attached its handlers to the page's submit button (the page's script has run). */
export async function waitForHydration(page: Page, selector = "form button[type=submit]") {
  await page
    .waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
      },
      selector,
      { timeout: 30_000 },
    )
    .catch(() => {});
}

/** Sign up through the UI and confirm the email via Mailpit. Leaves the page signed in. */
export async function signUp(page: Page, user: TestUser, next?: string) {
  await page.goto(next ? `/signup?next=${encodeURIComponent(next)}` : "/signup");
  const sent = page.getByRole("heading", { name: "Check your inbox" });
  // A freshly started test server can take a while to load the page's script; a click before that
  // just reloads the form. Wait for the page to settle, and try once more if it reloaded anyway.
  for (let attempt = 0; attempt < 2; attempt++) {
    await waitForHydration(page);
    await page.getByLabel("Your name").fill(user.name);
    await page.getByLabel("Work email").fill(user.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    const ok = await sent
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) break;
  }
  await expect(sent).toBeVisible();
  const link = await waitForLink(user.email, new RegExp(`${BASE_RE}/api/auth/verify-email\\S+`));
  await page.goto(link);
}

/** Sign up and create a workspace. Returns once the overview is shown. */
export async function signUpWithWorkspace(page: Page, user: TestUser, workspaceName: string) {
  await signUp(page, user);
  await expect(page).toHaveURL(/\/app\/onboarding/);
  await page.getByLabel("Workspace name").fill(workspaceName);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: workspaceName })).toBeVisible();
}

/** Owner invites `invitee` and returns the invitation path (from the email in Mailpit). */
export async function inviteMember(
  ownerPage: Page,
  inviteeEmail: string,
  role: "member" | "admin" = "member",
) {
  await ownerPage.goto("/app/members");
  await ownerPage.getByLabel("Email").fill(inviteeEmail);
  await ownerPage.getByLabel("Role").selectOption(role);
  await ownerPage.getByRole("button", { name: "Send invitation" }).click();
  await expect(ownerPage.getByText("Invitation sent.")).toBeVisible();
  const link = await waitForLink(inviteeEmail, new RegExp(`${BASE_RE}/accept-invitation/\\S+`));
  return new URL(link).pathname;
}

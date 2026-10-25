import { expect, type Page } from "@playwright/test";
import { waitForLink } from "./mail";

export const PASSWORD = "correct-horse-battery";
export const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export interface TestUser {
  name: string;
  email: string;
}

export function newUser(label: string): TestUser {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return { name: `${label} Tester`, email: `${label.toLowerCase()}-${id}@example.test` };
}

/** Sign up through the UI and confirm the email via Mailpit. Leaves the page signed in. */
export async function signUp(page: Page, user: TestUser, next?: string) {
  await page.goto(next ? `/signup?next=${encodeURIComponent(next)}` : "/signup");
  await page.getByLabel("Your name").fill(user.name);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  const link = await waitForLink(user.email, /http:\/\/localhost:3000\/api\/auth\/verify-email\S+/);
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
  const link = await waitForLink(inviteeEmail, /http:\/\/localhost:3000\/accept-invitation\/\S+/);
  return new URL(link).pathname;
}

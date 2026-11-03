import "server-only";
import {
  type BillingProvider,
  billingSummary,
  DodoProvider,
  FakeProvider,
} from "@triagefox/billing";
import { eq, schema, withOrg } from "@triagefox/db";
import { db } from "./db";
import { env } from "./env";

/** Billing exists only in the hosted version. */
export const billingEnabled = () => env().APP_MODE === "hosted";

let fake: FakeProvider | undefined;

/** The payment provider, or null when its keys are not configured on this server. */
export function billingProvider(): BillingProvider | null {
  const e = env();
  if (!billingEnabled()) return null;
  // Only the automated browser tests use the stand-in provider (no real payments); never in production.
  if (process.env.E2E_FAKE_BILLING === "true" && e.NODE_ENV !== "production") {
    fake ??= new FakeProvider({ name: "dodo" });
    return fake;
  }
  if (!e.DODO_API_KEY || !e.DODO_WEBHOOK_SECRET) return null;
  return new DodoProvider({
    apiKey: e.DODO_API_KEY,
    webhookKey: e.DODO_WEBHOOK_SECRET,
    mode: e.DODO_ENV,
  });
}

/** INR for visitors in India (Cloudflare's free country header), USD for everyone else. */
export function currencyFor(
  country: string | null | undefined,
  override?: string | null,
): "USD" | "INR" {
  if (override === "USD" || override === "INR") return override;
  return country?.toUpperCase() === "IN" ? "INR" : "USD";
}

const SYMBOL: Record<string, string> = { USD: "$", INR: "₹" };

/** `900` USD -> "$9", `69900` INR -> "₹699". Whole units; prices are chosen as round numbers. */
export function formatPrice(minor: number, currency: string) {
  const v = minor / 100;
  const text = Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2);
  return `${SYMBOL[currency] ?? `${currency} `}${text}`;
}

/** The workspace's plan, usage and whether new chats are blocked (hosted only). */
export async function workspaceBilling(orgId: string) {
  const [key] = await withOrg(db(), orgId, (tx) =>
    tx
      .select({ hint: schema.aiSettings.keyHint })
      .from(schema.aiSettings)
      .where(eq(schema.aiSettings.orgId, orgId)),
  );
  return billingSummary(db(), orgId, !!key?.hint);
}

/** Blocks that only a plan fixes: the Overview page sends these workspaces to Billing. */
export const NEEDS_A_PLAN = new Set(["trial_ended", "plan_ended", "no_plan"]);

/** Said wherever a block is shown: chats that arrive meanwhile are not ticketed later. */
export const BLOCKED_NOTE = "Chats that arrive until then won't become tickets.";

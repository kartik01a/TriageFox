import "server-only";
import { DodoProvider } from "@triagefox/billing";
import { env } from "./env";

/** Billing exists only in the hosted version. */
export const billingEnabled = () => env().APP_MODE === "hosted";

/** The payment provider, or null when its keys are not configured on this server. */
export function billingProvider(): DodoProvider | null {
  const e = env();
  if (!billingEnabled() || !e.DODO_API_KEY || !e.DODO_WEBHOOK_SECRET) return null;
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

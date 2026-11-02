/**
 * Development only: links a Crisp website without the in-Crisp widget.
 *
 * Crisp only shows a plugin's widget once the plugin is activated, and activation needs a production
 * token (Crisp's review). Until then this does what the widget would do: it asks Crisp, with the
 * development token, for the website's plugin token and prints the exact page address Crisp would open.
 * Opening it runs the normal flow (token check → "Continue in TriageFox" → confirm the workspace).
 *
 *   pnpm --filter @triagefox/worker dev:crisp-link [websiteId]   (default: CRISP_WEBSITE_ID from .env)
 *
 * The printed address works for anyone who opens it, so treat it like a password and do not share it.
 */
import { CrispPluginClient } from "@triagefox/connectors";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") fail("This helper is for local development only.");
const { CRISP_PLUGIN_ID, CRISP_PLUGIN_KEY, CRISP_PLUGIN_UUID, APP_URL } = process.env;
if (!CRISP_PLUGIN_ID || !CRISP_PLUGIN_KEY || !CRISP_PLUGIN_UUID)
  fail("Set CRISP_PLUGIN_ID, CRISP_PLUGIN_KEY and CRISP_PLUGIN_UUID in .env first.");
const websiteId = process.argv[2] ?? process.env.CRISP_WEBSITE_ID;
if (!websiteId) fail("Pass the Crisp website id, or set CRISP_WEBSITE_ID in .env.");

const crisp = new CrispPluginClient({
  identifier: CRISP_PLUGIN_ID,
  key: CRISP_PLUGIN_KEY,
  pluginId: CRISP_PLUGIN_UUID,
});
let token: string;
try {
  token = await crisp.getSubscriptionToken(websiteId);
} catch (err) {
  fail(
    `Crisp did not return a plugin token for ${websiteId}. Is that website a trusted workspace of the plugin? (${(err as Error).message})`,
  );
}
const name = await crisp.getWebsiteName(websiteId).catch(() => undefined);
const url = new URL("/crisp/link", APP_URL ?? "http://localhost:3000");
url.searchParams.set("website_id", websiteId);
url.searchParams.set("token", token);
url.searchParams.set("locale", "en");
console.log(`Crisp website: ${name ?? websiteId}`);
console.log("Open this address in the browser where you are signed in to TriageFox:\n");
console.log(url.toString());

import {
  generateKeyPair,
  keyringFromEnv,
  openSecret,
  type PrivateKeyring,
  sealSecret,
} from "@triagefox/crypto";
import { parseEnv, type WorkerEnv, workerEnvSchema } from "@triagefox/shared";

export function loadConfig(
  source: NodeJS.ProcessEnv = process.env,
): WorkerEnv & { keyring: PrivateKeyring } {
  const env = parseEnv(workerEnvSchema, source);
  const keyring = keyringFromEnv(env);
  if (!("privateKeys" in keyring)) throw new Error("CRYPTO_PRIVATE_KEYS is required in the worker");
  return { ...env, keyring };
}

/**
 * Fail fast on a wrong or mismatched key pair: seal with the public key, open with the private one.
 * Without this a bad key would only show up when a customer's token is first needed.
 */
export async function verifyKeyring(keyring: PrivateKeyring) {
  const binding = { orgId: "selftest", recordId: "selftest", purpose: "startup.selftest" };
  const sealed = await sealSecret("ok", binding, keyring);
  const opened = await openSecret(sealed, binding, keyring);
  if (opened !== "ok") throw new Error("Sealed-box self-test failed");
}

export { generateKeyPair };

/** What this installation can and cannot do, from its configuration. Logged at startup; no secret values. */
export function describeProviders(c: {
  APP_MODE: string;
  OPENAI_API_KEY?: string;
  TRELLO_API_KEY?: string;
  ATLASSIAN_CLIENT_ID?: string;
  ATLASSIAN_CLIENT_SECRET?: string;
  LINEAR_CLIENT_ID?: string;
  LINEAR_CLIENT_SECRET?: string;
  CRISP_PLUGIN_ID?: string;
  CRISP_PLUGIN_KEY?: string;
  CRISP_PLUGIN_UUID?: string;
}) {
  const warnings: string[] = [];
  const crisp = !!(c.CRISP_PLUGIN_ID && c.CRISP_PLUGIN_KEY && c.CRISP_PLUGIN_UUID);
  const trello = !!c.TRELLO_API_KEY;
  const jira = !!(c.ATLASSIAN_CLIENT_ID && c.ATLASSIAN_CLIENT_SECRET);
  const linear = !!(c.LINEAR_CLIENT_ID && c.LINEAR_CLIENT_SECRET);
  if (!crisp)
    warnings.push(
      "Crisp is not configured (CRISP_PLUGIN_ID, CRISP_PLUGIN_KEY, CRISP_PLUGIN_UUID): no chats can be read.",
    );
  if (!trello && !jira && !linear)
    warnings.push(
      "None of Trello (TRELLO_API_KEY), Jira (ATLASSIAN_CLIENT_ID/SECRET) or Linear (LINEAR_CLIENT_ID/SECRET) is configured: there is nowhere to send tickets.",
    );
  if (c.APP_MODE === "selfhost" && !c.OPENAI_API_KEY)
    warnings.push(
      "OPENAI_API_KEY is not set: every workspace must enter its own OpenAI key under AI key.",
    );
  return { crisp, trello, jira, linear, openai: !!c.OPENAI_API_KEY, warnings };
}

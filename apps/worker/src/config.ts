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

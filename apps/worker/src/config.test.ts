import { generateKeyPair } from "@triagefox/crypto";
import { describe, expect, it } from "vitest";
import { loadConfig, verifyKeyring } from "./config";

async function env(overrides: Record<string, string> = {}) {
  const a = await generateKeyPair();
  return {
    DATABASE_URL: "postgres://x",
    REDIS_URL: "redis://x",
    CRYPTO_CURRENT_VERSION: "1",
    CRYPTO_PUBLIC_KEYS: JSON.stringify({ 1: a.publicKey }),
    CRYPTO_PRIVATE_KEYS: JSON.stringify({ 1: a.privateKey }),
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("worker config", () => {
  it("accepts a matching key pair", async () => {
    await expect(verifyKeyring(loadConfig(await env()).keyring)).resolves.toBeUndefined();
  });

  it("rejects a private key that does not match the public key", async () => {
    const other = await generateKeyPair();
    const cfg = loadConfig(
      await env({ CRYPTO_PRIVATE_KEYS: JSON.stringify({ 1: other.privateKey }) }),
    );
    await expect(verifyKeyring(cfg.keyring)).rejects.toThrow();
  });

  it("fails fast naming the missing variable", async () => {
    const e = await env();
    e.CRYPTO_PRIVATE_KEYS = undefined;
    expect(() => loadConfig(e)).toThrow(/CRYPTO_PRIVATE_KEYS/);
  });
});

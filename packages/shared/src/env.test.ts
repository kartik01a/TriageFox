import { describe, expect, it } from "vitest";
import { parseEnv, workerEnvSchema } from "./env";

describe("parseEnv", () => {
  it("names every missing variable", () => {
    expect(() => parseEnv(workerEnvSchema, {})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv(workerEnvSchema, {})).toThrow(/CRYPTO_PRIVATE_KEYS/);
  });

  it("accepts a complete worker environment", () => {
    const env = parseEnv(workerEnvSchema, {
      DATABASE_URL: "postgres://x",
      REDIS_URL: "redis://x",
      CRYPTO_PUBLIC_KEYS: "{}",
      CRYPTO_CURRENT_VERSION: "1",
      CRYPTO_PRIVATE_KEYS: "{}",
    });
    expect(env.APP_MODE).toBe("hosted");
    expect(env.CRYPTO_CURRENT_VERSION).toBe(1);
  });
});

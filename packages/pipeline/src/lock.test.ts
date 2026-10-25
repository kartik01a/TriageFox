import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { LockBusyError, withLock } from "./lock";

const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
afterAll(() => redis.quit());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withLock", () => {
  it("runs one holder at a time", async () => {
    const key = `t-${randomUUID()}`;
    let running = 0;
    let max = 0;
    const work = () =>
      withLock(redis, key, async () => {
        running++;
        max = Math.max(max, running);
        await sleep(80);
        running--;
      });
    await Promise.all([work(), work(), work()]);
    expect(max).toBe(1);
  });

  it("fails fast with LockBusyError when waiting is not allowed", async () => {
    const key = `t-${randomUUID()}`;
    await withLock(redis, key, async () => {
      await expect(withLock(redis, key, async () => 1, { waitMs: 0 })).rejects.toBeInstanceOf(
        LockBusyError,
      );
    });
    expect(await withLock(redis, key, async () => "free again", { waitMs: 0 })).toBe("free again");
  });

  it("is released even when the work throws", async () => {
    const key = `t-${randomUUID()}`;
    await expect(
      withLock(redis, key, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await withLock(redis, key, async () => "ok", { waitMs: 0 })).toBe("ok");
  });

  it("is renewed while slow work runs, so nobody else can take it", async () => {
    const key = `t-${randomUUID()}`;
    await withLock(
      redis,
      key,
      async () => {
        await sleep(3500); // longer than the 3s ttl
        await expect(withLock(redis, key, async () => 1, { waitMs: 0 })).rejects.toBeInstanceOf(
          LockBusyError,
        );
      },
      { ttlMs: 3000 },
    );
  });

  it("does not release a lock it no longer owns", async () => {
    const key = `t-${randomUUID()}`;
    await withLock(redis, key, async () => {
      await redis.set(`lock:${key}`, "someone-else"); // simulate expiry + takeover
    });
    expect(await redis.get(`lock:${key}`)).toBe("someone-else");
  });
});

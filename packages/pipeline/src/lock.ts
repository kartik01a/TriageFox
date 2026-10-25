import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export class LockBusyError extends Error {
  constructor(key: string) {
    super(`Lock busy: ${key}`);
    this.name = "LockBusyError";
  }
}

const RELEASE = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) end return 0`;
const RENEW = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("pexpire",KEYS[1],ARGV[2]) end return 0`;

/**
 * Runs `fn` while holding a Redis lock. The lock is renewed while `fn` runs (so slow work, such as an
 * AI call, never loses it) and expires by itself if the process dies. `waitMs: 0` fails immediately
 * with LockBusyError instead of waiting.
 */
export async function withLock<T>(
  redis: Redis,
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? 60_000;
  const deadline = Date.now() + (opts.waitMs ?? 15_000);
  const token = randomUUID();
  const redisKey = `lock:${key}`;
  while (!(await redis.set(redisKey, token, "PX", ttlMs, "NX"))) {
    if (Date.now() >= deadline) throw new LockBusyError(key);
    await new Promise((r) => setTimeout(r, 100));
  }
  const timer = setInterval(
    () => {
      void redis.eval(RENEW, 1, redisKey, token, String(ttlMs)).catch(() => {});
    },
    Math.max(1000, Math.floor(ttlMs / 3)),
  );
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    await redis.eval(RELEASE, 1, redisKey, token).catch(() => {});
  }
}

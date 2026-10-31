import "server-only";
import { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

/** The two Redis commands a fixed-window counter needs (so tests can pass a stand-in). */
export interface Counter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * Fixed-window rate limit shared by every web process (Redis), for routes that act for a workspace or an admin and
 * for the public hook endpoints. If Redis is unreachable the request is allowed: a limiter outage must never take
 * the product down (the per-route in-memory limiters and Cloudflare remain).
 */
export async function allow(
  counter: Counter,
  key: string,
  limit: number,
  windowSec: number,
  now = Date.now(),
): Promise<boolean> {
  try {
    const bucket = `rl:${key}:${Math.floor(now / (windowSec * 1000))}`;
    const n = await counter.incr(bucket);
    if (n === 1) await counter.expire(bucket, windowSec + 5);
    return n <= limit;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "rate limiter unavailable: allowing the request");
    return true;
  }
}

const g = globalThis as unknown as { __triagefoxLimitRedis?: Redis };

function redis(): Redis {
  g.__triagefoxLimitRedis ??= new Redis(env().REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // fail fast instead of queueing while Redis is down
    lazyConnect: false,
  }).on("error", () => undefined);
  return g.__triagefoxLimitRedis;
}

/** `allowRequest("org:abc:write", 300, 60)`: at most 300 per minute for that key. */
export const allowRequest = (key: string, limit: number, windowSec: number) =>
  allow(redis(), key, limit, windowSec);

export const tooMany = () =>
  new Response(JSON.stringify({ ok: false, error: "Too many requests. Please slow down." }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": "30" },
  });

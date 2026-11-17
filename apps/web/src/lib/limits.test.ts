import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ env: () => ({ REDIS_URL: "redis://localhost:1" }) }));
vi.mock("./logger", () => ({ logger: { warn() {}, error() {}, info() {} } }));

const counter = () => {
  const counts = new Map<string, number>();
  const ttl = new Map<string, number>();
  return {
    counts,
    ttl,
    incr: async (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1).get(k) as number,
    expire: async (k: string, s: number) => void ttl.set(k, s),
  };
};

describe("allow", () => {
  it("allows up to the limit in a window, then refuses, then allows again in the next window", async () => {
    const { allow } = await import("./limits");
    const c = counter();
    const t = 1_700_000_000_000;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await allow(c, "org:a", 3, 60, t));
    expect(results).toEqual([true, true, true, false, false]);
    expect(await allow(c, "org:a", 3, 60, t + 61_000)).toBe(true); // a new window
    expect(await allow(c, "org:b", 3, 60, t)).toBe(true); // another key is independent
  });

  it("sets an expiry once per window so counters clean themselves up", async () => {
    const { allow } = await import("./limits");
    const c = counter();
    await allow(c, "k", 10, 60, 1_700_000_000_000);
    await allow(c, "k", 10, 60, 1_700_000_000_000);
    expect(c.ttl.size).toBe(1);
    expect([...c.ttl.values()][0]).toBeGreaterThanOrEqual(60);
  });

  it("lets requests through when Redis is down instead of breaking the product", async () => {
    const { allow } = await import("./limits");
    const broken = {
      incr: async () => {
        throw new Error("ECONNREFUSED");
      },
      expire: async () => {},
    };
    expect(await allow(broken, "k", 1, 60)).toBe(true);
  });
});

describe("whenReady", () => {
  const fake = (status: string) => Object.assign(new EventEmitter(), { status });

  it("returns at once when the connection is already ready", async () => {
    const { whenReady } = await import("./limits");
    const c = fake("ready");
    await whenReady(c as never, 10_000); // would time the test out if it waited
    expect(c.listenerCount("ready")).toBe(0);
  });

  it("waits for the connection instead of failing the first request after a start", async () => {
    const { whenReady } = await import("./limits");
    const c = fake("connecting");
    const waiting = whenReady(c as never, 10_000);
    setTimeout(() => c.emit("ready"), 5);
    await waiting;
    expect(c.listenerCount("ready")).toBe(0);
  });

  it("gives up after the time limit, so a Redis outage still fails open", async () => {
    vi.useFakeTimers();
    try {
      const { whenReady } = await import("./limits");
      const c = fake("reconnecting");
      const waiting = whenReady(c as never, 1000);
      await vi.advanceTimersByTimeAsync(1000);
      await waiting;
      expect(c.listenerCount("ready")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

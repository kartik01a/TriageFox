import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";
import { parseWaitlist } from "./waitlist";

describe("parseWaitlist", () => {
  it("accepts a valid email and normalises it", () => {
    expect(parseWaitlist({ email: "  Jane@Example.COM " })).toEqual({
      kind: "store",
      email: "jane@example.com",
      source: null,
    });
  });
  it("rejects invalid input", () => {
    for (const bad of [{}, { email: "nope" }, { email: "" }, { email: 5 }, null, "x"]) {
      expect(parseWaitlist(bad).kind).toBe("invalid");
    }
  });
  it("silently ignores bots that fill the honeypot", () => {
    expect(parseWaitlist({ email: "bot@example.com", website: "http://spam" }).kind).toBe("ignore");
  });
});

describe("rate limiter", () => {
  it("allows up to the limit per window, then blocks, then recovers", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect([rl.allow("a"), rl.allow("a"), rl.allow("a"), rl.allow("a")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(rl.allow("b")).toBe(true); // other keys are independent
    t = 1001;
    expect(rl.allow("a")).toBe(true);
  });
});

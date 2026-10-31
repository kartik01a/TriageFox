import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

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

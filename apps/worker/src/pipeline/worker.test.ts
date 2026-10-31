import { describe, expect, it } from "vitest";
import { retryDelayMs } from "./worker";

describe("retry delay", () => {
  it("grows 15 s, 30 s, 60 s... and stops at 15 minutes", () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n))).toEqual([15_000, 30_000, 60_000, 120_000]);
    expect(retryDelayMs(30)).toBe(15 * 60_000);
  });
  it("obeys the provider's Retry-After instead, within reason", () => {
    expect(retryDelayMs(1, Object.assign(new Error("429"), { retryAfterSec: 90 }))).toBe(90_500);
    expect(retryDelayMs(1, Object.assign(new Error("429"), { retryAfterSec: 999_999 }))).toBe(
      3_600_500,
    );
    expect(retryDelayMs(2, new Error("plain"))).toBe(30_000);
  });
});

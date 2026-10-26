import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./env", () => ({ env: () => ({ APP_URL: "http://localhost:3000" }) }));
vi.mock("./workspace", () => ({ resolveWorkspace: async () => null }));

describe("isFresh (step-up)", () => {
  it("accepts a sign-in from the last 15 minutes and rejects an older one", async () => {
    const { isFresh, FRESH_MS } = await import("./guards");
    const now = Date.now();
    expect(isFresh(new Date(now - 60_000), now)).toBe(true);
    expect(isFresh(new Date(now - FRESH_MS + 1000), now)).toBe(true);
    expect(isFresh(new Date(now - FRESH_MS - 1000), now)).toBe(false);
    expect(isFresh(new Date(now - 24 * 3600 * 1000).toISOString(), now)).toBe(false);
  });
});

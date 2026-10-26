import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: () => ({}) }));
vi.mock("./env", () => ({ env: () => ({}) }));

describe("self-host sign-up", () => {
  it("opens for the first account, then only by invitation unless the operator opens it", async () => {
    const { selfhostSignupOpen } = await import("./auth");
    expect(selfhostSignupOpen({ users: 0, openSignup: false })).toBe(true);
    expect(selfhostSignupOpen({ users: 1, openSignup: false })).toBe(false);
    expect(selfhostSignupOpen({ users: 7, openSignup: true })).toBe(true);
  });
});

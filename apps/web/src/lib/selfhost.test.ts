import { describe, expect, it } from "vitest";
import { selfhostSignupOpen } from "./signup-rules";

describe("self-host sign-up", () => {
  it("opens for the first account, then only by invitation unless the operator opens it", () => {
    expect(selfhostSignupOpen({ users: 0, openSignup: false })).toBe(true);
    expect(selfhostSignupOpen({ users: 1, openSignup: false })).toBe(false);
    expect(selfhostSignupOpen({ users: 7, openSignup: true })).toBe(true);
  });
});

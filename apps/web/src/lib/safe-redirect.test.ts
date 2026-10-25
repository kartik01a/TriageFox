import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/accept-invitation/abc")).toBe("/accept-invitation/abc");
    expect(safeNext("/app?x=1")).toBe("/app?x=1");
  });
  it("rejects external and tricky targets", () => {
    for (const bad of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ]) {
      expect(safeNext(bad as string | null | undefined)).toBe("/app");
    }
  });
});

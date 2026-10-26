import { describe, expect, it } from "vitest";
import { redact } from "./redact";

const r = (s: string) => redact(s).text;

describe("redact", () => {
  it("removes email addresses", () => {
    expect(r("write to jane.doe+test@example.co.uk please")).toBe("write to [email] please");
    expect(redact("a@b.co and c@d.io").count).toBe(2);
  });

  it("removes phone numbers in common formats, including contiguous Indian mobiles", () => {
    for (const p of [
      "+1 415-555-2671",
      "(415) 555-2671",
      "415.555.2671",
      "+91 98765 43210",
      "98765 43210",
      "9876543210",
      "+44 20 7946 0958",
    ]) {
      expect(r(`call me on ${p} thanks`), p).toBe("call me on [phone] thanks");
    }
  });

  it("leaves dates, versions, order numbers and short numbers alone", () => {
    for (const s of [
      "on 2026-10-26 it broke",
      "version 1.2.3.4 fails",
      "error 500 on page 42",
      "order #1234567 is missing",
      "see 10/26/2026",
      "ticket 123456789012345678",
    ]) {
      expect(r(s), s).toBe(s);
    }
  });

  it("removes card numbers that pass the Luhn check, but not other long numbers", () => {
    expect(r("card 4111 1111 1111 1111 declined")).toBe("card [card] declined");
    expect(r("card 4111-1111-1111-1111 declined")).toBe("card [card] declined");
    expect(r("my number 4111111111111112 is wrong")).toContain("4111111111111112"); // fails Luhn: not a card
  });

  it("removes API keys, tokens, JWTs and private keys", () => {
    expect(r("key is sk-proj-abcdefghijklmnop1234 ok")).toBe("key is [secret] ok"); // secret-scan:ignore fake key
    expect(r(`${"AKIA"}IOSFODNN7EXAMPLE leaked`)).toBe("[secret] leaked");
    expect(r("ghp_" + "a".repeat(36))).toBe("[secret]");
    expect(
      r(
        `auth ${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"].join(".")} ok`,
      ),
    ).toBe("auth [secret] ok");
    expect(
      r(`-----${"BEGIN"} RSA PRIVATE KEY-----\nMIIEow\n-----${"END"} RSA PRIVATE KEY-----`),
    ).toBe("[secret]");
  });

  it("removes the value after a password/token label but keeps the label", () => {
    expect(r("my password is hunter2, can't log in")).toBe("my password is [secret], can't log in");
    expect(r("api_key: abc123def")).toBe("api_key: [secret]");
    expect(r("token=xyz789")).toBe("token=[secret]");
    expect(r("I forgot my password")).toBe("I forgot my password");
  });

  it("is idempotent and reports a count without echoing content", () => {
    const once = redact("mail me at a@b.co, card 4111 1111 1111 1111");
    expect(redact(once.text).text).toBe(once.text);
    expect(once.count).toBe(2);
  });
});

describe("redact: sentence punctuation", () => {
  it("catches phone numbers at the end of a sentence or followed by a comma", () => {
    expect(r("Call +1 415-555-2671.")).toBe("Call [phone].");
    expect(r("Call 415.555.2671, thanks")).toBe("Call [phone], thanks");
    expect(r("Reach me at (415) 555-2671!")).toBe("Reach me at [phone]!");
  });
  it("still leaves version numbers and IPs alone", () => {
    expect(r("fails on 10.1.2.3.4567 build")).toContain("10.1.2.3.4567");
  });
});

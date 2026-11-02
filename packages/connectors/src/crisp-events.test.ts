import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CrispPluginClient,
  normalizeCrispMessage,
  parseCrispHook,
  verifyCrispSignature,
} from "./index";

const SECRET = "hook-secret";
const sign = (ts: string, body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(`[${ts};${body}]`).digest("hex");
const NOW = 1_800_000_000_000;

describe("Crisp hook signature", () => {
  const body = JSON.stringify({ website_id: "w", event: "message:send", data: {}, timestamp: NOW });
  const ts = String(NOW);

  it("accepts a correctly signed, fresh hook", () => {
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: ts,
        signature: sign(ts, body),
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("ok");
  });
  it("rejects a tampered body, a wrong secret and missing headers", () => {
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: ts,
        signature: sign(ts, body),
        rawBody: `${body} `,
        nowMs: NOW,
      }),
    ).toBe("bad_signature");
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: ts,
        signature: sign(ts, body, "other"),
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("bad_signature");
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: ts,
        signature: "short",
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("bad_signature");
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: null,
        signature: sign(ts, body),
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("missing");
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: ts,
        signature: undefined,
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("missing");
  });
  it("rejects a replayed (old) or future-dated hook even when correctly signed", () => {
    const old = String(NOW - 6 * 60_000);
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: old,
        signature: sign(old, body),
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("stale");
    const future = String(NOW + 6 * 60_000);
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: future,
        signature: sign(future, body),
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("stale");
  });
  it("treats the timestamp as milliseconds, not seconds", () => {
    const seconds = String(Math.floor(NOW / 1000));
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: seconds,
        signature: sign(seconds, body),
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("stale");
  });
  it("rejects a non-numeric timestamp", () => {
    expect(
      verifyCrispSignature({
        secret: SECRET,
        timestamp: "abc",
        signature: sign("abc", body),
        rawBody: body,
        nowMs: NOW,
      }),
    ).toBe("bad_signature");
  });
});

const hook = (event: string, data: Record<string, unknown>, timestamp = NOW) =>
  JSON.stringify({ website_id: "site-1", event, data, timestamp });

describe("parseCrispHook", () => {
  it("classifies visitor messages, operator messages and state changes", () => {
    expect(
      parseCrispHook(
        hook("message:send", { from: "user", type: "text", session_id: "s1", fingerprint: 11 }),
      )?.kind,
    ).toBe("visitor_message");
    expect(
      parseCrispHook(
        hook("message:send", { from: "user", type: "file", session_id: "s1", fingerprint: 12 }),
      )?.kind,
    ).toBe("visitor_message");
    expect(
      parseCrispHook(
        hook("message:received", {
          from: "operator",
          type: "text",
          session_id: "s1",
          fingerprint: 13,
        }),
      )?.kind,
    ).toBe("operator_message");
    expect(
      parseCrispHook(hook("session:set_state", { session_id: "s1", state: "resolved" }))?.kind,
    ).toBe("resolved");
    expect(
      parseCrispHook(hook("session:set_state", { session_id: "s1", state: "unresolved" }))?.kind,
    ).toBe("reopened");
  });
  it("ignores system events, notes and unrelated hooks", () => {
    expect(
      parseCrispHook(
        hook("message:received", {
          from: "operator",
          type: "event",
          session_id: "s1",
          fingerprint: 1,
        }),
      )?.kind,
    ).toBe("ignored");
    expect(
      parseCrispHook(
        hook("message:send", { from: "user", type: "note", session_id: "s1", fingerprint: 1 }),
      )?.kind,
    ).toBe("ignored");
    expect(parseCrispHook(hook("plugin:settings", { session_id: "s1" }))?.kind).toBe("ignored");
  });
  it("rejects malformed bodies", () => {
    for (const bad of [
      "",
      "not json",
      "{}",
      JSON.stringify({ website_id: "w" }),
      JSON.stringify({ website_id: "w", event: "e", timestamp: "x" }),
    ]) {
      expect(parseCrispHook(bad)).toBeNull();
    }
  });
  it("has a stable dedupe key per delivery, different across events", () => {
    const a = parseCrispHook(
      hook("message:send", { from: "user", type: "text", session_id: "s1", fingerprint: 11 }),
    );
    const again = parseCrispHook(
      hook("message:send", { from: "user", type: "text", session_id: "s1", fingerprint: 11 }),
    );
    const other = parseCrispHook(
      hook("message:send", { from: "user", type: "text", session_id: "s1", fingerprint: 12 }),
    );
    expect(a?.dedupeKey).toBe(again?.dedupeKey);
    expect(a?.dedupeKey).not.toBe(other?.dedupeKey);
    expect(a?.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
  });
  it("keeps message content out of what gets stored", () => {
    const e = parseCrispHook(
      hook("message:send", {
        from: "user",
        type: "text",
        session_id: "s1",
        fingerprint: 11,
        content: "my card number is 4111",
      }),
    );
    expect(JSON.stringify(e?.meta)).not.toContain("4111");
    expect(JSON.stringify(e)).not.toContain("4111");
  });
});

describe("normalizeCrispMessage", () => {
  it("maps customer text, operator text, notes and files; drops system events", () => {
    expect(
      normalizeCrispMessage({
        fingerprint: 1,
        timestamp: 10,
        type: "text",
        from: "user",
        content: "hi",
      }),
    ).toMatchObject({ role: "customer", kind: "text", text: "hi", fingerprint: "1" });
    expect(
      normalizeCrispMessage({
        fingerprint: 2,
        timestamp: 11,
        type: "text",
        from: "operator",
        content: "yo",
      })?.role,
    ).toBe("operator");
    expect(
      normalizeCrispMessage({
        fingerprint: 3,
        timestamp: 12,
        type: "note",
        from: "operator",
        content: "internal",
      })?.role,
    ).toBe("note");
    expect(
      normalizeCrispMessage({
        fingerprint: 4,
        timestamp: 13,
        type: "file",
        from: "user",
        content: { name: "a.png", url: "https://storage.crisp.chat/x", type: "image/png" },
      }),
    ).toMatchObject({ kind: "file", file: { name: "a.png", mime: "image/png" } });
    expect(
      normalizeCrispMessage({
        fingerprint: 5,
        timestamp: 14,
        type: "event",
        from: "operator",
        content: {},
      }),
    ).toBeNull();
    expect(
      normalizeCrispMessage({ fingerprint: 6, timestamp: 15, type: "text", from: "user" }),
    ).toBeNull();
  });
});

describe("voice messages and unnamed files", () => {
  it("keeps a customer's voice note as a file with a readable name and extension", () => {
    const voice = normalizeCrispMessage({
      fingerprint: 7,
      timestamp: Date.UTC(2026, 10, 2, 9, 5),
      type: "audio",
      from: "user",
      content: { url: "https://storage.crisp.chat/v.webm", type: "audio/webm", duration: 4 },
    });
    expect(voice).toMatchObject({
      role: "customer",
      kind: "file",
      file: { name: "voice-message-2026-11-02-0905.webm", mime: "audio/webm" },
    });
  });

  it("names an unnamed picture and an unknown type without inventing an extension", () => {
    expect(
      normalizeCrispMessage({
        fingerprint: 8,
        timestamp: Date.UTC(2026, 10, 2, 9, 5),
        type: "picture",
        from: "user",
        content: { url: "https://storage.crisp.chat/p", type: "image/png" },
      })?.file?.name,
    ).toBe("image-2026-11-02-0905.png");
    expect(
      normalizeCrispMessage({
        fingerprint: 9,
        timestamp: Date.UTC(2026, 10, 2, 9, 5),
        type: "file",
        from: "user",
        content: { url: "https://storage.crisp.chat/f", type: "application/x-thing" },
      })?.file?.name,
    ).toBe("file-2026-11-02-0905");
  });
});

describe("fetchConversation", () => {
  // 45 messages, Crisp returns the newest 20 per page and `timestamp_before` pages backwards.
  const all = Array.from({ length: 45 }, (_, i) => ({
    fingerprint: 1000 + i,
    timestamp: 5000 + i * 10,
    type: "text",
    from: i % 2 ? "operator" : "user",
    content: `m${i}`,
  }));
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/messages")) {
      const before = Number(url.searchParams.get("timestamp_before") ?? Infinity);
      const page = all.filter((m) => m.timestamp < before).slice(-20);
      return new Response(JSON.stringify({ data: page }));
    }
    return new Response(
      JSON.stringify({
        data: { state: "resolved", updated_at: 9999, meta: { nickname: "Jane", email: "j@x.co" } },
      }),
    );
  }) as typeof fetch;
  const client = new CrispPluginClient({
    identifier: "i",
    key: "k",
    pluginId: "p",
    fetch: fakeFetch,
  });

  it("collects every page, oldest first, without duplicates", async () => {
    const c = await client.fetchConversation("site", "session_1");
    expect(c.messages).toHaveLength(45);
    expect(c.messages[0]?.text).toBe("m0");
    expect(c.messages.at(-1)?.text).toBe("m44");
    expect(new Set(c.messages.map((m) => m.fingerprint)).size).toBe(45);
    expect(c.state).toBe("resolved");
    expect(c.updatedAt).toBe(9999);
    expect(c.customer).toEqual({ nickname: "Jane", email: "j@x.co" });
  });

  it("stops when a page makes no progress instead of looping forever", async () => {
    const stuck = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages"))
        return new Response(JSON.stringify({ data: [all[0]] })); // same page every time
      return new Response(JSON.stringify({ data: {} }));
    }) as typeof fetch;
    const c = await new CrispPluginClient({
      identifier: "i",
      key: "k",
      pluginId: "p",
      fetch: stuck,
    }).fetchConversation("s", "x");
    expect(c.messages).toHaveLength(1);
  });
});

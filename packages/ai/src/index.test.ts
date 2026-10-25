import { describe, expect, it } from "vitest";
import { keyHint, type ModelConfig, validateOpenAiKey } from "./index";

const models: ModelConfig = { default: "m-small", escalation: "m-big", embedding: "m-embed" };
const KEY = "sk-test-0123456789abcdefghijkl"; // secret-scan:ignore fake key

function fake(routes: { models?: Response; probe?: Response; throws?: boolean }) {
  return (async (input: string | URL | Request) => {
    if (routes.throws) throw new Error("network down");
    const url = String(input);
    if (url.endsWith("/models"))
      return (
        routes.models ??
        new Response(
          JSON.stringify({ data: [{ id: "m-small" }, { id: "m-big" }, { id: "m-embed" }] }),
        )
      );
    return routes.probe ?? new Response("{}");
  }) as typeof fetch;
}

describe("validateOpenAiKey", () => {
  it("accepts a working key that can use all our models", async () => {
    expect(await validateOpenAiKey(KEY, { models, fetch: fake({}) })).toEqual({ ok: true });
  });
  it("rejects malformed keys without calling OpenAI", async () => {
    const r = await validateOpenAiKey("hello", { models, fetch: fake({ throws: true }) });
    expect(r).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("rejects an invalid key", async () => {
    const r = await validateOpenAiKey(KEY, {
      models,
      fetch: fake({ models: new Response("{}", { status: 401 }) }),
    });
    expect(r).toMatchObject({ ok: false, reason: "invalid_key" });
  });
  it("names the models the key cannot use", async () => {
    const r = await validateOpenAiKey(KEY, {
      models,
      fetch: fake({ models: new Response(JSON.stringify({ data: [{ id: "m-small" }] })) }),
    });
    expect(r).toMatchObject({ ok: false, reason: "missing_models" });
    expect((r as { message: string }).message).toContain("m-big");
  });
  it("detects missing credit", async () => {
    const r = await validateOpenAiKey(KEY, {
      models,
      fetch: fake({ probe: new Response("{}", { status: 429 }) }),
    });
    expect(r).toMatchObject({ ok: false, reason: "no_quota" });
  });
  it("reports outages and never echoes the key in any message", async () => {
    const r = await validateOpenAiKey(KEY, { models, fetch: fake({ throws: true }) });
    expect(r).toMatchObject({ ok: false, reason: "unavailable" });
    for (const probe of [
      fake({}),
      fake({ throws: true }),
      fake({ models: new Response("{}", { status: 401 }) }),
    ]) {
      const res = await validateOpenAiKey(KEY, { models, fetch: probe });
      expect(JSON.stringify(res)).not.toContain(KEY);
    }
  });
});

describe("keyHint", () => {
  it("shows only the last four characters", () => {
    expect(keyHint("sk-proj-abcdefghijklmnop1234")).toBe("sk-…1234"); // secret-scan:ignore fake key
  });
});

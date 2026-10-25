import { describe, expect, it } from "vitest";
import { RpcError } from "./protocol";
import { dispatch, type RpcHandlers } from "./server";

const conn = { orgId: "org_1", connectionId: "3f1b1c1e-2b6a-4a3e-9d0e-2f0c3c0a1b11" };
const handlers = {
  "trello.verify": async () => ({ username: "kartik", fullName: "K", token: "SECRET-LEAK" }), // extra field must be stripped
  "connection.disconnect": async () => {
    throw new RpcError("auth_expired", "Trello no longer accepts this connection.");
  },
  "connection.check": async () => {
    throw new Error("database password is hunter2");
  },
} as unknown as RpcHandlers;

describe("rpc dispatch", () => {
  it("strips unexpected fields from results (a token can never leak to the web app)", async () => {
    const r = await dispatch(handlers, "trello.verify", conn);
    expect(r).toEqual({ ok: true, data: { username: "kartik", fullName: "K" } });
    expect(JSON.stringify(r)).not.toContain("SECRET-LEAK");
  });

  it("returns typed errors raised by handlers", async () => {
    const r = await dispatch(handlers, "connection.disconnect", conn);
    expect(r).toEqual({
      ok: false,
      error: { code: "auth_expired", message: "Trello no longer accepts this connection." },
    });
  });

  it("hides unexpected errors behind a generic message", async () => {
    const logged: object[] = [];
    const r = await dispatch(handlers, "connection.check", conn, { error: (o) => logged.push(o) });
    expect(JSON.stringify(r)).not.toContain("hunter2");
    expect(r).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(JSON.stringify(logged)).toContain("hunter2"); // details stay in server logs only
  });

  it("rejects unknown methods and malformed input", async () => {
    expect(await dispatch(handlers, "nope", {})).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect(
      await dispatch(handlers, "trello.verify", { orgId: "", connectionId: "x" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
  });
});

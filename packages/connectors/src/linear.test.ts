import { describe, expect, it } from "vitest";
import {
  exchangeLinearCode,
  LinearClient,
  linearAuthorizeUrl,
  linearFileMarkdown,
  linearPriority,
  ProviderError,
  refreshLinearTokens,
} from "./index";

type Handler = (
  url: URL,
  init: RequestInit,
) => { status?: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: r.headers,
    });
  }) as typeof fetch;
  return { fn, calls };
}

const gqlBody = (init: RequestInit) =>
  JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };

describe("Linear auth", () => {
  it("asks for the app actor and only the scopes TriageFox needs", () => {
    const u = new URL(
      linearAuthorizeUrl({ clientId: "C", redirectUri: "http://localhost:3000/cb", state: "S" }),
    );
    expect(u.origin + u.pathname).toBe("https://linear.app/oauth/authorize");
    expect(u.searchParams.get("actor")).toBe("app");
    expect(u.searchParams.get("scope")).toBe("read,issues:create,comments:create");
    expect(u.searchParams.get("state")).toBe("S");
    expect(u.searchParams.get("response_type")).toBe("code");
  });

  it("exchanges a code with a form body and keeps the rotated refresh token", async () => {
    const f = fakeFetch(() => ({
      body: { access_token: "A1", refresh_token: "R1", expires_in: 86399 },
    }));
    const t = await exchangeLinearCode({
      clientId: "C",
      clientSecret: "S",
      code: "CODE",
      redirectUri: "http://x/cb",
      fetch: f.fn,
    });
    expect(t.accessToken).toBe("A1");
    expect(t.refreshToken).toBe("R1");
    expect(t.expiresAt).toBeGreaterThan(Date.now() + 86_000_000);
    expect(t.refreshedAt).toBeLessThanOrEqual(Date.now());
    const sent = new URLSearchParams(String(f.calls[0]?.init.body));
    expect(f.calls[0]?.url.pathname).toBe("/oauth/token");
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("CODE");

    const r = fakeFetch(() => ({
      body: { access_token: "A2", refresh_token: "R2", expires_in: 10 },
    }));
    const next = await refreshLinearTokens({
      clientId: "C",
      clientSecret: "S",
      refreshToken: "R1",
      fetch: r.fn,
    });
    expect(next.refreshToken).toBe("R2");
    expect(new URLSearchParams(String(r.calls[0]?.init.body)).get("refresh_token")).toBe("R1");
  });

  it("treats a refused refresh as revoked access", async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    await expect(
      refreshLinearTokens({ clientId: "C", clientSecret: "S", refreshToken: "dead", fetch: f.fn }),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("Linear mapping", () => {
  it("maps P5..P1 to Urgent, High, Medium, Low, Low", () => {
    expect([5, 4, 3, 2, 1].map(linearPriority)).toEqual([1, 2, 3, 4, 4]);
  });

  it("embeds images and links other files, without breaking markdown", () => {
    expect(linearFileMarkdown("shot.png", "https://u/a", "image/png")).toBe(
      "![shot.png](https://u/a)",
    );
    expect(linearFileMarkdown("log](x).txt", "https://u/b", "text/plain")).toBe(
      "[log  x .txt](https://u/b)",
    );
  });
});

describe("LinearClient", () => {
  it("sends the bearer token and creates an issue", async () => {
    const f = fakeFetch((_u, init) => {
      const { query } = gqlBody(init);
      if (query.includes("issueCreate"))
        return {
          body: {
            data: {
              issueCreate: {
                success: true,
                issue: { id: "i1", identifier: "ACME-1", url: "https://linear.app/x/issue/ACME-1" },
              },
            },
          },
        };
      return { status: 400, body: {} };
    });
    const c = new LinearClient({ accessToken: "TOKEN", fetch: f.fn });
    const made = await c.createIssue({
      teamId: "t",
      title: "T",
      description: "D",
      priority: 2,
      dueDate: "2026-12-01",
    });
    expect(made.identifier).toBe("ACME-1");
    expect(new Headers(f.calls[0]?.init.headers).get("authorization")).toBe("Bearer TOKEN");
    expect(gqlBody(f.calls[0]?.init ?? {}).variables.input).toMatchObject({
      teamId: "t",
      priority: 2,
      dueDate: "2026-12-01",
    });
  });

  it("classifies GraphQL errors: auth, rate limit with Retry-After, not found", async () => {
    const respond = (
      status: number,
      code: string,
      message = "x",
      headers?: Record<string, string>,
    ) =>
      new LinearClient({
        accessToken: "T",
        fetch: fakeFetch(() => ({
          status,
          body: { errors: [{ message, extensions: { code } }] },
          headers,
        })).fn,
      });
    await expect(respond(400, "AUTHENTICATION_ERROR").organization()).rejects.toMatchObject({
      kind: "auth",
    });
    await expect(
      respond(429, "RATELIMITED", "slow", { "retry-after": "30" }).listTeams(),
    ).rejects.toMatchObject({
      kind: "rate_limited",
      retryAfterSec: 30,
    });
    await expect(
      respond(200, "INVALID_INPUT", "Entity not found: Issue").addComment("i", "b"),
    ).rejects.toMatchObject({
      kind: "not_found",
    });
    await expect(
      respond(200, "INVALID_INPUT", "Entity not found: Issue").getIssue("gone"),
    ).resolves.toBeNull();
    const down = new LinearClient({
      accessToken: "T",
      fetch: fakeFetch(() => ({ status: 503, body: "" })).fn,
    });
    await expect(down.listTeams()).rejects.toBeInstanceOf(ProviderError);
  });

  it("keeps only the team's own and workspace labels, never label groups", async () => {
    const f = fakeFetch(() => ({
      body: {
        data: {
          issueLabels: {
            nodes: [
              { id: "a", name: "Bug", color: "#f00", isGroup: false, team: { id: "t1" } },
              { id: "b", name: "Other team", color: null, isGroup: false, team: { id: "t2" } },
              { id: "c", name: "Workspace", color: null, isGroup: false, team: null },
              { id: "d", name: "Group", color: null, isGroup: true, team: null },
            ],
          },
        },
      },
    }));
    const labels = await new LinearClient({ accessToken: "T", fetch: f.fn }).listLabels("t1");
    expect(labels.map((l) => l.id)).toEqual(["a", "c"]);
  });

  it("uploads a file with Linear's signed headers and returns the asset URL", async () => {
    const f = fakeFetch((url) => {
      if (url.hostname === "uploads.example") return { status: 200 };
      return {
        body: {
          data: {
            fileUpload: {
              success: true,
              uploadFile: {
                uploadUrl: "https://uploads.example/put",
                assetUrl: "https://uploads.linear.app/asset",
                headers: [{ key: "x-goog-meta", value: "1" }],
              },
            },
          },
        },
      };
    });
    const url = await new LinearClient({ accessToken: "T", fetch: f.fn }).uploadFile(
      new Blob(["png"], { type: "image/png" }),
      "shot.png",
    );
    expect(url).toBe("https://uploads.linear.app/asset");
    const put = f.calls[1];
    expect(put?.init.method).toBe("PUT");
    const h = new Headers(put?.init.headers);
    expect(h.get("x-goog-meta")).toBe("1");
    expect(h.get("content-type")).toBe("image/png");
    expect(gqlBody(f.calls[0]?.init ?? {}).variables).toMatchObject({
      size: 3,
      filename: "shot.png",
    });
  });
});

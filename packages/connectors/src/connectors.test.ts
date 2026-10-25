import { describe, expect, it } from "vitest";
import {
  analyseCreateFields,
  CrispPluginClient,
  exchangeJiraCode,
  JiraClient,
  jiraAuthorizeUrl,
  ProviderError,
  refreshJiraTokens,
  TrelloClient,
  trelloAuthorizeUrl,
} from "./index";

type Handler = (
  url: URL,
  init: RequestInit,
) => { status?: number; body?: unknown; headers?: Record<string, string> };

/** Fake fetch: routes by URL, records calls. */
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

describe("Trello", () => {
  it("builds an authorize URL that returns the token in the fragment", () => {
    const u = new URL(trelloAuthorizeUrl({ apiKey: "K", returnUrl: "http://localhost:3000/cb" }));
    expect(u.origin + u.pathname).toBe("https://trello.com/1/authorize");
    expect(u.searchParams.get("scope")).toBe("read,write");
    expect(u.searchParams.get("expiration")).toBe("never");
    expect(u.searchParams.get("callback_method")).toBe("fragment");
    expect(u.searchParams.get("return_url")).toBe("http://localhost:3000/cb");
  });

  it("lists only open boards and revokes the token on disconnect", async () => {
    const { fn, calls } = fakeFetch((url, init) => {
      if (url.pathname === "/1/members/me/boards")
        return {
          body: [
            { id: "1", name: "Live", closed: false },
            { id: "2", name: "Old", closed: true },
          ],
        };
      if (init.method === "DELETE") return { body: "" };
      return { body: {} };
    });
    const c = new TrelloClient({ apiKey: "K", token: "T", fetch: fn });
    expect((await c.listBoards()).map((b) => b.name)).toEqual(["Live"]);
    await c.revokeToken();
    const del = calls.at(-1);
    expect(del?.init.method).toBe("DELETE");
    expect(del?.url.pathname).toBe("/1/tokens/T");
  });

  it("classifies errors by kind", async () => {
    for (const [status, kind] of [
      [401, "auth"],
      [404, "not_found"],
      [429, "rate_limited"],
      [503, "unavailable"],
    ] as const) {
      const { fn } = fakeFetch(() => ({
        status,
        body: {},
        headers: status === 429 ? { "retry-after": "7" } : undefined,
      }));
      const err = await new TrelloClient({ apiKey: "K", token: "T", fetch: fn })
        .me()
        .catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.kind).toBe(kind);
      if (status === 429) expect(err.retryAfterSec).toBe(7);
    }
  });

  it("never leaks the token inside error messages", async () => {
    const { fn } = fakeFetch(() => ({ status: 401, body: {} }));
    const err = await new TrelloClient({ apiKey: "KEY123", token: "SECRETTOKEN", fetch: fn })
      .me()
      .catch((e) => e);
    expect(String(err.message)).not.toContain("SECRETTOKEN");
    expect(String(err.message)).not.toContain("KEY123");
  });
});

describe("Jira OAuth", () => {
  it("builds an authorize URL with state and the minimal scopes", () => {
    const u = new URL(
      jiraAuthorizeUrl({ clientId: "C", redirectUri: "http://localhost:3000/cb", state: "abc" }),
    );
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("scope")).toBe(
      "read:jira-work write:jira-work read:jira-user offline_access",
    );
  });

  it("exchanges a code and keeps the rotated refresh token", async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { access_token: "A1", refresh_token: "R1", expires_in: 3600 },
    }));
    const t = await exchangeJiraCode({
      clientId: "C",
      clientSecret: "S",
      code: "code",
      redirectUri: "r",
      fetch: fn,
    });
    expect(t.accessToken).toBe("A1");
    expect(t.refreshToken).toBe("R1");
    expect(t.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    expect(JSON.parse(String(calls[0]?.init.body)).grant_type).toBe("authorization_code");
  });

  it("refresh uses the new refresh token, or keeps the old one if none is returned", async () => {
    const rotated = fakeFetch(() => ({
      body: { access_token: "A2", refresh_token: "R2", expires_in: 3600 },
    }));
    expect(
      (
        await refreshJiraTokens({
          clientId: "C",
          clientSecret: "S",
          refreshToken: "R1",
          fetch: rotated.fn,
        })
      ).refreshToken,
    ).toBe("R2");
    const same = fakeFetch(() => ({ body: { access_token: "A3", expires_in: 3600 } }));
    expect(
      (
        await refreshJiraTokens({
          clientId: "C",
          clientSecret: "S",
          refreshToken: "R1",
          fetch: same.fn,
        })
      ).refreshToken,
    ).toBe("R1");
  });
});

describe("Jira project setup", () => {
  it("blocks required fields we cannot fill, allows the ones we handle", () => {
    const r = analyseCreateFields([
      { fieldId: "summary", name: "Summary", required: true },
      { fieldId: "reporter", name: "Reporter", required: true },
      { fieldId: "issuetype", name: "Issue Type", required: true },
      { fieldId: "customfield_10050", name: "Team", required: true },
      { fieldId: "customfield_10051", name: "Region", required: true, hasDefaultValue: true },
      { fieldId: "customfield_10052", name: "Optional thing", required: false },
      { fieldId: "duedate", name: "Due date", required: false },
    ]);
    expect(r.blockingFields).toEqual([{ id: "customfield_10050", name: "Team" }]);
    expect(r.hasDueDate).toBe(true);
    expect(r.hasPriority).toBe(false); // priority is then set with a second call (Phase 0 finding)
  });

  it("pages through projects and analyses each issue type", async () => {
    const { fn } = fakeFetch((url) => {
      const p = url.pathname;
      if (p.endsWith("/project/search"))
        return url.searchParams.get("startAt") === "0"
          ? { body: { values: [{ id: "1", key: "KAN", name: "Kanban" }], isLast: false } }
          : { body: { values: [{ id: "2", key: "OPS", name: "Ops" }], isLast: true } };
      if (p.endsWith("/issuetypes"))
        return { body: { issueTypes: [{ id: "10006", name: "Bug", subtask: false }] } };
      if (p.endsWith("/issuetypes/10006"))
        return {
          body: {
            fields: [
              { fieldId: "summary", name: "Summary", required: true },
              { fieldId: "customfield_1", name: "Team", required: true },
            ],
          },
        };
      if (p.endsWith("/priority")) return { body: [{ id: "1", name: "Highest" }] };
      return { status: 404, body: {} };
    });
    const j = new JiraClient({ accessToken: "A", cloudId: "cloud", fetch: fn });
    expect((await j.listProjects()).map((x) => x.key)).toEqual(["KAN", "OPS"]);
    const setup = await j.projectSetup("KAN");
    expect(setup.issueTypes[0]?.blockingFields).toEqual([{ id: "customfield_1", name: "Team" }]);
    expect(setup.priorities).toEqual([{ id: "1", name: "Highest" }]);
  });
});

describe("Crisp website token verification", () => {
  const client = (handler: Handler) =>
    new CrispPluginClient({
      identifier: "i",
      key: "k",
      pluginId: "plugin",
      fetch: fakeFetch(handler).fn,
    });

  it("accepts only the exact token Crisp issued", async () => {
    const c = client(() => ({ body: { data: { token: "good-token" } } }));
    expect(await c.verifyWebsiteToken("w", "good-token")).toBe(true);
    expect(await c.verifyWebsiteToken("w", "bad-token!")).toBe(false);
    expect(await c.verifyWebsiteToken("w", "")).toBe(false);
  });

  it("treats a website that has not installed the plugin as unverified", async () => {
    expect(await client(() => ({ status: 404, body: {} })).verifyWebsiteToken("w", "x")).toBe(
      false,
    );
    expect(await client(() => ({ status: 403, body: {} })).verifyWebsiteToken("w", "x")).toBe(
      false,
    );
  });

  it("surfaces Crisp outages instead of silently denying", async () => {
    await expect(
      client(() => ({ status: 500, body: {} })).verifyWebsiteToken("w", "x"),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

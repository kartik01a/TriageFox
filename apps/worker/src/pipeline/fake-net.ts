/** A fake internet for tests: Trello, Jira, Atlassian and the Crisp file host. */
export type Req = { method: string; url: URL; body: string | FormData | null };
export type Route = (r: Req) => { status?: number; body?: unknown } | undefined;

export class FakeNet {
  calls: Req[] = [];
  routes: Route[] = [];
  files = new Map<string, Uint8Array>();
  fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const req: Req = {
      method: init.method ?? "GET",
      url,
      body: (init.body as string | FormData | null | undefined) ?? null,
    };
    this.calls.push(req);
    if (url.hostname === "storage.crisp.chat") {
      const bytes = this.files.get(url.pathname);
      if (!bytes) return new Response("", { status: 404 });
      return new Response(bytes, {
        headers: { "content-type": "image/png", "content-length": String(bytes.length) },
      });
    }
    for (const r of this.routes) {
      const hit = r(req);
      if (hit) {
        return new Response(hit.body === undefined ? "" : JSON.stringify(hit.body), {
          status: hit.status ?? 200,
        });
      }
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  count(method: string, path: RegExp) {
    return this.calls.filter((c) => c.method === method && path.test(c.url.pathname)).length;
  }
  reset() {
    this.calls = [];
    this.routes = [];
  }
}

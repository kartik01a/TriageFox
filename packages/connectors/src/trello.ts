import { type FetchLike, requestJson } from "./http";

const API = "https://api.trello.com/1";

/**
 * Where to send the user to approve access. The token comes back in the URL *fragment* of
 * `returnUrl` (never sent to servers by the browser), and our callback page posts it to us.
 */
export function trelloAuthorizeUrl(opts: { apiKey: string; returnUrl: string; appName?: string }) {
  const url = new URL("https://trello.com/1/authorize");
  url.search = new URLSearchParams({
    key: opts.apiKey,
    name: opts.appName ?? "TriageFox",
    scope: "read,write",
    expiration: "never",
    response_type: "token",
    callback_method: "fragment",
    return_url: opts.returnUrl,
  }).toString();
  return url.toString();
}

export interface TrelloBoard {
  id: string;
  name: string;
  closed: boolean;
}
export interface TrelloList {
  id: string;
  name: string;
}

export class TrelloClient {
  private readonly base: string;
  private readonly fetch: FetchLike;
  constructor(
    private readonly opts: { apiKey: string; token: string; baseUrl?: string; fetch?: FetchLike },
  ) {
    this.base = opts.baseUrl ?? API;
    this.fetch = opts.fetch ?? fetch;
  }

  private call<T>(path: string, params: Record<string, string> = {}, init?: RequestInit) {
    const qs = new URLSearchParams({ key: this.opts.apiKey, token: this.opts.token, ...params });
    return requestJson<T>("trello", this.fetch, `${this.base}${path}?${qs}`, init);
  }

  me() {
    return this.call<{ id: string; username: string; fullName: string }>("/members/me", {
      fields: "username,fullName",
    });
  }

  /** Open boards only, never closed/archived ones (a user's account also holds old boards). */
  async listBoards(): Promise<TrelloBoard[]> {
    const boards = await this.call<TrelloBoard[]>("/members/me/boards", {
      filter: "open",
      fields: "name,closed",
    });
    return boards.filter((b) => !b.closed);
  }

  listLists(boardId: string) {
    return this.call<TrelloList[]>(`/boards/${encodeURIComponent(boardId)}/lists`, {
      filter: "open",
      fields: "name",
    });
  }

  /** Invalidate this token at Trello (used on disconnect). */
  async revokeToken() {
    await this.call(`/tokens/${encodeURIComponent(this.opts.token)}`, {}, { method: "DELETE" });
  }
}

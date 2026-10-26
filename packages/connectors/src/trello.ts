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
export interface TrelloLabel {
  id: string;
  name: string;
  color: string | null;
}
export interface TrelloCard {
  id: string;
  closed: boolean;
  dueComplete?: boolean;
  idLabels: string[];
  desc: string;
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

  private call<T>(
    path: string,
    params: Record<string, string> = {},
    init?: RequestInit,
    timeoutMs?: number,
  ) {
    const qs = new URLSearchParams({ key: this.opts.apiKey, token: this.opts.token, ...params });
    return requestJson<T>("trello", this.fetch, `${this.base}${path}?${qs}`, init, timeoutMs);
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

  private post<T>(path: string, body: Record<string, unknown>) {
    return this.call<T>(
      path,
      {},
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  private put<T>(path: string, body: Record<string, unknown>) {
    return this.call<T>(
      path,
      {},
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  getCard(cardId: string) {
    return this.call<TrelloCard>(`/cards/${encodeURIComponent(cardId)}`, {
      fields: "closed,dueComplete,idLabels,desc",
    });
  }

  updateCard(cardId: string, patch: { desc?: string; due?: string; idLabels?: string[] }) {
    return this.put(`/cards/${encodeURIComponent(cardId)}`, {
      ...(patch.desc !== undefined ? { desc: patch.desc } : {}),
      ...(patch.due !== undefined ? { due: patch.due } : {}),
      ...(patch.idLabels ? { idLabels: patch.idLabels.join(",") } : {}),
    });
  }

  /** Description edits on a card (who and when), newest first. Used to avoid overwriting a person's edit. */
  async descriptionEdits(cardId: string): Promise<{ byMemberId: string; at: string }[]> {
    const actions = await this.call<{ date: string; idMemberCreator: string }[]>(
      `/cards/${encodeURIComponent(cardId)}/actions`,
      { filter: "updateCard:desc", limit: "50" },
    );
    return actions.map((a) => ({ byMemberId: a.idMemberCreator, at: a.date }));
  }

  listLabels(boardId: string) {
    return this.call<TrelloLabel[]>(`/boards/${encodeURIComponent(boardId)}/labels`, {
      fields: "name,color",
      limit: "1000",
    });
  }

  createLabel(boardId: string, name: string, color: string) {
    return this.post<TrelloLabel>("/labels", { idBoard: boardId, name, color });
  }

  /** `desc` and `name` go in a JSON body: descriptions can be longer than a URL allows. */
  createCard(card: {
    listId: string;
    name: string;
    desc: string;
    due?: string;
    labelIds?: string[];
  }) {
    return this.post<{ id: string; shortUrl: string; url: string }>("/cards", {
      idList: card.listId,
      name: card.name,
      desc: card.desc,
      due: card.due,
      idLabels: card.labelIds?.join(","),
    });
  }

  addComment(cardId: string, text: string) {
    return this.post(`/cards/${encodeURIComponent(cardId)}/actions/comments`, { text });
  }

  /** Link attachment (used when a file is too large or cannot be uploaded). */
  attachUrl(cardId: string, url: string, name: string) {
    return this.post(`/cards/${encodeURIComponent(cardId)}/attachments`, { url, name });
  }

  uploadAttachment(cardId: string, file: Blob, name: string) {
    const form = new FormData();
    form.append("file", file, name);
    form.append("name", name);
    return this.call(
      `/cards/${encodeURIComponent(cardId)}/attachments`,
      {},
      {
        method: "POST",
        body: form,
      },
      60_000,
    );
  }

  /** Invalidate this token at Trello (used on disconnect). */
  async revokeToken() {
    await this.call(`/tokens/${encodeURIComponent(this.opts.token)}`, {}, { method: "DELETE" });
  }
}

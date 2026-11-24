import { type FetchLike, ProviderError, requestJson } from "./http";

const AUTHORIZE = "https://linear.app/oauth/authorize";
const API = "https://api.linear.app";

/** Read access plus creating issues, uploads and comments. No `write`, no `admin` (ADR 0016). */
export const LINEAR_SCOPES = "read,issues:create,comments:create";

/**
 * Where to send a workspace admin to approve TriageFox. `actor=app` makes issues and comments appear as
 * created by the TriageFox app rather than by the person who connected (ADR 0016).
 */
export function linearAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: LINEAR_SCOPES,
    state: opts.state,
    actor: "app",
    prompt: "consent",
  }).toString();
  return url.toString();
}

export interface LinearTokens {
  accessToken: string;
  /** Linear rotates refresh tokens and each expires 30 days after issue: always store the newest. */
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Epoch ms of the last token call (the daily keep-alive refreshes old ones). */
  refreshedAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenCall(fetchImpl: FetchLike, form: Record<string, string>, previous?: string) {
  let res: TokenResponse;
  try {
    res = await requestJson<TokenResponse>("linear", fetchImpl, `${API}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (err) {
    // OAuth answers 400 `invalid_grant` for a spent, expired or revoked code or refresh token.
    if (err instanceof ProviderError && err.status === 400)
      throw new ProviderError("linear", "auth", "linear refused the grant", 400);
    throw err;
  }
  const refreshToken = res.refresh_token ?? previous;
  if (!refreshToken) throw new Error("Linear did not return a refresh token");
  const now = Date.now();
  return {
    accessToken: res.access_token,
    refreshToken,
    expiresAt: now + res.expires_in * 1000,
    refreshedAt: now,
  } satisfies LinearTokens;
}

export function exchangeLinearCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: FetchLike;
}) {
  return tokenCall(opts.fetch ?? fetch, {
    grant_type: "authorization_code",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
}

export function refreshLinearTokens(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: FetchLike;
}) {
  return tokenCall(
    opts.fetch ?? fetch,
    {
      grant_type: "refresh_token",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
    },
    opts.refreshToken,
  );
}

/** Revokes the grant at Linear (disconnect). */
export async function revokeLinearToken(token: string, fetchImpl: FetchLike = fetch) {
  await requestJson("linear", fetchImpl, `${API}/oauth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, token_type_hint: "refresh_token" }).toString(),
  });
}

/** Linear's priority numbers: 0 none, 1 Urgent, 2 High, 3 Medium, 4 Low. P1 and P2 both map to Low (ADR 0016). */
export function linearPriority(p: number): number {
  if (p >= 5) return 1;
  if (p === 4) return 2;
  if (p === 3) return 3;
  return 4;
}

/** Workflow state types Linear uses. */
export type LinearStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  triageEnabled: boolean;
}
export interface LinearState {
  id: string;
  name: string;
  type: LinearStateType;
  position: number;
}
export interface LinearLabel {
  id: string;
  name: string;
  color: string | null;
}
export interface LinearIssueRef {
  id: string;
  identifier: string;
  url: string;
}
export interface LinearIssueState {
  id: string;
  description: string | null;
  updatedAt: string;
  archivedAt: string | null;
  trashed: boolean | null;
  state: { type: LinearStateType } | null;
}
export interface LinearIssueInput {
  teamId: string;
  title: string;
  description: string;
  priority: number;
  labelIds?: string[];
  stateId?: string;
  projectId?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
}

interface GqlError {
  message?: string;
  extensions?: { code?: string; type?: string; userPresentableMessage?: string };
}

/** Classifies a GraphQL error the way `classify` does HTTP statuses. */
export function classifyLinearError(e: GqlError): ProviderError["kind"] {
  const code = (e.extensions?.code ?? "").toUpperCase();
  const text = `${e.message ?? ""} ${e.extensions?.userPresentableMessage ?? ""}`;
  if (code === "AUTHENTICATION_ERROR" || code === "FORBIDDEN") return "auth";
  if (code === "RATELIMITED") return "rate_limited";
  if (/entity not found|not found|could not find/i.test(text)) return "not_found";
  return "invalid";
}

/** The small part of Linear's GraphQL API TriageFox uses. */
export class LinearClient {
  private readonly base: string;
  private readonly fetch: FetchLike;
  constructor(private readonly opts: { accessToken: string; baseUrl?: string; fetch?: FetchLike }) {
    this.base = opts.baseUrl ?? API;
    this.fetch = opts.fetch ?? fetch;
  }

  async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetch(`${this.base}/graphql`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.accessToken}`,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ProviderError(
        "linear",
        "unavailable",
        `linear is unreachable: ${(err as Error).message}`,
      );
    }
    const retry = Number(res.headers.get("retry-after"));
    const retryAfterSec = Number.isFinite(retry) && retry > 0 ? retry : undefined;
    let body: { data?: T; errors?: GqlError[] } | undefined;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = undefined;
    }
    const first = body?.errors?.[0];
    if (first) {
      const kind = res.status === 401 ? "auth" : classifyLinearError(first);
      throw new ProviderError("linear", kind, `linear: ${kind}`, res.status, retryAfterSec);
    }
    if (!res.ok) {
      const kind =
        res.status === 401 || res.status === 403
          ? "auth"
          : res.status === 429
            ? "rate_limited"
            : res.status >= 500
              ? "unavailable"
              : "invalid";
      throw new ProviderError(
        "linear",
        kind,
        `linear responded ${res.status}`,
        res.status,
        retryAfterSec,
      );
    }
    if (!body?.data)
      throw new ProviderError("linear", "invalid", "linear returned no data", res.status);
    return body.data;
  }

  async organization() {
    const d = await this.gql<{ organization: { id: string; name: string; urlKey: string } }>(
      "query { organization { id name urlKey } }",
    );
    return d.organization;
  }

  async listTeams(): Promise<LinearTeam[]> {
    const d = await this.gql<{ teams: { nodes: LinearTeam[] } }>(
      "query { teams(first: 100) { nodes { id key name triageEnabled } } }",
    );
    return d.teams.nodes;
  }

  /** States, open projects and the labels usable in one team (its own plus workspace-wide ones). */
  async teamSetup(teamId: string) {
    const d = await this.gql<{
      team: {
        id: string;
        triageEnabled: boolean;
        states: { nodes: LinearState[] };
        projects: { nodes: { id: string; name: string; status: { type: string } | null }[] };
      };
    }>(
      `query($id: String!) { team(id: $id) {
        id triageEnabled
        states(first: 100) { nodes { id name type position } }
        projects(first: 100) { nodes { id name status { type } } }
      } }`,
      { id: teamId },
    );
    const states = [...d.team.states.nodes].sort((a, b) => a.position - b.position);
    return {
      triageEnabled: d.team.triageEnabled,
      states,
      projects: d.team.projects.nodes
        .filter((p) => !["completed", "canceled"].includes(p.status?.type ?? ""))
        .map((p) => ({ id: p.id, name: p.name })),
      labels: await this.listLabels(teamId),
    };
  }

  async listLabels(teamId: string): Promise<LinearLabel[]> {
    const d = await this.gql<{
      issueLabels: {
        nodes: (LinearLabel & { isGroup: boolean; team: { id: string } | null })[];
      };
    }>("query { issueLabels(first: 250) { nodes { id name color isGroup team { id } } } }");
    return d.issueLabels.nodes
      .filter((l) => !l.isGroup && (!l.team || l.team.id === teamId))
      .map((l) => ({ id: l.id, name: l.name, color: l.color ?? null }));
  }

  async createLabel(teamId: string, name: string, color?: string): Promise<LinearLabel> {
    const d = await this.gql<{ issueLabelCreate: { issueLabel: LinearLabel } }>(
      `mutation($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) { success issueLabel { id name color } }
      }`,
      { input: { teamId, name, ...(color ? { color } : {}) } },
    );
    return d.issueLabelCreate.issueLabel;
  }

  async createIssue(input: LinearIssueInput): Promise<LinearIssueRef> {
    const d = await this.gql<{ issueCreate: { issue: LinearIssueRef } }>(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { success issue { id identifier url } }
      }`,
      { input },
    );
    return d.issueCreate.issue;
  }

  async updateIssue(
    id: string,
    input: Partial<Pick<LinearIssueInput, "priority" | "dueDate" | "description" | "labelIds">>,
  ) {
    await this.gql(
      `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
      { id, input },
    );
  }

  async addComment(issueId: string, body: string) {
    await this.gql(
      `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
      { input: { issueId, body } },
    );
  }

  /** The issue's current state, or null when it was deleted or this app can no longer see it. */
  async getIssue(id: string): Promise<LinearIssueState | null> {
    try {
      const d = await this.gql<{ issue: LinearIssueState | null }>(
        `query($id: String!) { issue(id: $id) {
          id description updatedAt archivedAt trashed state { type }
        } }`,
        { id },
      );
      return d.issue;
    } catch (err) {
      if (err instanceof ProviderError && err.kind === "not_found") return null;
      throw err;
    }
  }

  /**
   * Uploads a file to Linear's storage (server side: Linear blocks browser uploads) and returns its
   * permanent asset URL, to be referenced from markdown in a description or comment.
   */
  async uploadFile(file: Blob, name: string): Promise<string> {
    const contentType = file.type || "application/octet-stream";
    const d = await this.gql<{
      fileUpload: {
        uploadFile: {
          uploadUrl: string;
          assetUrl: string;
          headers: { key: string; value: string }[];
        } | null;
      };
    }>(
      `mutation($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }`,
      { contentType, filename: name.slice(0, 200), size: file.size },
    );
    const up = d.fileUpload.uploadFile;
    if (!up) throw new ProviderError("linear", "invalid", "linear refused the upload");
    const headers = new Headers({
      "content-type": contentType,
      "cache-control": "public, max-age=31536000",
    });
    for (const h of up.headers) headers.set(h.key, h.value);
    let res: Response;
    try {
      res = await this.fetch(up.uploadUrl, {
        method: "PUT",
        headers,
        body: file,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new ProviderError(
        "linear",
        "unavailable",
        `linear upload failed: ${(err as Error).message}`,
      );
    }
    if (!res.ok)
      throw new ProviderError(
        "linear",
        res.status >= 500 ? "unavailable" : "invalid",
        `linear upload responded ${res.status}`,
        res.status,
      );
    return up.assetUrl;
  }
}

/** Markdown for an uploaded file: images inline, anything else as a link. */
export function linearFileMarkdown(name: string, assetUrl: string, contentType: string) {
  const safe = name.replace(/[[\]()\n\r]/g, " ").trim() || "file";
  return contentType.startsWith("image/") ? `![${safe}](${assetUrl})` : `[${safe}](${assetUrl})`;
}

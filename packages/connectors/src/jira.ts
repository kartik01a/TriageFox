import { type FetchLike, requestJson } from "./http";

const AUTH = "https://auth.atlassian.com";
const API = "https://api.atlassian.com";

export const JIRA_SCOPES = [
  "read:jira-work",
  "write:jira-work",
  "read:jira-user",
  "offline_access",
];

export function jiraAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string }) {
  const url = new URL(`${AUTH}/authorize`);
  url.search = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: opts.clientId,
    scope: JIRA_SCOPES.join(" "),
    redirect_uri: opts.redirectUri,
    state: opts.state,
    response_type: "code",
    prompt: "consent",
  }).toString();
  return url.toString();
}

export interface JiraTokens {
  accessToken: string;
  /** Atlassian rotates refresh tokens: always store the newest one. */
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenCall(
  fetchImpl: FetchLike,
  body: Record<string, string>,
  previousRefresh?: string,
): Promise<JiraTokens> {
  const res = await requestJson<TokenResponse>("jira", fetchImpl, `${AUTH}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const refreshToken = res.refresh_token ?? previousRefresh;
  if (!refreshToken)
    throw new Error("Atlassian did not return a refresh token (is offline_access granted?)");
  return {
    accessToken: res.access_token,
    refreshToken,
    expiresAt: Date.now() + res.expires_in * 1000,
  };
}

export function exchangeJiraCode(opts: {
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

export function refreshJiraTokens(opts: {
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

export interface JiraSite {
  id: string;
  name: string;
  url: string;
}

export function listJiraSites(accessToken: string, fetchImpl: FetchLike = fetch) {
  return requestJson<JiraSite[]>("jira", fetchImpl, `${API}/oauth/token/accessible-resources`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
}

// ---- Project setup analysis ------------------------------------------------------------------

/** Fields TriageFox fills itself. Anything else that is required blocks enabling (docs/integrations/jira.md). */
export const FILLABLE_FIELDS = new Set([
  "project",
  "issuetype",
  "summary",
  "description",
  "reporter", // set automatically to the connected user
  "labels",
  "duedate",
  "priority",
  "attachment",
]);

export interface CreateField {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue?: boolean;
}

export interface IssueTypeSetup {
  id: string;
  name: string;
  subtask: boolean;
  /** Required fields we cannot fill. Non-empty means this issue type cannot be used. */
  blockingFields: { id: string; name: string }[];
  /** Whether priority / due date are on the create screen (priority can still be set by editing). */
  hasPriority: boolean;
  hasDueDate: boolean;
}

export function analyseCreateFields(fields: CreateField[]) {
  const blockingFields = fields
    .filter((f) => f.required && !f.hasDefaultValue && !FILLABLE_FIELDS.has(f.fieldId))
    .map((f) => ({ id: f.fieldId, name: f.name }));
  return {
    blockingFields,
    hasPriority: fields.some((f) => f.fieldId === "priority"),
    hasDueDate: fields.some((f) => f.fieldId === "duedate"),
  };
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}
export interface JiraPriority {
  id: string;
  name: string;
}

export class JiraClient {
  private readonly fetch: FetchLike;
  private readonly base: string;
  constructor(
    private readonly opts: {
      accessToken: string;
      cloudId: string;
      baseUrl?: string;
      fetch?: FetchLike;
    },
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.base = `${opts.baseUrl ?? API}/ex/jira/${encodeURIComponent(opts.cloudId)}/rest/api/3`;
  }

  private get<T>(path: string) {
    return requestJson<T>("jira", this.fetch, `${this.base}${path}`, {
      headers: { authorization: `Bearer ${this.opts.accessToken}`, accept: "application/json" },
    });
  }

  private send<T>(method: "POST" | "PUT", path: string, body: unknown) {
    return requestJson<T>("jira", this.fetch, `${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.accessToken}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  createIssue(issue: {
    projectKey: string;
    issueTypeId: string;
    summary: string;
    description: unknown;
    labels: string[];
  }) {
    return this.send<{ id: string; key: string }>("POST", "/issue", {
      fields: {
        project: { key: issue.projectKey },
        issuetype: { id: issue.issueTypeId },
        summary: issue.summary,
        description: issue.description,
        labels: issue.labels,
      },
    });
  }

  /** Priority is not on every create screen, so it is set by editing (verified in Phase 0). */
  async editIssue(
    key: string,
    change: { fields?: Record<string, unknown>; update?: Record<string, unknown> },
  ) {
    await this.send("PUT", `/issue/${encodeURIComponent(key)}`, change);
  }

  myself() {
    return this.get<{ accountId: string }>("/myself");
  }

  /** `done` = the issue is in a "Done" status category (closed). */
  async isDone(key: string): Promise<boolean> {
    const issue = await this.get<{ fields?: { status?: { statusCategory?: { key?: string } } } }>(
      `/issue/${encodeURIComponent(key)}?fields=status`,
    );
    return issue.fields?.status?.statusCategory?.key === "done";
  }

  /** Description changes (who and when). Used to avoid overwriting a person's edit. */
  async descriptionEdits(key: string): Promise<{ byAccountId: string; at: string }[]> {
    const out: { byAccountId: string; at: string }[] = [];
    for (let startAt = 0; startAt < 500; ) {
      const page = await this.get<{
        values?: {
          created: string;
          author?: { accountId?: string };
          items?: { field?: string }[];
        }[];
        isLast?: boolean;
      }>(`/issue/${encodeURIComponent(key)}/changelog?maxResults=100&startAt=${startAt}`);
      const values = page.values ?? [];
      for (const v of values)
        if (v.items?.some((i) => i.field === "description"))
          out.push({ byAccountId: v.author?.accountId ?? "", at: v.created });
      startAt += values.length;
      if (page.isLast !== false || values.length === 0) break;
    }
    return out;
  }

  addComment(key: string, adf: unknown) {
    return this.send("POST", `/issue/${encodeURIComponent(key)}/comment`, { body: adf });
  }

  uploadAttachment(key: string, file: Blob, name: string) {
    const form = new FormData();
    form.append("file", file, name);
    return requestJson(
      "jira",
      this.fetch,
      `${this.base}/issue/${encodeURIComponent(key)}/attachments`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.accessToken}`,
          accept: "application/json",
          "x-atlassian-token": "no-check",
        },
        body: form,
      },
      60_000,
    );
  }

  /** Labels already used on this site (Jira labels are site-wide), capped at 1000. */
  async listLabels(): Promise<string[]> {
    const out: string[] = [];
    for (let startAt = 0; startAt < 1000; ) {
      const page = await this.get<{ values: string[]; isLast?: boolean }>(
        `/label?maxResults=1000&startAt=${startAt}`,
      );
      out.push(...page.values);
      startAt += page.values.length;
      if (page.isLast !== false || page.values.length === 0) break;
    }
    return out;
  }

  async listProjects(): Promise<JiraProject[]> {
    const out: JiraProject[] = [];
    for (let startAt = 0; startAt < 500; ) {
      const page = await this.get<{ values: JiraProject[]; isLast?: boolean; total?: number }>(
        `/project/search?maxResults=50&startAt=${startAt}&orderBy=name`,
      );
      out.push(...page.values.map((p) => ({ id: p.id, key: p.key, name: p.name })));
      startAt += page.values.length;
      if (page.isLast || page.values.length === 0) break;
    }
    return out;
  }

  listPriorities() {
    return this.get<JiraPriority[]>("/priority").then((ps) =>
      ps.map((p) => ({ id: p.id, name: p.name })),
    );
  }

  /** Issue types of a project, each with the fields we cannot fill (required custom fields etc.). */
  async projectSetup(
    projectKey: string,
  ): Promise<{ issueTypes: IssueTypeSetup[]; priorities: JiraPriority[] }> {
    const key = encodeURIComponent(projectKey);
    const types = await this.get<{
      issueTypes?: { id: string; name: string; subtask: boolean }[];
      values?: { id: string; name: string; subtask: boolean }[];
    }>(`/issue/createmeta/${key}/issuetypes`);
    const list = types.issueTypes ?? types.values ?? [];
    const issueTypes: IssueTypeSetup[] = [];
    for (const t of list) {
      const meta = await this.get<{ fields?: CreateField[]; values?: CreateField[] }>(
        `/issue/createmeta/${key}/issuetypes/${encodeURIComponent(t.id)}`,
      );
      issueTypes.push({
        id: t.id,
        name: t.name,
        subtask: !!t.subtask,
        ...analyseCreateFields(meta.fields ?? meta.values ?? []),
      });
    }
    return { issueTypes, priorities: await this.listPriorities() };
  }
}

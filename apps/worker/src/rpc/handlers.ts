import { AiError } from "@triagefox/ai";
import {
  CrispPluginClient,
  exchangeJiraCode,
  JiraClient,
  type JiraTokens,
  listJiraSites,
  ProviderError,
  refreshJiraTokens,
  TrelloClient,
} from "@triagefox/connectors";
import { openSecret } from "@triagefox/crypto";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { RpcError } from "@triagefox/rpc";
import type { RpcHandlers } from "@triagefox/rpc/server";
import {
  type Ctx,
  deleteConnection,
  failWith,
  loadConnection,
  openCredentials,
  sealCredentials,
  updateConnection,
  withLock,
} from "./context";
import { dryRun } from "./dry-run";

type Connection = Awaited<ReturnType<typeof loadConnection>>;
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export function trello(ctx: Ctx, token: string) {
  const apiKey = ctx.config.TRELLO_API_KEY;
  if (!apiKey) throw new RpcError("not_configured", "Trello is not configured on this server.");
  return new TrelloClient({ apiKey, token, fetch: ctx.fetch });
}

function jiraApp(ctx: Ctx) {
  const { ATLASSIAN_CLIENT_ID: clientId, ATLASSIAN_CLIENT_SECRET: clientSecret } = ctx.config;
  if (!clientId || !clientSecret)
    throw new RpcError("not_configured", "Jira is not configured on this server.");
  return {
    clientId,
    clientSecret,
    redirectUri: `${ctx.config.APP_URL}/api/connections/jira/callback`,
  };
}

function crispPlugin(ctx: Ctx) {
  const {
    CRISP_PLUGIN_ID: identifier,
    CRISP_PLUGIN_KEY: key,
    CRISP_PLUGIN_UUID: pluginId,
  } = ctx.config;
  if (!identifier || !key || !pluginId)
    throw new RpcError("not_configured", "Crisp is not configured on this server.");
  return new CrispPluginClient({ identifier, key, pluginId, fetch: ctx.fetch });
}

/**
 * Returns a valid Jira access token, refreshing it when it is about to expire. Atlassian rotates
 * refresh tokens, so concurrent refreshes would invalidate each other: one at a time per connection,
 * re-reading the stored tokens after taking the lock.
 */
export async function jiraAccessToken(ctx: Ctx, c: Connection): Promise<string> {
  const current = await openCredentials<JiraTokens>(ctx, c);
  if (current.expiresAt - Date.now() > REFRESH_MARGIN_MS) return current.accessToken;

  return withLock(ctx.redis, `conn:${c.id}`, async () => {
    const fresh = await loadConnection(ctx, c.orgId, c.id, "jira");
    const tokens = await openCredentials<JiraTokens>(ctx, fresh);
    if (tokens.expiresAt - Date.now() > REFRESH_MARGIN_MS) return tokens.accessToken; // someone else refreshed
    const app = jiraApp(ctx);
    try {
      const next = await refreshJiraTokens({
        ...app,
        refreshToken: tokens.refreshToken,
        fetch: ctx.fetch,
      });
      await updateConnection(ctx, fresh, {
        credentialsSealed: await sealCredentials(ctx, fresh, next),
        lastVerifiedAt: new Date(),
        status: "active",
        statusDetail: null,
      });
      return next.accessToken;
    } catch (err) {
      return failWith(ctx, fresh, "Jira", err);
    }
  });
}

function checkJiraSite(c: Connection, cloudId: string) {
  const sites = (c.metadata.sites as { id: string }[] | undefined) ?? [];
  if (!sites.some((s) => s.id === cloudId))
    throw new RpcError("forbidden", "That Jira site is not part of this connection.");
}

export function createHandlers(ctx: Ctx): RpcHandlers {
  return {
    // ---- Trello --------------------------------------------------------------------------
    async "trello.verify"({ orgId, connectionId }) {
      const c = await loadConnection(ctx, orgId, connectionId, "trello");
      try {
        const { token } = await openCredentials<{ token: string }>(ctx, c);
        const me = await trello(ctx, token).me();
        await updateConnection(ctx, c, {
          status: "active",
          statusDetail: null,
          lastVerifiedAt: new Date(),
          metadata: {
            ...c.metadata,
            memberId: me.id,
            username: me.username,
            fullName: me.fullName,
          },
        });
        return { username: me.username, fullName: me.fullName };
      } catch (err) {
        // A token that fails on first use must not linger as a half-created connection.
        if (c.status === "pending") await deleteConnection(ctx, c);
        return failWith(ctx, c, "Trello", err);
      }
    },

    async "trello.listBoards"({ orgId, connectionId }) {
      const c = await loadConnection(ctx, orgId, connectionId, "trello");
      try {
        const { token } = await openCredentials<{ token: string }>(ctx, c);
        const boards = await trello(ctx, token).listBoards();
        return { boards: boards.map((b) => ({ id: b.id, name: b.name })) };
      } catch (err) {
        return failWith(ctx, c, "Trello", err);
      }
    },

    async "trello.listLists"({ orgId, connectionId, boardId }) {
      const c = await loadConnection(ctx, orgId, connectionId, "trello");
      try {
        const { token } = await openCredentials<{ token: string }>(ctx, c);
        return { lists: await trello(ctx, token).listLists(boardId) };
      } catch (err) {
        return failWith(ctx, c, "Trello", err);
      }
    },

    async "trello.listLabels"({ orgId, connectionId, boardId }) {
      const c = await loadConnection(ctx, orgId, connectionId, "trello");
      try {
        const { token } = await openCredentials<{ token: string }>(ctx, c);
        const labels = await trello(ctx, token).listLabels(boardId);
        return { labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color })) };
      } catch (err) {
        return failWith(ctx, c, "Trello", err);
      }
    },

    async "trello.createLabel"({ orgId, connectionId, boardId, name, color }) {
      const c = await loadConnection(ctx, orgId, connectionId, "trello");
      try {
        const { token } = await openCredentials<{ token: string }>(ctx, c);
        const l = await trello(ctx, token).createLabel(boardId, name, color);
        return { id: l.id, name: l.name ?? name, color: l.color ?? null };
      } catch (err) {
        return failWith(ctx, c, "Trello", err);
      }
    },

    // ---- Jira ----------------------------------------------------------------------------
    async "jira.complete"({ orgId, connectionId }) {
      const c = await loadConnection(ctx, orgId, connectionId, "jira");
      if (c.status !== "pending")
        throw new RpcError("invalid", "This connection is already set up.");
      try {
        const { code } = await openCredentials<{ code: string }>(ctx, c);
        const tokens = await exchangeJiraCode({ ...jiraApp(ctx), code, fetch: ctx.fetch });
        const sites = await listJiraSites(tokens.accessToken, ctx.fetch);
        if (sites.length === 0)
          throw new RpcError(
            "invalid",
            "No Jira site was shared with TriageFox. Try again and pick a site.",
          );
        await updateConnection(ctx, c, {
          credentialsSealed: await sealCredentials(ctx, c, tokens),
          status: "active",
          statusDetail: null,
          lastVerifiedAt: new Date(),
          metadata: {
            ...c.metadata,
            sites,
            cloudId: sites[0]?.id,
            siteName: sites[0]?.name,
            siteUrl: sites[0]?.url,
          },
        });
        return { sites };
      } catch (err) {
        await deleteConnection(ctx, c); // the one-time code is spent either way
        return failWith(ctx, c, "Jira", err);
      }
    },

    async "jira.listProjects"({ orgId, connectionId, cloudId }) {
      const c = await loadConnection(ctx, orgId, connectionId, "jira");
      checkJiraSite(c, cloudId);
      try {
        const accessToken = await jiraAccessToken(ctx, c);
        return {
          projects: await new JiraClient({ accessToken, cloudId, fetch: ctx.fetch }).listProjects(),
        };
      } catch (err) {
        return failWith(ctx, c, "Jira", err);
      }
    },

    async "jira.listLabels"({ orgId, connectionId, cloudId }) {
      const c = await loadConnection(ctx, orgId, connectionId, "jira");
      checkJiraSite(c, cloudId);
      try {
        const accessToken = await jiraAccessToken(ctx, c);
        return {
          labels: await new JiraClient({ accessToken, cloudId, fetch: ctx.fetch }).listLabels(),
        };
      } catch (err) {
        return failWith(ctx, c, "Jira", err);
      }
    },

    async "jira.projectSetup"({ orgId, connectionId, cloudId, projectKey }) {
      const c = await loadConnection(ctx, orgId, connectionId, "jira");
      checkJiraSite(c, cloudId);
      try {
        const accessToken = await jiraAccessToken(ctx, c);
        return await new JiraClient({ accessToken, cloudId, fetch: ctx.fetch }).projectSetup(
          projectKey,
        );
      } catch (err) {
        return failWith(ctx, c, "Jira", err);
      }
    },

    // ---- Crisp ---------------------------------------------------------------------------
    async "crisp.verifyWebsite"({ websiteId, token }) {
      const crisp = crispPlugin(ctx);
      try {
        if (!(await crisp.verifyWebsiteToken(websiteId, token))) return { valid: false };
      } catch (err) {
        return failWith(ctx, null, "Crisp", err);
      }
      const websiteName = await crisp.getWebsiteName(websiteId).catch(() => undefined);
      return { valid: true, websiteName };
    },

    // ---- Any connection --------------------------------------------------------------------
    async "connection.check"({ orgId, connectionId }) {
      const c = await loadConnection(
        ctx,
        orgId,
        connectionId,
        await anyProvider(ctx, orgId, connectionId),
      );
      try {
        if (c.provider === "trello") {
          await trello(ctx, (await openCredentials<{ token: string }>(ctx, c)).token).me();
        } else if (c.provider === "jira") {
          await listJiraSites(await jiraAccessToken(ctx, c), ctx.fetch);
        } else {
          try {
            await crispPlugin(ctx).getSubscriptionToken(String(c.metadata.websiteId));
          } catch (err) {
            // For Crisp, "no subscription" means the plugin was uninstalled from that website.
            if (err instanceof ProviderError && (err.kind === "not_found" || err.kind === "auth")) {
              const detail =
                "The TriageFox plugin was uninstalled from this Crisp website. Reinstall it to reconnect.";
              await updateConnection(ctx, c, { status: "revoked", statusDetail: detail });
              return { status: "revoked" as const, detail };
            }
            throw err;
          }
        }
        await updateConnection(ctx, c, {
          status: "active",
          statusDetail: null,
          lastVerifiedAt: new Date(),
        });
        return { status: "active" as const };
      } catch (err) {
        try {
          return await failWith(
            ctx,
            c,
            c.provider === "crisp" ? "Crisp" : c.provider === "jira" ? "Jira" : "Trello",
            err,
          );
        } catch (e) {
          if (e instanceof RpcError && e.code === "auth_expired")
            return { status: "revoked" as const, detail: e.message };
          throw e;
        }
      }
    },

    async "automation.dryRun"(input) {
      try {
        return await dryRun(ctx, crispPlugin(ctx), input);
      } catch (err) {
        if (err instanceof AiError) {
          if (err.kind === "auth" || err.kind === "no_quota")
            throw new RpcError("auth_expired", "The OpenAI key was rejected or is out of credit.");
          throw new RpcError("unavailable", "The AI is not responding. Please try again shortly.");
        }
        return failWith(ctx, null, "Crisp", err);
      }
    },

    /** The AI's own words for one run (reason, priority reason). Sealed at rest, so only the worker can open it. */
    async "ai.explain"({ orgId, aiRunId }) {
      const [run] = await withOrg(ctx.db, orgId, (tx) =>
        tx
          .select({ sealed: schema.aiRuns.rawOutputSealed })
          .from(schema.aiRuns)
          .where(and(eq(schema.aiRuns.id, aiRunId), eq(schema.aiRuns.orgId, orgId))),
      );
      if (!run) throw new RpcError("not_found", "That decision was not found.");
      if (!run.sealed) throw new RpcError("not_found", "The details were removed after 30 days.");
      const opened = JSON.parse(
        await openSecret(
          run.sealed,
          { orgId, recordId: aiRunId, purpose: "ai_run.output" },
          ctx.keyring,
        ),
      ) as { actions?: Record<string, unknown>[] };
      return {
        actions: (opened.actions ?? []).map((a) => ({
          kind: String(a.kind ?? ""),
          title: String(a.title ?? ""),
          summary: String(a.summary ?? ""),
          reason: String(a.reason ?? ""),
          priorityReason: String(a.priorityReason ?? ""),
          type: a.type ? String(a.type) : undefined,
          priority: typeof a.priority === "number" ? a.priority : undefined,
          confidence: typeof a.confidence === "number" ? a.confidence : 0,
        })),
      };
    },

    async "connection.disconnect"({ orgId, connectionId }) {
      const c = await loadConnection(
        ctx,
        orgId,
        connectionId,
        await anyProvider(ctx, orgId, connectionId),
      );
      let revoked = false;
      if (c.provider === "trello" && c.credentialsSealed) {
        // Best effort: if Trello is down or the token is already invalid we still delete our copy.
        try {
          await trello(ctx, (await openCredentials<{ token: string }>(ctx, c)).token).revokeToken();
          revoked = true;
        } catch (err) {
          ctx.log.warn({ connectionId, err: (err as Error).message }, "trello token revoke failed");
        }
      }
      await deleteConnection(ctx, c);
      return { revoked };
    },
  };
}

async function anyProvider(ctx: Ctx, orgId: string, connectionId: string) {
  // Provider is read from the row itself; loadConnection then re-checks it.
  for (const p of ["trello", "jira", "crisp"] as const) {
    try {
      await loadConnection(ctx, orgId, connectionId, p);
      return p;
    } catch {
      /* try next */
    }
  }
  throw new RpcError("not_found", "Connection not found.");
}

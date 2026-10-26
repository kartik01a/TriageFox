import { suggestIssueTypeMap, suggestPriorityMap, usableIssueTypes } from "@triagefox/connectors";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { PRIORITIES, TICKET_TYPES } from "@triagefox/shared";
import { z } from "zod";
import { getAutomation, syncDestinations } from "@/lib/automations";
import { audit, getConnectionView } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard, rpcErrorResponse } from "@/lib/guards";
import { rpc } from "@/lib/rpc";

type Params = { params: Promise<{ id: string }> };

async function connectionFor(req: Request, params: Params["params"]) {
  const guard = await managerGuard(req, { checkOrigin: req.method !== "GET" });
  if (!guard.ok) return { response: guard.response } as const;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return { response: json({ ok: false, error: "Not found." }, 404) } as const;
  const orgId = guard.ctx.workspace.id;
  const conn = await getConnectionView(orgId, id.data);
  if (!conn) return { response: json({ ok: false, error: "Not found." }, 404) } as const;
  return { orgId, conn, userId: guard.ctx.session.user.id } as const;
}

/** Lists what the customer can pick: Trello boards/lists, Jira projects and project setup. */
export async function GET(req: Request, { params }: Params) {
  const c = await connectionFor(req, params);
  if ("response" in c) return c.response;
  const q = new URL(req.url).searchParams;
  const base = { orgId: c.orgId, connectionId: c.conn.id };
  try {
    switch (`${c.conn.provider}:${q.get("kind")}`) {
      case "trello:boards":
        return json({ ok: true, ...(await rpc().call("trello.listBoards", base)) });
      case "trello:lists":
        return json({
          ok: true,
          ...(await rpc().call("trello.listLists", { ...base, boardId: q.get("boardId") ?? "" })),
        });
      case "jira:projects":
        return json({
          ok: true,
          ...(await rpc().call("jira.listProjects", { ...base, cloudId: q.get("cloudId") ?? "" })),
        });
      case "jira:setup": {
        const setup = await rpc().call(
          "jira.projectSetup",
          { ...base, cloudId: q.get("cloudId") ?? "", projectKey: q.get("projectKey") ?? "" },
          { timeoutMs: 40_000 },
        );
        return json({
          ok: true,
          ...setup,
          suggestions: {
            issueTypeMap: suggestIssueTypeMap(setup.issueTypes),
            priorityMap: suggestPriorityMap(setup.priorities),
          },
        });
      }
      default:
        return json({ ok: false, error: "Unknown request." }, 400);
    }
  } catch (err) {
    return rpcErrorResponse(err);
  }
}

const trelloBody = z.object({ boardId: z.string().min(1), listId: z.string().min(1) });
const jiraBody = z.object({
  cloudId: z.string().min(1),
  projectKey: z.string().min(1),
  issueTypeMap: z.record(z.enum(TICKET_TYPES), z.string().min(1)),
  priorityMap: z.record(z.enum(PRIORITIES.map(String) as [string, ...string[]]), z.string().min(1)),
});

/** Saves the chosen target as this connection's defaults, after re-checking it with the provider. */
export async function PUT(req: Request, { params }: Params) {
  const c = await connectionFor(req, params);
  if ("response" in c) return c.response;
  const base = { orgId: c.orgId, connectionId: c.conn.id };
  const raw = await req.json().catch(() => null);
  let defaults: Record<string, unknown>;

  try {
    if (c.conn.provider === "trello") {
      const body = trelloBody.safeParse(raw);
      if (!body.success) return json({ ok: false, error: "Choose a board and a list." }, 400);
      // Never trust names or ids from the browser: confirm with Trello.
      const [{ boards }, { lists }] = await Promise.all([
        rpc().call("trello.listBoards", base),
        rpc().call("trello.listLists", { ...base, boardId: body.data.boardId }),
      ]);
      const board = boards.find((b) => b.id === body.data.boardId);
      const list = lists.find((l) => l.id === body.data.listId);
      if (!board || !list)
        return json({ ok: false, error: "That board or list isn't available any more." }, 400);
      defaults = { boardId: board.id, boardName: board.name, listId: list.id, listName: list.name };
    } else if (c.conn.provider === "jira") {
      const body = jiraBody.safeParse(raw);
      if (!body.success)
        return json({ ok: false, error: "Choose a project and complete the mappings." }, 400);
      const setup = await rpc().call(
        "jira.projectSetup",
        { ...base, cloudId: body.data.cloudId, projectKey: body.data.projectKey },
        { timeoutMs: 40_000 },
      );
      const usable = new Map(usableIssueTypes(setup.issueTypes).map((t) => [t.id, t]));
      const priorityIds = new Set(setup.priorities.map((p) => p.id));
      const typeIds = Object.values(body.data.issueTypeMap);
      const missing = TICKET_TYPES.filter((t) => !body.data.issueTypeMap[t]);
      if (missing.length)
        return json({ ok: false, error: "Choose an issue type for every ticket category." }, 400);
      const blocked = typeIds
        .map((id) => setup.issueTypes.find((t) => t.id === id))
        .find((t) => t && t.blockingFields.length > 0);
      if (blocked)
        return json(
          {
            ok: false,
            error: `“${blocked.name}” has required fields TriageFox can't fill (${blocked.blockingFields.map((f) => f.name).join(", ")}). Pick another type or make those fields optional in Jira.`,
          },
          400,
        );
      if (typeIds.some((id) => !usable.has(id)))
        return json({ ok: false, error: "One of the chosen issue types isn't available." }, 400);
      if (Object.values(body.data.priorityMap).some((id) => !priorityIds.has(id)))
        return json({ ok: false, error: "One of the chosen priorities isn't available." }, 400);
      const project = (
        await rpc().call("jira.listProjects", { ...base, cloudId: body.data.cloudId })
      ).projects.find((p) => p.key === body.data.projectKey);
      if (!project) return json({ ok: false, error: "That project isn't available." }, 400);
      defaults = {
        cloudId: body.data.cloudId,
        projectKey: project.key,
        projectName: project.name,
        issueTypeMap: body.data.issueTypeMap,
        priorityMap: body.data.priorityMap,
        // Priority and due date aren't always on the create screen; the worker adapts (set after creating).
        setupOk: true,
      };
    } else {
      return json({ ok: false, error: "This connection has no target to choose." }, 400);
    }
  } catch (err) {
    return rpcErrorResponse(err);
  }

  await withOrg(db(), c.orgId, async (tx) => {
    const [row] = await tx
      .select({ metadata: schema.connections.metadata })
      .from(schema.connections)
      .where(and(eq(schema.connections.id, c.conn.id), eq(schema.connections.orgId, c.orgId)));
    await tx
      .update(schema.connections)
      .set({ metadata: { ...(row?.metadata ?? {}), defaults } })
      .where(and(eq(schema.connections.id, c.conn.id), eq(schema.connections.orgId, c.orgId)));
  });
  // Keep the automation's destinations in step with the chosen target.
  const automation = await getAutomation(c.orgId);
  if (automation) await syncDestinations(c.orgId, automation.id);
  await audit({
    orgId: c.orgId,
    actorUserId: c.userId,
    action: "connection.targets_updated",
    target: c.conn.id,
    metadata: { provider: c.conn.provider },
  });
  return json({ ok: true, defaults });
}

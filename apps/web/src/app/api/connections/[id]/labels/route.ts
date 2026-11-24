import { and, eq, schema, withOrg } from "@triagefox/db";
import { PRIORITIES, TICKET_TYPES, TRELLO_LABEL_COLORS } from "@triagefox/shared";
import { z } from "zod";
import { getAutomation, syncDestinations } from "@/lib/automations";
import { audit, getConnectionView } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard, rpcErrorResponse } from "@/lib/guards";
import { rpc } from "@/lib/rpc";

type Params = { params: Promise<{ id: string }> };
type Defaults = Record<string, unknown> & {
  boardId?: string;
  cloudId?: string;
  teamId?: string;
  labels?: unknown;
  typeLabels?: unknown;
};

async function load(req: Request, params: Params["params"]) {
  const guard = await managerGuard(req, { checkOrigin: req.method !== "GET" });
  if (!guard.ok) return { response: guard.response } as const;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return { response: json({ ok: false, error: "Not found." }, 404) } as const;
  const orgId = guard.ctx.workspace.id;
  const conn = await getConnectionView(orgId, id.data);
  if (
    !conn ||
    (conn.provider !== "trello" && conn.provider !== "jira" && conn.provider !== "linear")
  )
    return { response: json({ ok: false, error: "Not found." }, 404) } as const;
  const defaults = (conn.metadata.defaults ?? {}) as Defaults;
  const ready =
    conn.provider === "trello"
      ? !!defaults.boardId
      : conn.provider === "linear"
        ? !!defaults.teamId
        : !!defaults.cloudId;
  if (!ready)
    return {
      response: json({ ok: false, error: "Choose where tickets go first, then the labels." }, 400),
    } as const;
  const base = { orgId, connectionId: conn.id };
  return { orgId, conn, defaults, base, userId: guard.ctx.session.user.id } as const;
}

/** The labels to choose from, and the current choice (ADR 0013). */
export async function GET(req: Request, { params }: Params) {
  const c = await load(req, params);
  if ("response" in c) return c.response;
  try {
    if (c.conn.provider === "trello") {
      const { labels } = await rpc().call("trello.listLabels", {
        ...c.base,
        boardId: String(c.defaults.boardId),
      });
      return json({ ok: true, labels, choice: c.defaults.labels ?? {} });
    }
    if (c.conn.provider === "linear") {
      const { labels } = await rpc().call("linear.teamSetup", {
        ...c.base,
        teamId: String(c.defaults.teamId),
      });
      return json({
        ok: true,
        labels: [...new Set(labels.map((l) => l.name))],
        choice: { types: c.defaults.typeLabels ?? {} },
      });
    }
    const { labels } = await rpc().call("jira.listLabels", {
      ...c.base,
      cloudId: String(c.defaults.cloudId),
    });
    return json({ ok: true, labels, choice: { types: c.defaults.typeLabels ?? {} } });
  } catch (err) {
    return rpcErrorResponse(err);
  }
}

const newLabel = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.enum(TRELLO_LABEL_COLORS),
});

/** Creates a Trello label on the chosen board, so it can be picked straight away. */
export async function POST(req: Request, { params }: Params) {
  const c = await load(req, params);
  if ("response" in c) return c.response;
  if (c.conn.provider !== "trello")
    return json({ ok: false, error: "New labels are created by typing a new name." }, 400);
  const body = newLabel.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ ok: false, error: "Give the label a name." }, 400);
  try {
    const label = await rpc().call("trello.createLabel", {
      ...c.base,
      boardId: String(c.defaults.boardId),
      ...body.data,
    });
    return json({ ok: true, label });
  } catch (err) {
    return rpcErrorResponse(err);
  }
}

const choiceOf = <K extends string>(keys: readonly K[], value: z.ZodType<string>) =>
  z.partialRecord(z.enum(keys as unknown as [K, ...K[]]), value.nullable());
const priorityKeys = PRIORITIES.map(String) as [string, ...string[]];
const trelloBody = z.object({
  priorities: choiceOf(priorityKeys, z.string().min(1)).default({}),
  types: choiceOf(TICKET_TYPES, z.string().min(1)).default({}),
});
// Jira labels cannot contain spaces.
const jiraLabel = z
  .string()
  .trim()
  .regex(/^\S{1,255}$/, "Jira labels can't contain spaces.");
const jiraBody = z.object({ types: choiceOf(TICKET_TYPES, jiraLabel).default({}) });
// Linear labels are names (created on the team at delivery when missing).
const linearBody = z.object({
  types: choiceOf(TICKET_TYPES, z.string().trim().min(1).max(80)).default({}),
});

/** Saves the choice. A key that is left out keeps the default label; null means no label. */
export async function PUT(req: Request, { params }: Params) {
  const c = await load(req, params);
  if ("response" in c) return c.response;
  const raw = await req.json().catch(() => null);
  let patch: Record<string, unknown>;
  try {
    if (c.conn.provider === "trello") {
      const body = trelloBody.safeParse(raw);
      if (!body.success)
        return json({ ok: false, error: "Those label choices aren't valid." }, 400);
      // Never trust ids from the browser: every chosen label must be on the board.
      const { labels } = await rpc().call("trello.listLabels", {
        ...c.base,
        boardId: String(c.defaults.boardId),
      });
      const onBoard = new Set(labels.map((l) => l.id));
      const ids = [...Object.values(body.data.priorities), ...Object.values(body.data.types)];
      if (ids.some((id) => id && !onBoard.has(id)))
        return json({ ok: false, error: "One of those labels isn't on the board any more." }, 400);
      patch = { labels: body.data };
    } else {
      const body = (c.conn.provider === "linear" ? linearBody : jiraBody).safeParse(raw);
      if (!body.success)
        return json(
          { ok: false, error: body.error.issues[0]?.message ?? "Those labels aren't valid." },
          400,
        );
      patch = { typeLabels: body.data.types };
    }
  } catch (err) {
    return rpcErrorResponse(err);
  }

  await withOrg(db(), c.orgId, async (tx) => {
    const where = and(eq(schema.connections.id, c.conn.id), eq(schema.connections.orgId, c.orgId));
    const [row] = await tx
      .select({ metadata: schema.connections.metadata })
      .from(schema.connections)
      .where(where);
    const metadata = row?.metadata ?? {};
    const defaults = { ...((metadata.defaults as Defaults | undefined) ?? {}), ...patch };
    await tx
      .update(schema.connections)
      .set({ metadata: { ...metadata, defaults } })
      .where(where);
  });
  const automation = await getAutomation(c.orgId);
  if (automation) await syncDestinations(c.orgId, automation.id);
  await audit({
    orgId: c.orgId,
    actorUserId: c.userId,
    action: "connection.labels_updated",
    target: c.conn.id,
    metadata: { provider: c.conn.provider },
  });
  return json({ ok: true });
}

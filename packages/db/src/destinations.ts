import type { connections } from "./schema/connections";
import type { DestinationConfig, LabelMap } from "./schema/tickets";

type Connection = typeof connections.$inferSelect;

/**
 * The destination settings an automation gets from a connection's chosen target
 * (`connections.metadata.defaults`), or null while no usable target has been chosen.
 */
export function destinationConfigFromDefaults(
  c: Pick<Connection, "provider" | "metadata">,
): DestinationConfig | null {
  const d = c.metadata.defaults as Record<string, unknown> | undefined;
  if (!d) return null;
  if (c.provider === "trello" && d.boardId && d.listId)
    return {
      kind: "trello",
      boardId: String(d.boardId),
      listId: String(d.listId),
      ...(d.labels ? { labelMap: d.labels as LabelMap } : {}),
    };
  if (c.provider === "jira" && d.projectKey && d.setupOk)
    return {
      kind: "jira",
      cloudId: String(d.cloudId),
      projectKey: String(d.projectKey),
      issueTypeMap: d.issueTypeMap as Record<string, string>,
      priorityMap: d.priorityMap as Record<string, string>,
      ...(d.typeLabels ? { typeLabels: d.typeLabels as Record<string, string | null> } : {}),
    };
  return null;
}

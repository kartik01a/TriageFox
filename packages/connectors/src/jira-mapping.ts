import { PRIORITIES, type Priority, TICKET_TYPES, type TicketType } from "@triagefox/shared";
import type { IssueTypeSetup, JiraPriority } from "./jira";

export const usableIssueTypes = (types: IssueTypeSetup[]) =>
  types.filter((t) => !t.subtask && t.blockingFields.length === 0);

/** Sensible default: bug-like categories → "Bug", feature-like → Story/Feature/Task, else the first usable type. */
export function suggestIssueTypeMap(types: IssueTypeSetup[]): Partial<Record<TicketType, string>> {
  const usable = usableIssueTypes(types);
  const first = usable[0];
  if (!first) return {};
  const byName = (re: RegExp) => usable.find((t) => re.test(t.name));
  const bug = byName(/^bug$/i) ?? byName(/bug|defect|incident/i) ?? byName(/^task$/i) ?? first;
  const feature =
    byName(/^story$/i) ??
    byName(/feature/i) ??
    byName(/improvement/i) ??
    byName(/^task$/i) ??
    first;
  const out: Partial<Record<TicketType, string>> = {};
  for (const t of TICKET_TYPES)
    out[t] = t === "feature" || t === "improvement" ? feature.id : bug.id;
  return out;
}

const NAME_TO_PRIORITY: [RegExp, Priority][] = [
  [/highest|critical|blocker|urgent/i, 5],
  [/^high$|major/i, 4],
  [/medium|normal/i, 3],
  [/^low$|minor/i, 2],
  [/lowest|trivial/i, 1],
];

/** Maps our 1..5 onto the site's priorities (Jira lists them highest first); falls back to position. */
export function suggestPriorityMap(priorities: JiraPriority[]): Partial<Record<Priority, string>> {
  const out: Partial<Record<Priority, string>> = {};
  if (priorities.length === 0) return out;
  for (const p of priorities) {
    const hit = NAME_TO_PRIORITY.find(([re]) => re.test(p.name));
    if (hit && out[hit[1]] === undefined) out[hit[1]] = p.id;
  }
  for (const p of PRIORITIES) {
    if (out[p] !== undefined) continue;
    const idx = Math.round(((5 - p) * (priorities.length - 1)) / 4);
    const pick = priorities[idx];
    if (pick) out[p] = pick.id;
  }
  return out;
}

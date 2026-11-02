/** Ticket categories the AI assigns (docs/ai-triage.md). Shared by AI output, mappings and UI. */
export const TICKET_TYPES = [
  "bug",
  "ui_ux",
  "feature",
  "improvement",
  "performance",
  "infra",
  "security",
  "data",
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  bug: "Bug",
  ui_ux: "UI/UX",
  feature: "Feature",
  improvement: "Improvement",
  performance: "Performance",
  infra: "Infra",
  security: "Security",
  data: "Data",
};

/** Priority 1 (lowest) .. 5 (critical), the same scale in Trello labels and Jira priorities. */
export const PRIORITIES = [1, 2, 3, 4, 5] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_NAMES: Record<Priority, string> = {
  1: "Lowest",
  2: "Low",
  3: "Medium",
  4: "High",
  5: "Critical",
};

/** Trello's label colours (the plain ones), for labels the customer creates from TriageFox. */
export const TRELLO_LABEL_COLORS = [
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "blue",
  "sky",
  "lime",
  "pink",
  "black",
] as const;

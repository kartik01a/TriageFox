import { TICKET_TYPES } from "@triagefox/shared";
import { z } from "zod";

/**
 * What the model must return. OpenAI's strict structured-output mode needs every property to be
 * present, so optional values are nullable. This is only the model-facing shape: the output is
 * validated again, then cleaned (see postprocess.ts), before anything acts on it.
 */

export const NO_ACTION_CATEGORIES = [
  "question",
  "billing",
  "refund_request",
  "account",
  "complaint",
  "praise",
  "greeting",
  "spam",
] as const;

const priority = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const modelActionSchema = z.object({
  kind: z.enum(["create", "update", "duplicate_of", "no_action"]),
  /** For update / duplicate_of: the id of one of the tickets listed in the prompt. Otherwise null. */
  issueId: z.string().nullable(),
  type: z.enum(TICKET_TYPES).nullable(),
  title: z.string(),
  summary: z.string(),
  stepsToReproduce: z.array(z.string()),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  environment: z
    .object({
      browser: z.string().nullable(),
      os: z.string().nullable(),
      device: z.string().nullable(),
      pageUrl: z.string().nullable(),
    })
    .nullable(),
  priority: priority.nullable(),
  priorityReason: z.string(),
  /** The customer's exact words stating a deadline, or null. Never a computed date. */
  dueDateQuote: z.string().nullable(),
  relevantAttachmentIds: z.array(z.string()),
  confidence: z.number(),
  reason: z.string(),
  category: z.enum(NO_ACTION_CATEGORIES).nullable(),
  /** update only: the problem was fixed in the chat itself (the team should double-check the ticket). */
  resolvedInChat: z.boolean(),
});

export const modelOutputSchema = z.object({ actions: z.array(modelActionSchema) });

export type ModelAction = z.infer<typeof modelActionSchema>;
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** JSON Schema for OpenAI's `response_format`. */
export function modelOutputJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(modelOutputSchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  schema.$schema = undefined; // not accepted by the API
  return JSON.parse(JSON.stringify(schema));
}

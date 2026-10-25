import { z } from "zod";

export const waitlistSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  /** Honeypot: real users never see or fill this field. */
  website: z.string().optional(),
  source: z.string().max(40).optional(),
});

export type WaitlistResult =
  | { kind: "ignore" } // honeypot tripped: answer success, store nothing
  | { kind: "store"; email: string; source: string | null }
  | { kind: "invalid" };

export function parseWaitlist(input: unknown): WaitlistResult {
  const parsed = waitlistSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  if (parsed.data.website) return { kind: "ignore" };
  return { kind: "store", email: parsed.data.email, source: parsed.data.source ?? null };
}

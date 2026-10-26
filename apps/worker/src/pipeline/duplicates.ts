import type { DuplicateCandidate } from "@triagefox/ai";
import { type AiProvider, redact } from "@triagefox/ai";
import type { Db } from "@triagefox/db";
import { and, eq, schema, sql, withOrg } from "@triagefox/db";
import type { PipelineLogger } from "./deps";

/** Cosine similarity below this is never worth showing to the AI. The AI makes the final call. */
const MIN_SIMILARITY = 0.35;
const MAX_CANDIDATES = 5;
const MAX_TEXT = 2000;

const vec = (v: number[]) => sql`${JSON.stringify(v)}::vector`;

/** What a conversation is "about", for the similarity search: the customer's own words, personal data removed. */
export function customerText(messages: { role: string; text?: string }[]): string {
  return redact(
    messages
      .filter((m) => m.role === "customer" && m.text)
      .map((m) => m.text)
      .join("\n"),
  ).text.slice(0, MAX_TEXT);
}

/**
 * The open tickets most like this conversation, from other conversations of the same automation.
 * Best effort: any failure (no embedding support, outage) just means "no candidates".
 */
export async function findDuplicateCandidates(args: {
  db: Db;
  orgId: string;
  automationId: string;
  threadId: string;
  provider: AiProvider;
  model: string;
  text: string;
  log: PipelineLogger;
}): Promise<DuplicateCandidate[]> {
  const { db, orgId, provider } = args;
  if (!provider.embed || !args.text.trim()) return [];
  try {
    const [stock] = await withOrg(db, orgId, (tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.issues)
        .where(
          and(
            eq(schema.issues.automationId, args.automationId),
            eq(schema.issues.status, "active"),
            sql`${schema.issues.embedding} is not null`,
            sql`${schema.issues.originThreadId} <> ${args.threadId}`,
          ),
        ),
    );
    if (!stock?.n) return []; // nothing to compare with: skip the embedding call
    const [embedding] = await provider.embed(args.model, [args.text]);
    if (!embedding) return [];
    const rows = await withOrg(db, orgId, (tx) =>
      tx.execute<{ id: string; title: string; summary: string; similarity: number }>(sql`
        select id, title, summary, 1 - (embedding <=> ${vec(embedding)}) as similarity
        from issues
        where automation_id = ${args.automationId}
          and status = 'active'
          and embedding is not null
          and origin_thread_id <> ${args.threadId}
        order by embedding <=> ${vec(embedding)}
        limit ${MAX_CANDIDATES}`),
    );
    return [...rows]
      .filter((r) => Number(r.similarity) >= MIN_SIMILARITY)
      .map((r) => ({ id: r.id, title: r.title, summary: r.summary }));
  } catch (err) {
    args.log.warn({ err: (err as Error).message }, "duplicate search skipped");
    return [];
  }
}

/** Stores embeddings for new issues. Best effort: an issue without one just can't be matched yet. */
export async function embedIssues(args: {
  db: Db;
  orgId: string;
  provider: AiProvider;
  model: string;
  issues: { id: string; title: string; summary: string }[];
  log: PipelineLogger;
}) {
  if (!args.provider.embed || args.issues.length === 0) return;
  try {
    const vectors = await args.provider.embed(
      args.model,
      args.issues.map((i) => `${i.title}\n${i.summary}`.slice(0, MAX_TEXT)),
    );
    await withOrg(args.db, args.orgId, async (tx) => {
      for (const [i, issue] of args.issues.entries()) {
        const v = vectors[i];
        if (v)
          await tx.execute(sql`update issues set embedding = ${vec(v)} where id = ${issue.id}`);
      }
    });
  } catch (err) {
    args.log.warn({ err: (err as Error).message }, "issue embedding skipped");
  }
}

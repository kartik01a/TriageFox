import { openSecret, type PrivateKeyring } from "@triagefox/crypto";
import { type Db, eq, schema, withOrg } from "@triagefox/db";

export interface AiKey {
  key: string;
  source: "byok" | "platform";
}

/** Own key first (write-only; opened only here); otherwise the platform key. */
export async function resolveAiKey(
  deps: { db: Db; keyring: PrivateKeyring; config: { OPENAI_API_KEY?: string } },
  orgId: string,
): Promise<AiKey | null> {
  const [row] = await withOrg(deps.db, orgId, (tx) =>
    tx
      .select({ sealed: schema.aiSettings.keySealed })
      .from(schema.aiSettings)
      .where(eq(schema.aiSettings.orgId, orgId)),
  );
  if (row?.sealed) {
    const key = await openSecret(
      row.sealed,
      { orgId, recordId: orgId, purpose: "ai.key" },
      deps.keyring,
    );
    return { key, source: "byok" };
  }
  return deps.config.OPENAI_API_KEY
    ? { key: deps.config.OPENAI_API_KEY, source: "platform" }
    : null;
}

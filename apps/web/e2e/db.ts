// Test-only database access as the table owner (bypasses row-level security) for setup and cleanup.
import { createDb } from "@triagefox/db";

let db: ReturnType<typeof createDb> | undefined;

export function ownerDb() {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error("DATABASE_MIGRATION_URL is required for e2e setup (see .env.example)");
  db ??= createDb(url, { max: 2 });
  return db;
}

export async function closeOwnerDb() {
  await db?.$client.end();
  db = undefined;
}

// A test workspace is one whose members are all made-up `@example.test` accounts.
const TEST_ORG = `not exists (
  select 1 from member m join "user" u on u.id = m.user_id
  where m.organization_id = c.org_id and u.email not like '%@example.test')`;

/**
 * Removes Crisp links left by earlier test runs. Never touches a real workspace: the dev Crisp website
 * may be linked to the owner's own workspace for hand testing, and removing that link deletes their
 * automation and its history.
 */
export async function removeTestCrispLinks() {
  await ownerDb().$client.unsafe(
    `delete from connections c where c.provider = 'crisp' and ${TEST_ORG}`,
  );
}

/** True when the dev Crisp website is linked to a real workspace: live Crisp tests then skip. */
export async function crispWebsiteInRealUse(websiteId: string | undefined) {
  if (!websiteId) return false;
  const rows = await ownerDb().$client.unsafe(
    `select 1 from connections c where c.provider = 'crisp' and c.metadata->>'websiteId' = $1 and not ${TEST_ORG}`,
    [websiteId],
  );
  return rows.length > 0;
}

export const REAL_USE_REASON =
  "the dev Crisp website is linked to your own workspace; unlink it to run the live Crisp tests";

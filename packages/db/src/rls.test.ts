import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, type Db, withOrg } from "./client";
import { aiSettings, auditLog, connections } from "./schema/index";

// Connects as the restricted runtime role: the same one the web app and worker use.
const appUrl = process.env.DATABASE_URL;
const ownerUrl = process.env.DATABASE_MIGRATION_URL;
if (!appUrl || !ownerUrl) throw new Error("DATABASE_URL and DATABASE_MIGRATION_URL are required");

const db: Db = createDb(appUrl, { max: 2 });
const owner: Db = createDb(ownerUrl, { max: 1 });
const orgA = `org_a_${randomUUID()}`;
const orgB = `org_b_${randomUUID()}`;

afterAll(async () => {
  await owner.$client.unsafe("delete from audit_log where org_id in ($1, $2)", [orgA, orgB]);
  await db.$client.end();
  await owner.$client.end();
});

describe("row-level security on tenant tables", () => {
  it("the runtime role cannot bypass RLS and does not own the tables", async () => {
    const [role] = await db.$client`
      select rolbypassrls, rolsuper from pg_roles where rolname = current_user`;
    expect(role?.rolbypassrls).toBe(false);
    expect(role?.rolsuper).toBe(false);
    const [t] = await db.$client`select tableowner from pg_tables where tablename = 'audit_log'`;
    expect(t?.tableowner).not.toBe("triagefox_app");
  });

  it("a workspace only sees its own rows", async () => {
    await withOrg(db, orgA, (tx) => tx.insert(auditLog).values({ orgId: orgA, action: "a.test" }));
    await withOrg(db, orgB, (tx) => tx.insert(auditLog).values({ orgId: orgB, action: "b.test" }));

    const seenByA = await withOrg(db, orgA, (tx) => tx.select().from(auditLog));
    const seenByB = await withOrg(db, orgB, (tx) => tx.select().from(auditLog));
    expect(seenByA.map((r) => r.action)).toEqual(["a.test"]);
    expect(seenByB.map((r) => r.action)).toEqual(["b.test"]);
  });

  it("returns nothing when no workspace is set", async () => {
    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(0);
  });

  it("cannot write a row for another workspace", async () => {
    await expect(
      withOrg(db, orgA, (tx) => tx.insert(auditLog).values({ orgId: orgB, action: "evil" })),
    ).rejects.toThrow();
  });

  it("cannot update or delete another workspace's rows", async () => {
    const updated = await withOrg(db, orgA, (tx) =>
      tx.update(auditLog).set({ action: "hijacked" }).returning(),
    );
    expect(updated.every((r) => r.orgId === orgA)).toBe(true);
    const bRows = await withOrg(db, orgB, (tx) => tx.select().from(auditLog));
    expect(bRows[0]?.action).toBe("b.test");
  });

  it("withOrg refuses an empty workspace id", async () => {
    await expect(withOrg(db, "", async () => 1)).rejects.toThrow(/orgId/);
  });
});

describe("row-level security on connections and ai_settings", () => {
  const siteId = `site-${randomUUID()}`;

  afterAll(async () => {
    await owner.$client.unsafe("delete from connections where org_id in ($1, $2)", [orgA, orgB]);
    await owner.$client.unsafe("delete from ai_settings where org_id in ($1, $2)", [orgA, orgB]);
  });

  it("a workspace only sees and changes its own connections", async () => {
    await withOrg(db, orgA, (tx) =>
      tx.insert(connections).values({
        orgId: orgA,
        provider: "trello",
        authType: "token",
        metadata: { username: "a" },
      }),
    );
    await withOrg(db, orgB, (tx) =>
      tx.insert(connections).values({
        orgId: orgB,
        provider: "trello",
        authType: "token",
        metadata: { username: "b" },
      }),
    );
    const seenByA = await withOrg(db, orgA, (tx) => tx.select().from(connections));
    expect(seenByA.map((c) => c.metadata.username)).toEqual(["a"]);
    expect(await db.select().from(connections)).toHaveLength(0); // no workspace set: nothing
    await expect(
      withOrg(db, orgA, (tx) =>
        tx.insert(connections).values({ orgId: orgB, provider: "trello", authType: "token" }),
      ),
    ).rejects.toThrow();
    const deleted = await withOrg(db, orgA, (tx) => tx.delete(connections).returning());
    expect(deleted.every((c) => c.orgId === orgA)).toBe(true);
    expect(await withOrg(db, orgB, (tx) => tx.select().from(connections))).toHaveLength(1);
  });

  it("a Crisp website can be linked to only one workspace, even across workspaces", async () => {
    await withOrg(db, orgA, (tx) =>
      tx.insert(connections).values({
        orgId: orgA,
        provider: "crisp",
        authType: "plugin_install",
        metadata: { websiteId: siteId },
      }),
    );
    const err = await withOrg(db, orgB, (tx) =>
      tx.insert(connections).values({
        orgId: orgB,
        provider: "crisp",
        authType: "plugin_install",
        metadata: { websiteId: siteId },
      }),
    ).catch((e: unknown) => e);
    // 23505 = unique_violation: the code the link action turns into "already linked to another workspace".
    expect((err as { cause?: { code?: string } }).cause?.code).toBe("23505");
  });

  it("rejects unknown providers and statuses", async () => {
    await expect(
      withOrg(db, orgA, (tx) =>
        tx
          .insert(connections)
          .values({ orgId: orgA, provider: "slack" as never, authType: "token" }),
      ),
    ).rejects.toThrow();
    await expect(
      withOrg(db, orgA, (tx) =>
        tx
          .insert(connections)
          .values({ orgId: orgA, provider: "trello", authType: "token", status: "weird" as never }),
      ),
    ).rejects.toThrow();
  });

  it("AI key rows are isolated per workspace", async () => {
    await withOrg(db, orgA, (tx) =>
      tx.insert(aiSettings).values({ orgId: orgA, keySealed: "v1:a", keyHint: "sk-…aaaa" }),
    );
    await withOrg(db, orgB, (tx) =>
      tx.insert(aiSettings).values({ orgId: orgB, keySealed: "v1:b", keyHint: "sk-…bbbb" }),
    );
    expect(
      (await withOrg(db, orgA, (tx) => tx.select().from(aiSettings))).map((r) => r.keyHint),
    ).toEqual(["sk-…aaaa"]);
    expect(await db.select().from(aiSettings)).toHaveLength(0);
    await expect(
      withOrg(db, orgA, (tx) => tx.insert(aiSettings).values({ orgId: orgB, keySealed: "v1:x" })),
    ).rejects.toThrow();
  });
});

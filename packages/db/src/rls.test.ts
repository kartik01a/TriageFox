import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, type Db, withOrg } from "./client";
import { auditLog } from "./schema/index";

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

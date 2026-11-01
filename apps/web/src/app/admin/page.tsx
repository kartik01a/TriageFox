import { desc, schema, sql } from "@triagefox/db";
import Link from "next/link";
import { db } from "@/lib/db";
import { PageHeader, Panel, Stat, Table } from "./admin-ui";

export default async function AdminHome() {
  const [orgs] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.organization);
  const [open] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.supportItems)
    .where(sql`${schema.supportItems.status} <> 'done'`);
  const [publicPlans] = await db()
    .select({ n: sql<number>`count(distinct ${schema.plans.slug})::int` })
    .from(schema.plans)
    .where(sql`${schema.plans.isPublic} and ${schema.plans.isActive}`);
  const log = await db()
    .select()
    .from(schema.adminAuditLog)
    .orderBy(desc(schema.adminAuditLog.createdAt))
    .limit(30);
  return (
    <>
      <PageHeader title="Overview">How the platform looks right now.</PageHeader>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Workspaces" value={orgs?.n ?? 0} />
        <Stat label="Open support items" value={open?.n ?? 0} />
        <Stat
          label="Plans on sale"
          value={publicPlans?.n ?? 0}
          hint={
            publicPlans?.n
              ? undefined
              : "Add Dodo product ids on the Plans page, then make a plan public."
          }
        />
      </div>
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Recent admin changes</h2>
          <Link href="/admin/plans" className="text-xs text-primary hover:underline">
            Go to plans
          </Link>
        </div>
        {log.length === 0 ? (
          <Panel>
            <p className="text-muted-foreground">No admin changes yet.</p>
          </Panel>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{r.createdAt.toLocaleString()}</td>
                  <td>{r.adminEmail}</td>
                  <td>
                    <code className="text-xs">{r.action}</code>
                  </td>
                  <td className="max-w-48 truncate">{r.target}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}

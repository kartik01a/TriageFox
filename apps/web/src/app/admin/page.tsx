import { desc, schema, sql } from "@triagefox/db";
import { db } from "@/lib/db";

export default async function AdminHome() {
  const [orgs] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.organization);
  const [open] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.supportItems)
    .where(sql`${schema.supportItems.status} <> 'done'`);
  const log = await db()
    .select()
    .from(schema.adminAuditLog)
    .orderBy(desc(schema.adminAuditLog.createdAt))
    .limit(30);
  return (
    <div className="space-y-6">
      <p>
        {orgs?.n ?? 0} workspaces · {open?.n ?? 0} open support items
      </p>
      <section>
        <h2 className="mb-2 font-semibold">Recent admin changes</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="py-1 pr-3">When</th>
              <th className="pr-3">Who</th>
              <th className="pr-3">Action</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.id} className="border-b border-border/50">
                <td className="py-1 pr-3">{r.createdAt.toLocaleString()}</td>
                <td className="pr-3">{r.adminEmail}</td>
                <td className="pr-3">{r.action}</td>
                <td>{r.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

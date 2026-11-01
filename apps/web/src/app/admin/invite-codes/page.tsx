import { listPlans } from "@triagefox/billing";
import { desc, schema } from "@triagefox/db";
import { db } from "@/lib/db";
import { InviteCodeForm } from "../admin-forms";
import { Badge, PageHeader, Panel, Table } from "../admin-ui";

export default async function InviteCodesPage() {
  const [plans, codes] = await Promise.all([
    listPlans(db()),
    db().select().from(schema.inviteCodes).orderBy(desc(schema.inviteCodes.createdAt)).limit(100),
  ]);
  return (
    <>
      <PageHeader title="Invite codes">
        A code gives free access, is single-use, tied to one email address and valid for 7 days.
        Only a hash is stored: the code is shown once, here, when you create it. Send it to the
        person yourself.
      </PageHeader>
      <Panel title="Create a code">
        <InviteCodeForm plans={plans.map((p) => ({ id: p.id, name: p.name }))} />
      </Panel>
      <Table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Months</th>
            <th>Expires</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {codes.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted-foreground">
                No codes yet.
              </td>
            </tr>
          )}
          {codes.map((c) => (
            <tr key={c.id}>
              <td>{c.email}</td>
              <td>{c.months}</td>
              <td>{c.expiresAt.toLocaleDateString()}</td>
              <td>
                {c.usedAt ? (
                  <Badge tone="good">used</Badge>
                ) : c.expiresAt < new Date() ? (
                  <Badge>expired</Badge>
                ) : (
                  <Badge tone="brand">open</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

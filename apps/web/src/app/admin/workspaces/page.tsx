import { listPlans } from "@triagefox/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listWorkspaces } from "@/lib/admin-data";
import { db } from "@/lib/db";
import { WorkspaceActions } from "../admin-forms";
import { PageHeader, Table } from "../admin-ui";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [rows, plans] = await Promise.all([listWorkspaces(q), listPlans(db())]);
  return (
    <>
      <PageHeader title="Workspaces">
        Every workspace, its plan and usage. Actions are recorded in the audit log.
      </PageHeader>
      <form className="flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by name"
          className="max-w-xs"
          aria-label="Search"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <Table>
        <thead>
          <tr>
            <th>Workspace</th>
            <th>Owner</th>
            <th>Plan</th>
            <th>Usage</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="text-muted-foreground">
                No workspaces found.
              </td>
            </tr>
          )}
          {rows.map((w) => (
            <tr key={w.id}>
              <td>
                <span className="font-medium">{w.name}</span>
                <br />
                <code className="text-xs text-muted-foreground">{w.id}</code>
              </td>
              <td>{w.ownerEmail}</td>
              <td>
                {w.summary.planName ?? "-"}
                <br />
                <span className="text-xs text-muted-foreground">
                  {w.summary.status}
                  {w.summary.trialDaysLeft !== null ? `, ${w.summary.trialDaysLeft} days left` : ""}
                  {w.summary.compUntil ? `, until ${w.summary.compUntil.toLocaleDateString()}` : ""}
                </span>
              </td>
              <td className="tabular-nums">
                {w.summary.used}
                {w.summary.limit !== null ? ` / ${w.summary.limit}` : ""}
              </td>
              <td>
                <WorkspaceActions
                  id={w.id}
                  plans={plans.map((p) => ({ id: p.id, name: p.name }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

import { listPlans } from "@triagefox/billing";
import { listWorkspaces } from "@/lib/admin-data";
import { db } from "@/lib/db";
import { WorkspaceActions } from "../admin-forms";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [rows, plans] = await Promise.all([listWorkspaces(q), listPlans(db())]);
  return (
    <div className="space-y-4">
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by name"
          className="rounded border border-input bg-card px-2 py-1"
          aria-label="Search"
        />
        <button type="submit" className="rounded border border-input px-3 py-1">
          Search
        </button>
      </form>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1 pr-3">Workspace</th>
            <th className="pr-3">Owner</th>
            <th className="pr-3">Plan</th>
            <th className="pr-3">Usage</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className="border-b border-border/50 align-top">
              <td className="py-2 pr-3">
                {w.name}
                <br />
                <code className="text-xs">{w.id}</code>
              </td>
              <td className="pr-3">{w.ownerEmail}</td>
              <td className="pr-3">
                {w.summary.planName ?? "-"}
                <br />
                {w.summary.status}
                {w.summary.trialDaysLeft !== null ? `, ${w.summary.trialDaysLeft} days left` : ""}
                {w.summary.compUntil ? `, until ${w.summary.compUntil.toLocaleDateString()}` : ""}
              </td>
              <td className="pr-3">
                {w.summary.used}
                {w.summary.limit !== null ? ` / ${w.summary.limit}` : ""}
              </td>
              <td className="py-2">
                <WorkspaceActions
                  id={w.id}
                  plans={plans.map((p) => ({ id: p.id, name: p.name }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

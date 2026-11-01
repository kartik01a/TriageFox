import { usageReport } from "@/lib/admin-data";
import { PageHeader, Stat, Table } from "../admin-ui";

const usd = (v: number) => `$${v.toFixed(2)}`;

export default async function UsagePage() {
  const r = await usageReport();
  return (
    <>
      <PageHeader title="AI spend">Since {r.month}, across all workspaces.</PageHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Total AI spend" value={usd(r.totalUsd)} />
        <Stat label="Of which on trials" value={usd(r.trialUsd)} />
      </div>
      <Table>
        <thead>
          <tr>
            <th>Workspace</th>
            <th>Conversations</th>
            <th>AI cost</th>
            <th>Of which trial</th>
          </tr>
        </thead>
        <tbody>
          {r.top.length === 0 && (
            <tr>
              <td colSpan={4} className="text-muted-foreground">
                No AI usage yet.
              </td>
            </tr>
          )}
          {r.top.map((t) => (
            <tr key={t.orgId}>
              <td>{t.name}</td>
              <td className="tabular-nums">{t.conversations}</td>
              <td className="tabular-nums">{usd(t.costUsd)}</td>
              <td className="tabular-nums">{usd(t.trialCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

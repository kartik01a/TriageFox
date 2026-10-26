import { usageReport } from "@/lib/admin-data";

const usd = (v: number) => `$${v.toFixed(2)}`;

export default async function UsagePage() {
  const r = await usageReport();
  return (
    <div className="space-y-4">
      <p>
        Since {r.month}: <strong>{usd(r.totalUsd)}</strong> AI spend in total, of which{" "}
        <strong>{usd(r.trialUsd)}</strong> on trials.
      </p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1 pr-3">Workspace</th>
            <th className="pr-3">Conversations</th>
            <th className="pr-3">AI cost</th>
            <th>of which trial</th>
          </tr>
        </thead>
        <tbody>
          {r.top.map((t) => (
            <tr key={t.orgId} className="border-b border-border/50">
              <td className="py-1 pr-3">{t.name}</td>
              <td className="pr-3">{t.conversations}</td>
              <td className="pr-3">{usd(t.costUsd)}</td>
              <td>{usd(t.trialCostUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

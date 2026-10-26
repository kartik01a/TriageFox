import { listPlans } from "@triagefox/billing";
import { desc, schema } from "@triagefox/db";
import { db } from "@/lib/db";
import { InviteCodeForm } from "../admin-forms";

export default async function InviteCodesPage() {
  const [plans, codes] = await Promise.all([
    listPlans(db()),
    db().select().from(schema.inviteCodes).orderBy(desc(schema.inviteCodes.createdAt)).limit(100),
  ]);
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        A code is single-use, tied to one email address and valid for 7 days. Only a hash is stored:
        the code is shown once, here, when you create it. Send it to the person yourself.
      </p>
      <InviteCodeForm plans={plans.map((p) => ({ id: p.id, name: p.name }))} />
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1 pr-3">Email</th>
            <th className="pr-3">Months</th>
            <th className="pr-3">Expires</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c.id} className="border-b border-border/50">
              <td className="py-1 pr-3">{c.email}</td>
              <td className="pr-3">{c.months}</td>
              <td className="pr-3">{c.expiresAt.toLocaleDateString()}</td>
              <td>{c.usedAt ? "used" : c.expiresAt < new Date() ? "expired" : "open"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

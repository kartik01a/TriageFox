import { asc, desc, schema } from "@triagefox/db";
import { formatPrice } from "@/lib/billing";
import { db } from "@/lib/db";
import { JsonEditor } from "../admin-forms";

const TEMPLATE = {
  slug: "example",
  name: "Example",
  prices: { USD: { monthly: 900, yearly: 9000 }, INR: { monthly: 69900, yearly: 699000 } },
  conversationLimit: 300,
  fairUseCap: null,
  inboxLimit: 1,
  byokRequired: false,
  supportLevel: "email",
  providerPriceIds: {},
  isPublic: false,
  isPopular: false,
  sortOrder: 100,
};

export default async function PlansPage() {
  const plans = await db()
    .select()
    .from(schema.plans)
    .orderBy(asc(schema.plans.sortOrder), asc(schema.plans.slug), desc(schema.plans.version));
  const newest = new Set<string>();
  const latest = new Map<string, string>();
  for (const p of plans) if (!latest.has(p.slug)) latest.set(p.slug, p.id);
  for (const id of latest.values()) newest.add(id);

  return (
    <div className="space-y-8">
      <p className="text-muted-foreground">
        Prices are in minor units (900 = $9.00, 69900 = ₹699). Changing a price or a limit creates a
        new version; people already subscribed keep theirs. A plan becomes public only once the
        payment provider's product ids are entered (create the products in the provider's dashboard
        first), and a new version starts without them.
      </p>
      <section>
        <h2 className="mb-2 font-semibold">All plans and versions</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              <th className="py-1 pr-3">Plan</th>
              <th className="pr-3">v</th>
              <th className="pr-3">Prices (monthly / yearly)</th>
              <th className="pr-3">Conversations</th>
              <th className="pr-3">Inboxes</th>
              <th className="pr-3">Own key</th>
              <th>Public</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-border/50 align-top ${newest.has(p.id) ? "" : "text-muted-foreground"}`}
              >
                <td className="py-1 pr-3">
                  {p.name}
                  <br />
                  <code>{p.slug}</code>
                </td>
                <td className="pr-3">
                  {p.version}
                  {newest.has(p.id) ? "" : " (old)"}
                </td>
                <td className="pr-3">
                  {Object.entries(p.prices).map(([c, v]) => (
                    <div key={c}>
                      {formatPrice(v.monthly, c)} / {formatPrice(v.yearly, c)}
                    </div>
                  ))}
                </td>
                <td className="pr-3">
                  {p.conversationLimit ?? `unlimited (fair use ${p.fairUseCap ?? "-"})`}
                </td>
                <td className="pr-3">{p.inboxLimit ?? "unlimited"}</td>
                <td className="pr-3">{p.byokRequired ? "yes" : "no"}</td>
                <td>
                  {p.isPublic ? "yes" : "no"}
                  {p.isActive ? "" : " (archived)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="space-y-4">
        <h2 className="font-semibold">Edit the newest version</h2>
        {plans
          .filter((p) => newest.has(p.id))
          .map((p) => (
            <JsonEditor
              key={p.id}
              url={`/api/admin/plans/${p.id}`}
              method="PATCH"
              label={`${p.name} (${p.slug})`}
              initial={{
                name: p.name,
                prices: p.prices,
                conversationLimit: p.conversationLimit,
                fairUseCap: p.fairUseCap,
                inboxLimit: p.inboxLimit,
                byokRequired: p.byokRequired,
                supportLevel: p.supportLevel,
                providerPriceIds: p.providerPriceIds,
                isPublic: p.isPublic,
                isActive: p.isActive,
                isPopular: p.isPopular,
                sortOrder: p.sortOrder,
              }}
            />
          ))}
      </section>
      <section>
        <h2 className="mb-1 font-semibold">Create a plan</h2>
        <JsonEditor url="/api/admin/plans" method="POST" initial={TEMPLATE} label="New plan" />
      </section>
    </div>
  );
}

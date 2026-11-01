import { asc, desc, schema } from "@triagefox/db";
import { formatPrice } from "@/lib/billing";
import { db } from "@/lib/db";
import { JsonEditor, PlanEditor } from "../admin-forms";
import { Badge, PageHeader, Panel, Table } from "../admin-ui";

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
  const latest = new Map<string, string>();
  for (const p of plans) if (!latest.has(p.slug)) latest.set(p.slug, p.id);
  const newest = new Set(latest.values());
  const current = plans.filter((p) => newest.has(p.id));
  const older = plans.filter((p) => !newest.has(p.id));

  return (
    <>
      <PageHeader title="Plans">
        Create the products in Dodo first, paste their ids here, then make the plan public. Prices
        are in minor units (900 = $9.00, 69900 = ₹699). Changing a price or a limit creates a new
        version; people already subscribed keep theirs, and the new version starts without product
        ids.
      </PageHeader>

      {current.length === 0 && (
        <Panel>
          <p className="text-muted-foreground">
            No plans yet. Run <code>pnpm db:seed</code>, or create one below.
          </p>
        </Panel>
      )}

      {current.map((p) => {
        const ids = p.providerPriceIds.dodo ?? {};
        const buyable = Object.keys(p.prices).some((c) => ids[c]?.monthly && ids[c]?.yearly);
        return (
          <Panel key={p.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <p className="text-xs text-muted-foreground">
                  <code>{p.slug}</code> · version {p.version}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={p.isPublic ? "good" : "neutral"}>
                  {p.isPublic ? "Public" : "Hidden"}
                </Badge>
                {p.isPopular && <Badge tone="brand">Most popular</Badge>}
                {p.byokRequired && <Badge>Own OpenAI key</Badge>}
                {!p.isActive && <Badge tone="warn">Archived</Badge>}
                {!buyable && <Badge tone="warn">Needs Dodo ids</Badge>}
              </div>
            </div>
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Prices (monthly / yearly)</dt>
                <dd>
                  {Object.entries(p.prices).map(([c, v]) => (
                    <div key={c}>
                      {formatPrice(v.monthly, c)} / {formatPrice(v.yearly, c)}
                    </div>
                  ))}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Conversations</dt>
                <dd>
                  {p.conversationLimit?.toLocaleString("en-US") ??
                    `Unlimited (fair use ${p.fairUseCap?.toLocaleString("en-US") ?? "-"})`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Inboxes</dt>
                <dd>{p.inboxLimit ?? "Unlimited"}</dd>
              </div>
            </dl>
            <hr className="border-border" />
            <PlanEditor
              id={p.id}
              name={p.name}
              supportLevel={p.supportLevel}
              isPopular={p.isPopular}
              isPublic={p.isPublic}
              isActive={p.isActive}
              sortOrder={p.sortOrder}
              currencies={Object.keys(p.prices)}
              providerPriceIds={p.providerPriceIds}
            />
            <details className="rounded-lg border border-border px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">
                Advanced: prices and limits (creates a new version)
              </summary>
              <div className="mt-3">
                <JsonEditor
                  url={`/api/admin/plans/${p.id}`}
                  method="PATCH"
                  label={`${p.name} prices and limits`}
                  initial={{
                    prices: p.prices,
                    conversationLimit: p.conversationLimit,
                    fairUseCap: p.fairUseCap,
                    inboxLimit: p.inboxLimit,
                    byokRequired: p.byokRequired,
                  }}
                />
              </div>
            </details>
          </Panel>
        );
      })}

      {older.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold">Older versions (kept for existing subscribers)</h2>
          <Table>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Version</th>
                <th>Prices</th>
                <th>Conversations</th>
              </tr>
            </thead>
            <tbody>
              {older.map((p) => (
                <tr key={p.id} className="text-muted-foreground">
                  <td>{p.name}</td>
                  <td>v{p.version}</td>
                  <td>
                    {Object.entries(p.prices)
                      .map(([c, v]) => `${formatPrice(v.monthly, c)}/${formatPrice(v.yearly, c)}`)
                      .join("  ")}
                  </td>
                  <td>{p.conversationLimit ?? "Unlimited"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <Panel title="Create a plan">
        <JsonEditor url="/api/admin/plans" method="POST" initial={TEMPLATE} label="New plan" />
      </Panel>
    </>
  );
}

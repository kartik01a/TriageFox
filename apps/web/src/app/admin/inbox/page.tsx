import { and, desc, eq, schema } from "@triagefox/db";
import Link from "next/link";
import { db } from "@/lib/db";
import { InboxItemActions, SupportAutomationForm } from "../admin-forms";

const CATEGORY: Record<string, string> = {
  bug: "Bug",
  feature: "Feature",
  billing: "Billing",
  refund_request: "Refund request",
  account: "Account",
  complaint: "Complaint",
  question: "Question",
  praise: "Praise",
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: string }>;
}) {
  const { status, tab } = await searchParams;
  const testimonials = tab === "testimonials";
  const items = await db()
    .select()
    .from(schema.supportItems)
    .where(
      and(
        testimonials ? eq(schema.supportItems.category, "praise") : undefined,
        !testimonials && (status === "new" || status === "in_progress" || status === "done")
          ? eq(schema.supportItems.status, status)
          : undefined,
      ),
    )
    .orderBy(desc(schema.supportItems.createdAt))
    .limit(200);
  return (
    <div className="space-y-4">
      <nav aria-label="Inbox filter" className="flex gap-3">
        {[
          ["/admin/inbox", "All"],
          ["/admin/inbox?status=new", "New"],
          ["/admin/inbox?status=in_progress", "In progress"],
          ["/admin/inbox?status=done", "Done"],
          ["/admin/inbox?tab=testimonials", "Testimonials"],
        ].map(([href, label]) => (
          <Link key={href} href={href as string} className="text-primary underline">
            {label}
          </Link>
        ))}
      </nav>
      <details>
        <summary className="cursor-pointer text-muted-foreground">
          Which workspace is our own support?
        </summary>
        <div className="mt-2 space-y-1">
          <p className="text-muted-foreground">
            The workspace with the TriageFox Support Crisp website connected and its automation
            switched on.
          </p>
          <SupportAutomationForm />
        </div>
      </details>
      {items.length === 0 && <p className="text-muted-foreground">Nothing here.</p>}
      {items.map((i) => (
        <article
          key={i.id}
          aria-label={i.title}
          className="space-y-2 rounded border border-border p-3"
        >
          <header className="flex flex-wrap items-baseline gap-2">
            <strong>{CATEGORY[i.category] ?? i.category}</strong>
            {i.priority ? <span>P{i.priority}</span> : null}
            <span>{i.title}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {i.createdAt.toLocaleString()}
            </span>
          </header>
          {i.summary && <p className="whitespace-pre-line text-muted-foreground">{i.summary}</p>}
          <p className="text-xs">
            {i.customerEmail ?? "unknown customer"}{" "}
            {i.customerEmail &&
              (i.identityVerified ? "(verified)" : "(unverified: check before acting)")}
            {i.matchedOrgId ? ` · workspace ${i.matchedOrgId}` : ""}
            {i.crispUrl && (
              <>
                {" · "}
                <a
                  href={i.crispUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Open in Crisp
                </a>
              </>
            )}
          </p>
          {i.notes.length > 0 && (
            <ul className="list-disc pl-5 text-xs">
              {i.notes.map((n) => (
                <li key={n.at}>
                  {n.text}{" "}
                  <span className="text-muted-foreground">
                    ({n.by}, {new Date(n.at).toLocaleString()})
                  </span>
                </li>
              ))}
            </ul>
          )}
          <InboxItemActions id={i.id} status={i.status} testimonial={i.testimonialApproved} />
        </article>
      ))}
    </div>
  );
}

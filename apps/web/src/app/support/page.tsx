import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpButton } from "@/components/app/help-button";
import { ProsePage } from "@/components/site/prose";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { SITE } from "@/lib/site";
import { SupportForm } from "./support-form";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with TriageFox: answers to common questions, and how to reach us.",
  alternates: { canonical: "/support" },
};

/** Only an in-app path is passed on (it tells us which page someone needed help with). */
const appPath = (v: unknown) =>
  typeof v === "string" && /^\/app(\/[\w\-/]*)?$/.test(v) && v.length <= 200 ? v : undefined;

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  // The hosted service's support; a self-hosted copy has no marketing pages.
  if (env().APP_MODE !== "hosted") notFound();
  const session = await getSession().catch(() => null);
  const from = appPath((await searchParams).from);
  const chat = !!env().SUPPORT_CRISP_WEBSITE_ID;

  return (
    <ProsePage
      title="Support"
      intro="Questions, problems, billing or an idea: we read every message and answer by email."
    >
      <h2>Quick answers</h2>
      <ul>
        <li>
          <strong>Setting up:</strong> the{" "}
          <Link href="/integrations/crisp-to-jira">Crisp to Jira</Link> and{" "}
          <Link href="/integrations/crisp-to-trello">Crisp to Trello</Link> guides walk through
          every step.
        </li>
        <li>
          <strong>A chat didn't become a ticket?</strong> Open <strong>Activity</strong> in your
          workspace: every conversation shows what TriageFox decided and why. Unsure ones wait under{" "}
          <strong>Review</strong>.
        </li>
        <li>
          <strong>Ticket in the wrong place, or the wrong labels?</strong> Check{" "}
          <strong>Automation</strong> (where tickets go) and <strong>Connections</strong> (board,
          project and labels).
        </li>
        <li>
          <strong>Invoices, card or plan changes:</strong> <strong>Billing</strong> →{" "}
          <strong>Manage payment</strong>. Refunds are covered in the{" "}
          <Link href="/legal/terms">terms</Link>.
        </li>
        <li>
          <strong>How your data is handled:</strong> see <Link href="/security">Security</Link> and
          the <Link href="/legal/privacy">privacy policy</Link>.
        </li>
      </ul>

      <h2>Write to us</h2>
      {chat && (
        <p className="flex flex-wrap items-center gap-3">
          <span>Prefer to chat?</span>
          <HelpButton label="Chat with us" />
        </p>
      )}
      <Card>
        <SupportForm name={session?.user.name} email={session?.user.email} page={from} />
      </Card>
      <p>
        Or email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> directly. Found a
        security problem? Please write to{" "}
        <a href={`mailto:${SITE.securityEmail}`}>{SITE.securityEmail}</a> instead, not this form.
      </p>
    </ProsePage>
  );
}

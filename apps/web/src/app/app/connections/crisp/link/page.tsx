import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { peekLinkTicket } from "@/lib/crisp-link";
import { requireWorkspace } from "@/lib/workspace";
import { confirmCrispLink } from "./actions";

export const metadata: Metadata = { title: "Link Crisp website" };

export default async function CrispLinkConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  const { workspace, canManage } = await requireWorkspace();
  const { ticket } = await searchParams;
  const row = ticket ? await peekLinkTicket(ticket) : null;

  return (
    <div className="mx-auto max-w-md">
      <Card>
        {!row ? (
          <>
            <h1 className="text-xl font-bold">This link has expired</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Open the TriageFox plugin inside your Crisp inbox and choose “Continue in TriageFox”
              again.
            </p>
            <Link
              href="/app/connections"
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Back to connections
            </Link>
          </>
        ) : !canManage ? (
          <>
            <h1 className="text-xl font-bold">Ask an admin</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Only owners and admins of {workspace.name} can connect tools. Ask one of them to link
              this Crisp website.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Link this Crisp website?</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Crisp website{" "}
              <strong className="text-foreground">{row.websiteName ?? row.websiteId}</strong> will
              be linked to the workspace{" "}
              <strong className="text-foreground">{workspace.name}</strong>. Conversations from this
              website will be read to create tickets once you turn on an automation.
            </p>
            <form action={confirmCrispLink} className="mt-6 flex gap-3">
              <input type="hidden" name="ticket" value={ticket} />
              <Button type="submit" className="flex-1">
                Link to {workspace.name}
              </Button>
              <Link
                href="/app/connections"
                className="inline-flex h-11 items-center rounded-lg border border-input px-5 text-sm font-semibold hover:bg-muted"
              >
                Cancel
              </Link>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

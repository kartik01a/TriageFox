import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { workspace, session, role } = await requireWorkspace();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{workspace.name}</h1>
        <p className="mt-1 text-muted-foreground">
          Welcome, {session.user.name}. You're{" "}
          {role === "owner" ? "the owner" : `a${role === "admin" ? "n admin" : " member"}`} of this
          workspace.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Team</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {workspace.members.length} {workspace.members.length === 1 ? "member" : "members"}
            {workspace.invitations.filter((i) => i.status === "pending").length > 0 &&
              `, ${workspace.invitations.filter((i) => i.status === "pending").length} pending`}
          </p>
          <Link
            href="/app/members"
            className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
          >
            Manage members →
          </Link>
        </Card>
        <Card>
          <h2 className="font-semibold">Connect your tools</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Crisp, Trello and Jira connections arrive in the next release. Your workspace is ready
            for them.
          </p>
        </Card>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/workspace";
import { CancelInvitationButton } from "./cancel-invitation-button";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const { workspace, canManage, session } = await requireWorkspace();
  const pending = workspace.invitations.filter((i) => i.status === "pending");
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <p className="mt-1 text-muted-foreground">People who can access {workspace.name}.</p>
      </div>

      {canManage && (
        <Card>
          <h2 className="font-semibold">Invite a teammate</h2>
          <div className="mt-4">
            <InviteForm organizationId={workspace.id} />
          </div>
        </Card>
      )}

      <section aria-labelledby="members-title">
        <h2 id="members-title" className="mb-3 font-semibold">
          Members ({workspace.members.length})
        </h2>
        <Card className="divide-y divide-border p-0">
          {workspace.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {m.user.name}{" "}
                  {m.userId === session.user.id && (
                    <span className="text-muted-foreground">(you)</span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">{m.user.email}</p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold capitalize">
                {m.role}
              </span>
            </div>
          ))}
        </Card>
      </section>

      {pending.length > 0 && (
        <section aria-labelledby="pending-title">
          <h2 id="pending-title" className="mb-3 font-semibold">
            Pending invitations ({pending.length})
          </h2>
          <Card className="divide-y divide-border p-0">
            {pending.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Invited as {i.role} · expires{" "}
                    {new Date(i.expiresAt).toLocaleDateString("en", { dateStyle: "medium" })}
                  </p>
                </div>
                {canManage && <CancelInvitationButton invitationId={i.id} />}
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

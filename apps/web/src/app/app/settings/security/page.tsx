import { and, desc, eq, gt, schema, withOrg } from "@triagefox/db";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { Require2faSwitch, SessionList, SetPasswordPanel, TwoFactorPanel } from "./security-panels";

export const metadata: Metadata = { title: "Security" };

const ACTIONS: Record<string, string> = {
  "workspace.created": "Created the workspace",
  "member.invited": "Invited a member",
  "invitation.accepted": "Accepted an invitation",
  "connection.removed": "Disconnected a tool",
  "connection.targets_updated": "Changed a board or project",
  "ai_key.replaced": "Replaced the OpenAI key",
  "ai_key.removed": "Removed the OpenAI key",
  "automation.ready": "Created the automation",
  "automation.enabled": "Turned the automation on",
  "automation.paused": "Paused the automation",
  "automation.settings_changed": "Changed ticket settings",
  "destination.enabled": "Turned a destination on",
  "destination.disabled": "Turned a destination off",
  "review.approved": "Approved a ticket from review",
  "review.dismissed": "Dismissed a ticket from review",
  "security.require_2fa_on": "Required two-factor sign-in",
  "security.require_2fa_off": "No longer requires two-factor sign-in",
};

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ required?: string }>;
}) {
  const { workspace, role, canManage, require2fa, session } = await requireWorkspace({
    allowWithoutTwoFactor: true,
  });
  const { required } = await searchParams;
  const [credential] = await db()
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(
      and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "credential")),
    )
    .limit(1);
  // Read the person's own sessions directly: Better Auth's list endpoint insists on a sign-in from the last
  // 15 minutes, which made this whole page fail for anyone who had been signed in for a while.
  const sessions = await db()
    .select({
      token: schema.session.token,
      userAgent: schema.session.userAgent,
      ipAddress: schema.session.ipAddress,
      createdAt: schema.session.createdAt,
    })
    .from(schema.session)
    .where(
      and(eq(schema.session.userId, session.user.id), gt(schema.session.expiresAt, new Date())),
    )
    .orderBy(desc(schema.session.createdAt));
  const audit = canManage
    ? await withOrg(db(), workspace.id, (tx) =>
        tx
          .select({
            id: schema.auditLog.id,
            action: schema.auditLog.action,
            at: schema.auditLog.createdAt,
            actor: schema.user.name,
          })
          .from(schema.auditLog)
          .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorUserId))
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(40),
      )
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="mt-1 text-muted-foreground">Protect your account and see what has changed.</p>
      </div>

      {required && (
        <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          This workspace requires two-factor sign-in. Turn it on below to continue.
        </p>
      )}

      <section aria-labelledby="2fa" className="space-y-3">
        <h2 id="2fa" className="font-semibold">
          Two-factor sign-in
        </h2>
        <Card>
          {credential ? (
            <TwoFactorPanel enabled={session.user.twoFactorEnabled === true} />
          ) : (
            <SetPasswordPanel />
          )}
        </Card>
      </section>

      {role === "owner" && (
        <section aria-labelledby="req" className="space-y-3">
          <h2 id="req" className="font-semibold">
            Workspace rule
          </h2>
          <Card>
            <Require2faSwitch initial={require2fa} />
          </Card>
        </section>
      )}

      <section aria-labelledby="sessions" className="space-y-3">
        <h2 id="sessions" className="font-semibold">
          Where you're signed in
        </h2>
        <Card>
          <SessionList
            currentToken={session.session.token}
            sessions={sessions.map((s) => ({
              token: s.token,
              userAgent: s.userAgent ?? "Unknown device",
              ip: s.ipAddress ?? "",
              createdAt: new Date(s.createdAt).toISOString(),
            }))}
          />
        </Card>
      </section>

      {canManage && (
        <section aria-labelledby="audit" className="space-y-3">
          <h2 id="audit" className="font-semibold">
            Audit log
          </h2>
          <Card className="divide-y divide-border p-0">
            {audit.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              audit.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
                >
                  <span>
                    <strong className="font-medium">{a.actor ?? "System"}</strong>{" "}
                    {(ACTIONS[a.action] ?? a.action).toLowerCase()}
                  </span>
                  <time className="text-xs text-muted-foreground" dateTime={a.at.toISOString()}>
                    {a.at.toLocaleString()}
                  </time>
                </div>
              ))
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

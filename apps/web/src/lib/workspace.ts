import "server-only";
import { eq, schema, withOrg } from "@triagefox/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { db } from "./db";
import { getSession } from "./session";

export type Role = "owner" | "admin" | "member";

/**
 * The signed-in user's current workspace, or null (signed out / no workspace). For API routes.
 * Role comes from the member list of the active workspace, never from client input.
 */
export async function resolveWorkspace() {
  const session = await getSession();
  if (!session) return null;
  const h = await headers();
  const orgs = await getAuth().api.listOrganizations({ headers: h });
  const activeId = session.session.activeOrganizationId;
  const org = orgs.find((o) => o.id === activeId) ?? orgs[0];
  if (!org) return null;
  const full = await getAuth().api.getFullOrganization({
    headers: h,
    query: { organizationId: org.id },
  });
  if (!full) return null;
  const me = full.members.find((m) => m.userId === session.user.id);
  const role = (me?.role ?? "member") as Role;
  const [settings] = await withOrg(db(), org.id, (tx) =>
    tx.select().from(schema.workspaceSettings).where(eq(schema.workspaceSettings.orgId, org.id)),
  );
  const require2fa = settings?.require2fa ?? false;
  const twoFactorOk = !require2fa || session.user.twoFactorEnabled === true;
  return {
    session,
    workspace: full,
    role,
    canManage: role === "owner" || role === "admin",
    require2fa,
    twoFactorOk,
  };
}

/** For pages under /app: redirects to sign-in or onboarding when needed. */
export async function requireWorkspace(opts: { allowWithoutTwoFactor?: boolean } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const ctx = await resolveWorkspace();
  if (!ctx) redirect("/app/onboarding");
  // The workspace requires two-factor sign-in: everything except the page that sets it up is closed.
  if (!ctx.twoFactorOk && !opts.allowWithoutTwoFactor)
    redirect("/app/settings/security?required=1");
  return ctx;
}

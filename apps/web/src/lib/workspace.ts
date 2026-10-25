import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
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
  return { session, workspace: full, role, canManage: role === "owner" || role === "admin" };
}

/** For pages under /app: redirects to sign-in or onboarding when needed. */
export async function requireWorkspace() {
  const session = await getSession();
  if (!session) redirect("/login");
  const ctx = await resolveWorkspace();
  if (!ctx) redirect("/app/onboarding");
  return ctx;
}

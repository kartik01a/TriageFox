import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { requireSession } from "./session";

export type Role = "owner" | "admin" | "member";

/**
 * The signed-in user's current workspace. Redirects to onboarding when they have none.
 * Role comes from the member list of the active workspace, never from client input.
 */
export async function requireWorkspace() {
  const session = await requireSession();
  const h = await headers();
  const orgs = await getAuth().api.listOrganizations({ headers: h });
  if (orgs.length === 0) redirect("/app/onboarding");
  const activeId = session.session.activeOrganizationId;
  const org = orgs.find((o) => o.id === activeId) ?? orgs[0];
  if (!org) redirect("/app/onboarding");
  const full = await getAuth().api.getFullOrganization({
    headers: h,
    query: { organizationId: org.id },
  });
  if (!full) redirect("/app/onboarding");
  const me = full.members.find((m) => m.userId === session.user.id);
  const role = (me?.role ?? "member") as Role;
  return { session, workspace: full, role, canManage: role === "owner" || role === "admin" };
}

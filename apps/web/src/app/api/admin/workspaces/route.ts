import { adminGuard } from "@/lib/admin";
import { listWorkspaces } from "@/lib/admin-data";
import { json } from "@/lib/guards";

/** Search workspaces (newest first, 25 at a time) with plan and usage. */
export async function GET(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  return json({
    ok: true,
    workspaces: await listWorkspaces(new URL(req.url).searchParams.get("q")),
  });
}

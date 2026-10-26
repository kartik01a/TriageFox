import { adminGuard } from "@/lib/admin";
import { usageReport } from "@/lib/admin-data";
import { json } from "@/lib/guards";

/** Platform AI spend this month (all, and trials) and the workspaces that cost the most. */
export async function GET(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  return json({ ok: true, ...(await usageReport()) });
}

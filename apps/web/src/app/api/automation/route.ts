import { ensureAutomation, syncDestinations } from "@/lib/automations";
import { audit } from "@/lib/connections";
import { json, managerGuard } from "@/lib/guards";

/** Creates the workspace's (paused) automation on its Crisp connection and picks up connected destinations. */
export async function POST(req: Request) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.workspace.id;
  const automation = await ensureAutomation(orgId);
  if (!automation) return json({ ok: false, error: "Connect Crisp first." }, 400);
  await syncDestinations(orgId, automation.id);
  await audit({
    orgId,
    actorUserId: guard.ctx.session.user.id,
    action: "automation.ready",
    target: automation.id,
  });
  return json({ ok: true, id: automation.id });
}

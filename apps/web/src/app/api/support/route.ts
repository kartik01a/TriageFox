import { env } from "@/lib/env";
import { json, sameOrigin } from "@/lib/guards";
import { ipFromHeaders } from "@/lib/ip";
import { allowRequest, tooMany } from "@/lib/limits";
import { logger } from "@/lib/logger";
import { sendMail } from "@/lib/mailer";
import { getSession } from "@/lib/session";
import { SITE } from "@/lib/site";
import { supportEmail, supportMessage } from "@/lib/support";

/**
 * The public support form: emails the message to our support inbox, with Reply going to the sender.
 * Nothing is stored. No confirmation email is sent to the address typed in, so the form cannot be
 * used to send mail to strangers.
 */
export async function POST(req: Request) {
  // Hosted only: a self-hosted copy must never send its users' messages to our inbox.
  if (env().APP_MODE !== "hosted") return json({ ok: false, error: "Not found." }, 404);
  if (!sameOrigin(req)) return json({ ok: false, error: "Bad request origin." }, 403);
  // A person writes a handful of messages; a script hammering the form is cut off (and all of them
  // together are capped, so a flood from many addresses cannot fill the inbox).
  const ip = ipFromHeaders(req.headers);
  if (!(await allowRequest(`support:ip:${ip}`, 5, 3600))) return tooMany();
  if (!(await allowRequest("support:all", 200, 86_400))) return tooMany();

  const parsed = supportMessage.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." },
      400,
    );
  // The hidden field was filled in: a bot. Answer as if it worked, so it learns nothing.
  if (parsed.data.website) return json({ ok: true });

  const session = await getSession().catch(() => null);
  const sender = session
    ? {
        userId: session.user.id,
        accountEmail: session.user.email,
        workspaceId: session.session.activeOrganizationId ?? null,
      }
    : null;

  try {
    await sendMail({ to: SITE.contactEmail, ...supportEmail(parsed.data, sender) });
  } catch {
    return json(
      {
        ok: false,
        error: `We couldn't send that just now. Please email ${SITE.contactEmail} instead.`,
      },
      503,
    );
  }
  // The message itself is never logged.
  logger.info({ topic: parsed.data.topic, signedIn: !!sender }, "support message sent");
  return json({ ok: true });
}

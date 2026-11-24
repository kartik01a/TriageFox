import { and, type Db, eq, inArray, schema } from "@triagefox/db";
import { createMailer, emailLayout } from "@triagefox/mail";
import type { WorkerEnv } from "@triagefox/shared";
import type { Redis } from "ioredis";
import type { PipelineLogger } from "./pipeline/deps";

type Config = Pick<
  WorkerEnv,
  | "APP_URL"
  | "SMTP_HOST"
  | "SMTP_PORT"
  | "SMTP_USER"
  | "SMTP_PASSWORD"
  | "SMTP_SECURE"
  | "MAIL_FROM"
  | "ALERT_EMAIL"
  | "SLACK_ALERTS_WEBHOOK_URL"
>;

export interface Notifier {
  /** Email every owner of a workspace. Failures are logged, never thrown: a notice must not break a pipeline step. */
  emailOwners(
    orgId: string,
    mail: { subject: string; heading: string; body: string; cta?: { label: string; path: string } },
  ): Promise<void>;
  /** Urgent platform alert: email to ALERT_EMAIL and a Slack message, whichever are configured. */
  alert(a: {
    subject: string;
    text: string;
    dedupeKey?: string;
    dedupeSeconds?: number;
  }): Promise<void>;
}

export function createNotifier(deps: {
  db: Db;
  config: Config;
  log: PipelineLogger;
  fetch?: typeof fetch;
  /** With a Redis connection, alerts that carry a dedupeKey are sent at most once per dedupeSeconds. */
  redis?: Redis;
  send?: (mail: { to: string; subject: string; text: string; html: string }) => Promise<void>;
}): Notifier {
  const { config, log } = deps;
  const mailer = config.SMTP_HOST
    ? createMailer(
        {
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          user: config.SMTP_USER,
          password: config.SMTP_PASSWORD,
          from: config.MAIL_FROM,
        },
        (err, subject) => log.error({ err: err.message, subject }, "email delivery failed"),
      )
    : null;
  const send = deps.send ?? mailer?.send.bind(mailer);

  async function mail(to: string, subject: string, layout: Parameters<typeof emailLayout>[0]) {
    if (!send) return log.warn({ subject }, "email not sent: SMTP is not configured");
    const { html, text } = emailLayout(layout);
    try {
      await send({ to, subject, html, text });
    } catch {
      /* already logged by the mailer */
    }
  }

  return {
    async emailOwners(orgId, m) {
      const rows = await deps.db
        .select({ email: schema.user.email })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(
          and(eq(schema.member.organizationId, orgId), inArray(schema.member.role, ["owner"])),
        );
      for (const r of rows)
        await mail(r.email, m.subject, {
          heading: m.heading,
          body: m.body,
          cta: m.cta ? { label: m.cta.label, url: `${config.APP_URL}${m.cta.path}` } : undefined,
        });
    },
    async alert(a) {
      if (a.dedupeKey && deps.redis) {
        const first = await deps.redis.set(
          `alert:${a.dedupeKey}`,
          "1",
          "EX",
          a.dedupeSeconds ?? 3600,
          "NX",
        );
        if (first === null) return;
      }
      if (config.ALERT_EMAIL)
        await mail(config.ALERT_EMAIL, a.subject, { heading: a.subject, body: a.text });
      if (config.SLACK_ALERTS_WEBHOOK_URL) {
        try {
          await (deps.fetch ?? fetch)(config.SLACK_ALERTS_WEBHOOK_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: `*${a.subject}*\n${a.text}` }),
            signal: AbortSignal.timeout(10_000),
          });
        } catch (err) {
          log.warn({ err: (err as Error).message }, "slack alert failed");
        }
      }
      if (!config.ALERT_EMAIL && !config.SLACK_ALERTS_WEBHOOK_URL)
        log.warn(
          { subject: a.subject },
          "alert not sent: ALERT_EMAIL and SLACK_ALERTS_WEBHOOK_URL are not set",
        );
    },
  };
}

const PROVIDER_NAMES: Record<string, string> = {
  crisp: "Crisp",
  trello: "Trello",
  jira: "Jira",
  linear: "Linear",
};

/** The email a workspace owner gets when a connection stops working, with what to do about it. */
export function revokedNotice(provider: string) {
  const name = PROVIDER_NAMES[provider] ?? provider;
  return {
    subject: `${name} needs to be reconnected`,
    heading: `${name} stopped accepting TriageFox`,
    body:
      provider === "crisp"
        ? "TriageFox can no longer read your Crisp conversations (the plugin may have been uninstalled). New chats are not being analysed until you reinstall the plugin and link the website again."
        : `${name} no longer accepts the access TriageFox was given (it may have been revoked). Tickets are paused: nothing is lost, they are kept and the ones that did not arrive can be sent again.\n\nReconnect ${name} on the Connections page, then press “Try all again” on the Automation page.`,
    cta: { label: "Reconnect", path: "/app/connections" },
  };
}

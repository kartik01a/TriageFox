import "server-only";
import { createMailer, emailLayout } from "@triagefox/mail";
import { env } from "./env";
import { logger } from "./logger";

export { emailLayout };

let mailer: ReturnType<typeof createMailer> | undefined;

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}) {
  const e = env();
  mailer ??= createMailer(
    {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      from: e.MAIL_FROM,
    },
    (err, subject) => logger.error({ err: err.message, subject }, "email delivery failed"),
  );
  await mailer.send(input);
}

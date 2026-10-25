import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { logger } from "./logger";

let transport: Transporter | undefined;

function getTransport() {
  const e = env();
  transport ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

export async function sendMail(input: { to: string; subject: string; text: string; html: string }) {
  try {
    await getTransport().sendMail({ from: env().MAIL_FROM, ...input });
  } catch (err) {
    // Never include the message body or link in logs: they contain one-time tokens.
    logger.error({ err: (err as Error).message, subject: input.subject }, "email delivery failed");
    throw err;
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Minimal, accessible transactional email layout. */
export function emailLayout(opts: {
  heading: string;
  body: string;
  cta: { label: string; url: string };
}) {
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:Inter,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:#f26b1d">TriageFox</td></tr>
<tr><td style="padding-top:16px;font-size:18px;font-weight:600">${esc(opts.heading)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6">${esc(opts.body)}</td></tr>
<tr><td style="padding-top:24px"><a href="${esc(opts.cta.url)}" style="background:#f26b1d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(opts.cta.label)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#71717a">If the button doesn't work, copy this link: ${esc(opts.cta.url)}<br/>If you didn't expect this email, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.cta.label}: ${opts.cta.url}\n\nIf you didn't expect this email, you can ignore it.`;
  return { html, text };
}

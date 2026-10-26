import nodemailer, { type Transporter } from "nodemailer";

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** SMTP sender shared by the web app and the worker. */
export function createMailer(config: MailConfig, onError?: (err: Error, subject: string) => void) {
  let transport: Transporter | undefined;
  const get = () =>
    (transport ??= nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    }));
  return {
    async send(mail: Mail) {
      try {
        await get().sendMail({ from: config.from, ...mail });
      } catch (err) {
        // Never log the body or any link: they can contain one-time tokens.
        onError?.(err as Error, mail.subject);
        throw err;
      }
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Minimal, accessible transactional email layout. The call-to-action is optional. */
export function emailLayout(opts: {
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
}) {
  const cta = opts.cta
    ? `<tr><td style="padding-top:24px"><a href="${esc(opts.cta.url)}" style="background:#f26b1d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(opts.cta.label)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#71717a">If the button doesn't work, copy this link: ${esc(opts.cta.url)}<br/>${esc(opts.footer ?? "If you didn't expect this email, you can ignore it.")}</td></tr>`
    : `<tr><td style="padding-top:24px;font-size:12px;color:#71717a">${esc(opts.footer ?? "")}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f7;font-family:Inter,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:#f26b1d">TriageFox</td></tr>
<tr><td style="padding-top:16px;font-size:18px;font-weight:600">${esc(opts.heading)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;white-space:pre-line">${esc(opts.body)}</td></tr>
${cta}
</table></td></tr></table></body></html>`;
  const text = `${opts.heading}\n\n${opts.body}${opts.cta ? `\n\n${opts.cta.label}: ${opts.cta.url}` : ""}\n\n${opts.footer ?? "If you didn't expect this email, you can ignore it."}`;
  return { html, text };
}

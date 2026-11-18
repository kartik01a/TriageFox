import { emailLayout } from "@triagefox/mail";
import { z } from "zod";

import { SUPPORT_TOPICS, type SupportTopic } from "./support-topics";

export { SUPPORT_TOPICS };

// Line breaks and other control characters are refused in one-line fields (they could reshape headers).
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Please use a single line.");

export const supportMessage = z.object({
  name: oneLine(100).pipe(z.string().min(1, "Please tell us your name.")),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Please enter a valid email address.").max(254)),
  topic: z.enum(Object.keys(SUPPORT_TOPICS) as [SupportTopic, ...SupportTopic[]]),
  message: z
    .string()
    .trim()
    .min(10, "Please describe it in a few more words.")
    .max(5000, "Please keep it under 5,000 characters."),
  /** Optional: the page or workspace it is about. */
  page: oneLine(300).optional(),
  /** A field people never see. Bots fill it in; real messages leave it empty. */
  website: z.string().max(500).optional(),
});
export type SupportMessage = z.infer<typeof supportMessage>;

/** Who wrote, when they were signed in. Taken from the session on the server, never from the form. */
export interface SupportSender {
  userId: string;
  accountEmail: string;
  workspaceId?: string | null;
}

/** The email sent to our support inbox. Reply goes straight to the person who wrote. */
export function supportEmail(m: SupportMessage, sender?: SupportSender | null) {
  const topic = SUPPORT_TOPICS[m.topic];
  const lines = [
    `From: ${m.name} <${m.email}>`,
    `Topic: ${topic}`,
    m.page ? `About: ${m.page}` : null,
    sender
      ? `Signed in as: ${sender.accountEmail} (user ${sender.userId}${sender.workspaceId ? `, workspace ${sender.workspaceId}` : ""})`
      : "Not signed in: the email address is unverified. Check before acting on account or billing requests.",
    sender && sender.accountEmail !== m.email
      ? "Note: the reply address differs from the signed-in account."
      : null,
    "",
    m.message,
  ].filter((l) => l !== null);
  const text = lines.join("\n");
  return {
    subject: `Support: ${topic}`,
    replyTo: m.email,
    text,
    html: emailLayout({
      heading: `Support: ${topic}`,
      body: text,
      footer: "Sent from the support form on triagefox.com. Reply to answer the sender.",
    }).html,
  };
}

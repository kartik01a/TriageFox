/** What people can write to us about (shared by the support form and the server). The subject line is
 * built only from these fixed labels. No server code here: the browser imports this file. */
export const SUPPORT_TOPICS = {
  question: "A question",
  problem: "Something isn't working",
  billing: "Billing or a refund",
  account: "Signing in or my account",
  idea: "An idea or a feature request",
  other: "Something else",
} as const;
export type SupportTopic = keyof typeof SUPPORT_TOPICS;

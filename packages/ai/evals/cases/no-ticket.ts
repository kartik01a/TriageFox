import { c, none, ticket } from "../build";

/** Conversations where support can handle everything in chat: no engineering ticket. */
export const smallTalk = [
  c("hello", ["smalltalk"], ["C: hi"], none("greeting")),
  c("anyone-there", ["smalltalk"], ["C: hello? is anyone there?"], none("greeting")),
  c(
    "thanks-nevermind",
    ["smalltalk"],
    ["C: Hey, quick question", "O: Sure, go ahead!", "C: nevermind, found it. Thanks!"],
    none(["greeting", "question"]),
  ),
  c(
    "opener-no-detail",
    ["smalltalk", "vague"],
    ["C: Hi, I'm having a problem with my account"],
    none(["account", "question", "greeting"]),
    { note: "An opener with no concrete problem: wait for more." },
  ),
  c(
    "spam-seo",
    ["spam"],
    [
      "C: Hello dear, I can boost your website SEO ranking to #1 on Google in 7 days! Reply for our packages.",
    ],
    none("spam"),
  ),
  c("spam-gibberish", ["spam"], ["C: asdkjh qwe 123123 ??? lol"], none(["spam", "greeting"])),
  c(
    "praise-dashboard",
    ["praise"],
    ["C: Just wanted to say I love the new dashboard, great work team!"],
    none("praise"),
  ),
  c(
    "praise-support",
    ["praise"],
    ["C: Your support team is amazing. Thanks for sorting out my issue so quickly last week."],
    none("praise"),
  ),
  c(
    "thanks-after-help",
    ["smalltalk"],
    [
      "C: How do I change my profile picture?",
      "O: Go to Settings > Profile and click your avatar.",
      "C: Found it, thank you so much!",
    ],
    none(["question", "praise"]),
  ),
];

export const supportQuestions = [
  c(
    "howto-invite",
    ["howto"],
    ["C: How do I invite a teammate to my workspace?"],
    none("question"),
  ),
  c(
    "howto-invoice",
    ["howto"],
    ["C: Where can I download my invoices?", "O: Settings > Billing > Invoices.", "C: Got it"],
    none(["question", "billing"]),
  ),
  c(
    "howto-language",
    ["howto"],
    [
      "C: Is there a way to change the interface language to French?",
      "O: Yes, Settings > Preferences > Language.",
    ],
    none("question"),
  ),
  c(
    "howto-integration",
    ["howto"],
    ["C: how do i connect my account to slack? i can't find the option"],
    none("question"),
    {
      note: "Ambiguous between how-to and feature request; the product has a Slack integration in the help center.",
    },
  ),
  c(
    "password-forgot",
    ["account"],
    ["C: I forgot my password, how do I reset it?"],
    none(["account", "question"]),
  ),
  c(
    "update-email",
    ["account"],
    [
      "C: Can you change the email on my account to anna@example.com?",
      "O: Done, you can use the new address now.",
    ],
    none("account"),
  ),
  c(
    "cancel-subscription",
    ["billing"],
    ["C: I want to cancel my subscription at the end of this month."],
    none(["billing", "account"]),
  ),
  c(
    "refund-request",
    ["billing", "refund"],
    ["C: I was charged yesterday but I don't need the product anymore. Can I get a refund?"],
    none(["refund_request", "billing"]),
  ),
  c(
    "invoice-request",
    ["billing"],
    ["C: Could you send me a copy of the invoice for September with our VAT number on it?"],
    none(["billing", "account"]),
  ),
  c(
    "change-plan",
    ["billing"],
    ["C: What's the difference between the Pro and Business plans? We have 12 people."],
    none(["billing", "question"]),
  ),
  c(
    "complaint-price",
    ["complaint"],
    [
      "C: Honestly your pricing went up again. It's getting too expensive for a small team like ours.",
    ],
    none("complaint"),
  ),
  c(
    "complaint-slow-support",
    ["complaint"],
    ["C: I waited 3 days for an answer to my last email. That's really disappointing."],
    none("complaint"),
  ),
  c(
    "limit-raised-by-support",
    ["resolved"],
    [
      "C: I can't upload files bigger than 10MB.",
      "O: I've raised your limit to 50MB from the admin panel, please try again.",
      "C: Works now, thanks!",
    ],
    none(["question", "account", "complaint"]),
    { state: "resolved", note: "Fixed by support with an admin setting, no engineering work." },
  ),
];

/** Fixed in the conversation without a code change. */
export const resolvedInChat = [
  c(
    "cache-fixed",
    ["resolved"],
    [
      "C: The dashboard page won't load for me, just a white screen.",
      "O: Please clear your browser cache and do a hard reload (Ctrl+Shift+R).",
      "C: That fixed it, thanks!",
    ],
    none(["question", "complaint"]),
    { state: "resolved" },
  ),
  c(
    "wrong-email-login",
    ["resolved"],
    [
      "C: I can't log in, it says the account doesn't exist.",
      "O: You signed up with your .org address, not .com. Try that one.",
      "C: Oh! That's it. Sorry about that.",
    ],
    none(["account", "question"]),
    { state: "resolved" },
  ),
  c(
    "export-filter",
    ["resolved"],
    [
      "C: My export is empty!",
      "O: You have a date filter set to last week. Remove it and export again.",
      "C: Oh yes, works now. Thanks.",
    ],
    none(["question", "complaint"]),
    { state: "resolved" },
  ),
  c(
    "notifications-default-off",
    ["resolved"],
    [
      "C: I'm not getting any notifications.",
      "O: They are off by default. Enable them under Settings > Notifications.",
      "C: Found it, thanks!",
    ],
    none(["question", "account"]),
    { state: "resolved" },
  ),
  c(
    "known-bug-promised",
    ["resolved", "known-bug"],
    [
      "C: Exporting a project with more than 5000 rows crashes.",
      "O: Yes, that's a known bug. A fix is planned for the next release. Meanwhile split the export into two.",
      "C: ok, thanks",
    ],
    ticket("bug", 3),
    {
      state: "resolved",
      note: "Resolved for now, but the bug remains: engineering still needs a ticket.",
    },
  ),
  c(
    "dark-theme-bug-acknowledged",
    ["resolved", "known-bug"],
    [
      "C: In dark mode the text in Settings is dark grey on black, I can't read it.",
      "O: You're right, that's a bug in our dark theme. We'll fix it.",
      "C: ok thanks",
    ],
    ticket("ui_ux", 2),
    { state: "resolved" },
  ),
];

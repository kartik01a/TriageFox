import { c, none, ticket } from "../build";

export const mixed = [
  c(
    "mix-question-and-bug",
    ["mixed"],
    [
      "C: How do I export all my data? Also the export button is greyed out on Firefox, I had to switch to Chrome.",
    ],
    ticket("bug", 2, { creates: 1 }),
    { note: "The how-to is for support; the greyed-out button is a bug." },
  ),
  c(
    "mix-two-bugs",
    ["mixed"],
    [
      "C: Two things: 1) the invoice PDF shows the wrong company logo, 2) the calendar never shows Sundays.",
    ],
    ticket(["bug", "ui_ux", "data"], 2, { creates: 2 }),
  ),
  c(
    "mix-praise-and-feature",
    ["mixed"],
    ["C: Love the app! It would be amazing if you could add recurring tasks."],
    ticket("feature", 2, { creates: 1 }),
  ),
  c(
    "mix-billing-and-bug",
    ["mixed"],
    [
      "C: I paid for the Pro plan but my account still says Free. When I click Upgrade the page shows an error and nothing happens.",
    ],
    ticket("bug", 4, { creates: 1 }),
  ),
  c(
    "mix-howto-then-feature",
    ["mixed"],
    [
      "C: How do I filter by date?",
      "O: Use the filter icon at the top of the list.",
      "C: Ah I see. But can I filter by a date range instead of a single date?",
      "O: Not currently, only single dates.",
      "C: That would be great to have.",
    ],
    ticket("feature", 2, { creates: 1 }),
  ),
  c(
    "mix-complaint-and-bug",
    ["mixed"],
    [
      "C: Your support took forever to reply last time. Anyway, the mobile menu doesn't open on my Samsung tablet.",
    ],
    ticket("bug", 3, { creates: 1 }),
  ),
];

export const vague = [
  c(
    "vague-doesnt-work",
    ["vague"],
    ["C: it doesn't work"],
    none(["question", "complaint", "greeting"]),
    { note: "No detail at all: ask for more." },
  ),
  c("vague-terrible-site", ["vague"], ["C: your website is terrible"], none("complaint")),
  c(
    "vague-account-wrong",
    ["vague"],
    ["C: something is wrong with my account"],
    none(["account", "question"]),
  ),
];

/** Long conversations. */
export const long = [
  c(
    "long-troubleshoot-to-bug",
    ["long", "bug"],
    [
      "C: I can't see my invoices",
      "O: Hi! Which page are you on?",
      "C: Billing > Invoices, it's empty",
      "O: Do you have the right workspace selected top left?",
      "C: yes, Acme",
      "O: Could you try another browser?",
      "C: Tried Firefox and Chrome, same thing",
      "O: Please log out and in again",
      "C: Done, still empty. But I can download them from the email you sent",
      "O: Do you see the invoices if you click 'Show all years'?",
      "C: No. 'No invoices found' for every year",
      "O: Thanks. I checked and they exist on our side for your workspace.",
      "O: This looks like a bug in the Invoices page. I'll create a report for the developers.",
      "C: Ok, please let me know",
    ],
    ticket("bug", 3),
  ),
  c(
    "long-chitchat-to-howto",
    ["long"],
    [
      "C: Hi there!",
      "O: Hello! How can I help?",
      "C: Oh nothing special, just exploring",
      "O: Sure, take your time.",
      "C: Nice product btw, my colleague recommended it",
      "O: Great to hear! Who's your colleague?",
      "C: Sarah from the design team",
      "O: Oh, Sarah is wonderful.",
      "C: She is! I'm actually new here, started last Monday",
      "O: Welcome to the team then!",
      "C: Thanks :) ok so one question, how do I share a board with someone outside my company?",
      "O: Open the board, click Share, and choose 'Anyone with the link'.",
      "C: Perfect, that's all. Thanks!",
    ],
    none(["question", "praise", "greeting"]),
  ),
];

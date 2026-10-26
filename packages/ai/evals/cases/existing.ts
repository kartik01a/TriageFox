import { c, none, ticket } from "../build";

const checkout = {
  id: "iss_1",
  title: "Checkout button unresponsive on Safari",
  summary: "The Pay button on the checkout page does nothing on Safari desktop.",
  priority: 4 as const,
};
const csv = {
  id: "iss_7",
  title: "CSV export produces an empty file",
  summary: "Exporting orders to CSV gives a file with only headers, no rows.",
  priority: 3 as const,
};

/** Conversations with tickets already created from them, or similar tickets from other conversations. */
export const existing = [
  c(
    "exist-update-new-info",
    ["existing"],
    [
      "C: The Pay button on checkout does nothing on Safari.",
      "O: Thanks, I've reported it.",
      "C: Update: it also fails on Safari on iPad, and in Chrome on iPhone. Only Chrome on desktop works.",
    ],
    { positive: true, kind: "update", issueId: "iss_1" },
    {
      existingIssues: [checkout],
      note: "New information about a problem that already has a ticket.",
    },
  ),
  c(
    "exist-thanks-only",
    ["existing"],
    [
      "C: The Pay button on checkout does nothing on Safari.",
      "O: Thanks, I've reported it to the developers.",
      "C: Great, thanks for the quick reply!",
    ],
    none(["praise", "question", "greeting"], { kind: "no_action" }),
    { existingIssues: [checkout], note: "Nothing new to add: no action." },
  ),
  c(
    "exist-new-distinct-bug",
    ["existing"],
    [
      "C: The Pay button on checkout does nothing on Safari.",
      "O: Thanks, I've reported it.",
      "C: Unrelated, but uploading a profile photo also fails with 'file too large' even for tiny images.",
    ],
    ticket("bug", 2, { creates: 1 }),
    {
      existingIssues: [checkout],
      note: "A second, unrelated problem is a new ticket, not an update.",
    },
  ),
  c(
    "exist-escalation-update",
    ["existing"],
    [
      "C: The login page is a bit slow, takes like 8 seconds.",
      "O: Noted, I've passed it on.",
      "C: It's now timing out completely and nobody on my team can log in at all.",
    ],
    { positive: true, kind: "update", issueId: "iss_2" },
    {
      existingIssues: [
        {
          id: "iss_2",
          title: "Login page loads slowly",
          summary: "The login page takes around 8 seconds to load.",
          priority: 2,
        },
      ],
      note: "The same problem got much worse: update the existing ticket.",
    },
  ),
  c(
    "dup-same-problem",
    ["duplicate"],
    ["C: My CSV export is empty, only the header row. I have a lot of orders."],
    { positive: true, kind: "duplicate_of", issueId: "iss_7" },
    {
      duplicateCandidates: [csv],
      note: "Same root problem as an open ticket from another customer.",
    },
  ),
  c(
    "dup-same-area-different-problem",
    ["duplicate"],
    ["C: The CSV export works but it's super slow, 5 minutes for 2000 rows."],
    ticket("performance", 3, { creates: 1 }),
    { duplicateCandidates: [csv], note: "Same feature, different problem: not a duplicate." },
  ),
  c(
    "dup-unrelated-candidates",
    ["duplicate"],
    ["C: The 'Forgot password' link on the login page does nothing when I click it."],
    ticket("bug", 3, { creates: 1 }),
    { duplicateCandidates: [csv, checkout] },
  ),
  c(
    "dup-reworded",
    ["duplicate"],
    ["C: I download my orders as CSV and it's blank, nothing inside except the column names."],
    { positive: true, kind: "duplicate_of", issueId: "iss_7" },
    { duplicateCandidates: [csv, checkout], note: "Same problem in different words." },
  ),
];

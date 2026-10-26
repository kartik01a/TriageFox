import { c, ticket } from "../build";

/** Same kinds of problems told with very different tone and scale: priority must follow impact. */
export const priority = [
  c(
    "prio-angry-typo",
    ["priority"],
    [
      "C: THIS IS UNACCEPTABLE!! There's a typo on your pricing page: 'Recieve' instead of 'Receive'. I can't believe it. Fix it NOW!!!",
    ],
    ticket("ui_ux", 1),
  ),
  c(
    "prio-polite-outage",
    ["priority"],
    [
      "C: Hi, sorry to bother you, but none of our 300 employees have been able to log in since this morning. We just get a blank page.",
    ],
    ticket(["bug", "infra"], 5),
  ),
  c(
    "prio-urgent-trivial-feature",
    ["priority"],
    ["C: URGENT!!! PLEASE ADD AN OPTION TO CHANGE THE SIDEBAR COLOR!!! I NEED THIS TODAY!!!"],
    ticket(["feature", "improvement"], 1),
  ),
  c(
    "prio-data-loss",
    ["priority"],
    ["C: My whole project is gone! All 3 years of work disappeared right after I clicked Save."],
    ticket("data", 5),
  ),
  c(
    "prio-login-workaround",
    ["priority"],
    ["C: Login with Google gives an error, but email and password work fine."],
    ticket("bug", 2),
  ),
  c(
    "prio-team-blocked",
    ["priority"],
    [
      "C: Our whole support team (30 people) gets an error when opening tickets since the update. We can't answer customers.",
    ],
    ticket("bug", 5),
  ),
  c(
    "prio-payments-broken",
    ["priority"],
    [
      "C: Our customers say card payments fail with 'something went wrong' on the checkout you power for us. We're losing sales right now.",
    ],
    ticket("bug", 5),
  ),
  c(
    "prio-tooltip-typo",
    ["priority"],
    ["C: The tooltip on the settings icon says 'Setings'."],
    ticket("ui_ux", 1),
  ),
  c(
    "prio-minor-export",
    ["priority"],
    ["C: The exported PDF has a slightly wrong margin on the right side. Not a big deal."],
    ticket(["bug", "ui_ux"], 1),
  ),
];

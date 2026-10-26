import { c, ticket } from "../build";

// "Now" is Monday 2026-10-26 10:00 UTC unless a case says otherwise.
export const dates = [
  c(
    "date-friday",
    ["dates"],
    ["C: The invoice export is broken and I need it fixed by Friday for our audit."],
    ticket("bug", 3, { dueDate: "2026-10-30" }),
  ),
  c(
    "date-end-of-month",
    ["dates"],
    ["C: The payroll report shows wrong totals. We need this corrected by the end of the month."],
    ticket(["data", "bug"], 3, { dueDate: "2026-10-31" }),
  ),
  c(
    "date-explicit",
    ["dates"],
    [
      "C: Our product launches on Nov 5 and the signup form is throwing errors. Please fix it before Nov 5.",
    ],
    ticket("bug", 4, { dueDate: "2026-11-05" }),
  ),
  c(
    "date-in-3-days",
    ["dates"],
    ["C: The calendar sync is broken, and I need this working in 3 days for a conference."],
    ticket("bug", 3, { dueDate: "2026-10-29" }),
  ),
  c(
    "date-tomorrow",
    ["dates"],
    ["C: Our client demo is tomorrow and the reports page crashes. Please fix it by tomorrow."],
    ticket("bug", 4, { dueDate: "2026-10-27" }),
  ),
  c(
    "date-next-tuesday",
    ["dates"],
    [
      "C: We'd like the CSV export added. Can you have it ready by next Tuesday? We're onboarding a client.",
    ],
    ticket("feature", 2, { dueDate: "2026-11-03" }),
  ),
  c(
    "date-by-the-15th",
    ["dates"],
    ["C: The tax invoice template is wrong. We have to send them out by the 15th."],
    ticket(["bug", "data"], 3, { dueDate: "2026-11-15" }),
  ),
  c(
    "date-feature-deadline",
    ["dates"],
    ["C: We need dark mode by Nov 20 for our company-wide rollout."],
    ticket("feature", 2, { dueDate: "2026-11-20" }),
  ),
  c(
    "date-spanish",
    ["dates", "language"],
    [
      "C: Hola, el formulario de pago falla con un error y necesito que lo arreglen para el viernes, tenemos un evento.",
    ],
    ticket("bug", 4, { dueDate: "2026-10-30" }),
  ),
  c(
    "date-german",
    ["dates", "language"],
    [
      "C: Der Rechnungsexport liefert eine leere Datei. Bitte bis Freitag beheben, wir brauchen ihn für die Buchhaltung.",
    ],
    ticket(["bug", "data"], 3, { dueDate: "2026-10-30" }),
  ),
  c(
    "date-timezone-midnight",
    ["dates"],
    ["C: The mobile app login is failing for all of us. Please fix it by tomorrow."],
    ticket("bug", 4, { dueDate: "2026-10-28" }),
    {
      now: "2026-10-26T23:40:00Z",
      timezone: "Asia/Kolkata",
      note: "At 23:30 UTC it is already the 27th in India, so 'tomorrow' is the 28th.",
    },
  ),
  // No usable deadline: the dangerous cases. A date here would be an invented one.
  c(
    "date-none-asap",
    ["dates", "no-date"],
    ["C: The checkout page is broken, please fix ASAP!!!"],
    ticket("bug", 4, { dueDate: null }),
  ),
  c(
    "date-none-soon",
    ["dates", "no-date"],
    ["C: We'd really like a Gantt chart view. Hopefully soon!"],
    ticket("feature", 2, { dueDate: null }),
  ),
  c(
    "date-none-this-week",
    ["dates", "no-date"],
    ["C: The avatar upload is broken. It would be great if it was working this week."],
    ticket("bug", 2, { dueDate: null }),
    { note: "'This week' is too vague to be a deadline." },
  ),
  c(
    "date-none-operator-promise",
    ["dates", "no-date"],
    [
      "C: The PDF export is broken.",
      "O: Thanks for reporting. We'll have it fixed by Wednesday.",
      "C: Great.",
    ],
    ticket("bug", 3, { dueDate: null }),
    { note: "A date promised by support is not a customer deadline." },
  ),
  c(
    "date-none-since",
    ["dates", "no-date"],
    ["C: Search has been broken since Monday and I'm losing customers."],
    ticket("bug", 4, { dueDate: null }),
    { note: "'Since Monday' says when it broke, not when it must be fixed." },
  ),
  c(
    "date-none-renewal",
    ["dates", "no-date"],
    [
      "C: The billing page crashes whenever I open it. My subscription renews on Nov 1, in case that helps.",
    ],
    ticket("bug", 3, { dueDate: null }),
    { note: "A renewal date is context, not a deadline." },
  ),
  c(
    "date-none-started",
    ["dates", "no-date"],
    ["C: Since 2026-10-20 all my exports have been failing with 'timeout'."],
    ticket(["bug", "performance"], 3, { dueDate: null }),
  ),
  c("date-none-question", ["dates", "no-date"], ["C: What are your support hours on Friday?"], {
    positive: false,
    kind: "no_action",
    dueDate: null,
  }),
];

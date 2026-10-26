import { c, ticket } from "../build";

export const bugs = [
  c(
    "bug-checkout-safari",
    ["bug"],
    [
      "C: The Pay button on checkout does nothing on Safari. I can't buy anything. Chrome works but my whole team uses Safari.",
    ],
    ticket("bug", 4),
  ),
  c(
    "bug-form-500",
    ["bug"],
    [
      "C: When I submit the contact form I get 'Error 500'. Tried 3 times with different emails.",
      "O: Which page exactly?",
      "C: /contact, the one in the footer.",
    ],
    ticket("bug", 3),
  ),
  c(
    "bug-login-loop",
    ["bug"],
    [
      "C: I enter my password and it just sends me back to the login page. Like that all morning. I can't get into my account at all, and I've tried two browsers.",
    ],
    ticket("bug", 4),
  ),
  c(
    "bug-csv-empty",
    ["bug", "data"],
    [
      "C: The exported CSV is empty, 0 rows, but I have 200 orders in the system.",
      "O: Do you have any filters set?",
      "C: No filters at all.",
    ],
    ticket(["bug", "data"], 3),
  ),
  c(
    "bug-ios-crash",
    ["bug"],
    [
      "C: The iOS app crashes right when I open it since yesterday's update. iPhone 14, iOS 18.1. Reinstalling didn't help.",
    ],
    ticket("bug", 4),
  ),
  c(
    "bug-search-empty",
    ["bug"],
    [
      "C: Search returns no results for anything, even for items I can see right there in the list.",
    ],
    ticket("bug", 3),
  ),
  c(
    "bug-image-upload",
    ["bug"],
    [
      "C: Uploading a PNG on the profile page spins forever and then says 'upload failed'. JPG works fine though.",
    ],
    ticket("bug", 2),
    { note: "A workaround exists (use JPG)." },
  ),
  c(
    "bug-settings-not-saved",
    ["bug"],
    [
      "C: I change my notification settings and click Save. It says 'Saved!' but when I reload the page everything is back to the old values.",
    ],
    ticket("bug", 3),
  ),
  c(
    "bug-footer-404",
    ["bug"],
    ["C: The 'Pricing' link in your footer leads to a 404 page."],
    ticket("bug", 2),
  ),
  c(
    "bug-double-invoice",
    ["bug"],
    [
      "C: If I click 'Save' twice quickly on a new invoice it creates two identical invoices. It happened 4 times this week.",
    ],
    ticket("bug", 3),
  ),
  c(
    "bug-js-error",
    ["bug"],
    [
      "C: On the reports page I see a red box: \"TypeError: Cannot read properties of undefined (reading 'map')\" and the table never loads. Chrome 130, Windows.",
    ],
    ticket("bug", 3),
  ),
  c(
    "bug-reset-email-missing",
    ["bug", "infra"],
    [
      "C: I never get the password reset email. I've waited an hour and checked my spam folder.",
      "O: Which address did you use?",
      "C: The same one I log in with.",
    ],
    ticket(["bug", "infra"], 3),
  ),
  c(
    "bug-timezone-dates",
    ["bug", "data"],
    [
      "C: Dates in the reports show one day earlier than they really are. I'm in Sydney. An order from the 5th shows as the 4th.",
    ],
    ticket(["bug", "data"], 3),
  ),
  c(
    "bug-operator-confirms",
    ["bug"],
    [
      "C: Drag and drop in the kanban board stopped working after the last update.",
      "O: I can reproduce this, looks like a bug on our side. I'll pass it to the developers.",
      "C: Great, thanks.",
    ],
    ticket("bug", 3),
  ),
];

export const ui = [
  c(
    "ui-overlap-mobile",
    ["ui"],
    [
      "C: On my phone the price and the 'Add to cart' button overlap on the product page, can't tell what's what.",
    ],
    ticket("ui_ux", 2),
  ),
  c(
    "ui-contrast-dark",
    ["ui"],
    [
      "C: Dark mode: the grey text on the black background in the Settings page is really hard to read.",
    ],
    ticket("ui_ux", 2),
  ),
  c(
    "ui-button-cutoff",
    ["ui"],
    [
      "C: On a small Android phone the 'Confirm order' button is cut off at the bottom of the screen and I can't scroll to it. I couldn't finish my order.",
    ],
    ticket(["ui_ux", "bug"], 3),
  ),
  c(
    "ui-confusing-invite",
    ["ui", "improvement"],
    [
      "C: It took me 10 minutes to find where to invite teammates. Super confusing menu, I clicked everywhere.",
    ],
    ticket(["ui_ux", "improvement"], 2),
  ),
  c(
    "ui-typo-homepage",
    ["ui"],
    ["C: There's a typo on your homepage, it says 'Recieve updates' instead of 'Receive'."],
    ticket("ui_ux", 1),
  ),
  c(
    "ui-icon-misaligned",
    ["ui"],
    [
      "C: The bell icon in the top bar is 2 pixels lower than the other icons. Just noticed it, probably not a big deal.",
    ],
    ticket("ui_ux", 1),
  ),
];

export const features = [
  c(
    "feat-csv-export",
    ["feature"],
    [
      "C: Is it possible to export the project list to CSV? I can only see PDF.",
      "O: Not at the moment, no.",
      "C: That would be really useful for us.",
    ],
    ticket("feature", 2),
  ),
  c(
    "feat-dark-mode",
    ["feature"],
    ["C: Any plans for a dark mode? My eyes hurt in the evening."],
    ticket("feature", 2),
  ),
  c(
    "feat-slack-integration",
    ["feature"],
    [
      "C: Do you integrate with Microsoft Teams? We'd love notifications there.",
      "O: Only Slack for now.",
      "C: Please consider Teams, half our company lives in it.",
    ],
    ticket("feature", 2),
  ),
  c(
    "feat-bulk-edit",
    ["feature"],
    ["C: I have to change the status of 300 tasks one by one. Please add bulk editing."],
    ticket("feature", 3),
  ),
  c(
    "feat-search-tags",
    ["improvement"],
    [
      "C: The search only matches titles. It would be great if it also searched tags and descriptions.",
    ],
    ticket(["improvement", "feature"], 2),
  ),
  c(
    "feat-keyboard",
    ["feature"],
    ["C: Would be cool to have keyboard shortcuts like Cmd+K for quick search."],
    ticket("feature", 1),
  ),
  c(
    "feat-sso",
    ["feature"],
    [
      "C: We can't roll your product out to our 200 employees without SAML single sign-on. Our security team requires it. Is it on the roadmap?",
    ],
    ticket("feature", 3),
  ),
  c(
    "feat-edit-comment",
    ["improvement"],
    ["C: I can't edit a comment after posting it, only delete. Could you allow editing?"],
    ticket(["improvement", "feature"], 2),
  ),
  c(
    "feat-api-webhooks",
    ["feature"],
    [
      "C: We'd like to receive a webhook whenever an order status changes so we can sync with our ERP.",
    ],
    ticket("feature", 3),
  ),
];

export const infraPerf = [
  c(
    "infra-site-down",
    ["infra"],
    ["C: Your website is completely down for me and my whole team! Getting '502 Bad Gateway'."],
    ticket("infra", 5),
  ),
  c(
    "infra-ssl-expired",
    ["infra"],
    [
      "C: Chrome says 'Your connection is not private' on app.yourcompany.com, the certificate seems to have expired. I can't proceed safely.",
    ],
    ticket("infra", 5),
  ),
  c(
    "infra-emails-not-sent",
    ["infra"],
    [
      "C: None of our customers have received order confirmation emails since yesterday evening. We've had 40 orders.",
    ],
    ticket(["infra", "bug"], 4),
  ),
  c(
    "infra-api-timeouts",
    ["infra", "performance"],
    [
      "C: Our integration calls to your API time out about 30% of the time since Monday. Retrying usually works.",
    ],
    ticket(["infra", "performance"], 4),
  ),
  c(
    "perf-dashboard-slow",
    ["performance"],
    ["C: The dashboard takes 25 seconds to load now. It used to be instant. Same on every device."],
    ticket("performance", 3),
  ),
  c(
    "perf-report-timeout",
    ["performance"],
    ["C: Generating the yearly report always times out after a minute. Monthly reports are fine."],
    ticket("performance", 3),
  ),
];

export const securityData = [
  c(
    "sec-idor",
    ["security"],
    [
      "C: If I change the number in the URL of my invoice I can see other customers' invoices with their names and addresses!",
    ],
    ticket("security", 5),
  ),
  c(
    "sec-xss",
    ["security"],
    [
      "C: I found that if I put <script>alert(1)</script> in my display name, it executes when an admin opens the user list. Responsible disclosure, happy to share more details.",
    ],
    ticket("security", 4),
  ),
  c(
    "sec-api-key-visible",
    ["security"],
    [
      "C: Your private API key is visible in the page source of the checkout page. Anyone can copy it.",
    ],
    ticket("security", 4),
  ),
  c(
    "data-wrong-total",
    ["data"],
    ["C: Invoice #5521 shows a total of $1,200 but the line items add up to $1,020."],
    ticket(["data", "bug"], 3),
  ),
  c(
    "data-duplicates",
    ["data"],
    [
      "C: Every contact shows up twice since the import I did on Friday. Can you fix the duplicates?",
    ],
    ticket(["data", "bug"], 3),
  ),
  c(
    "data-missing-projects",
    ["data"],
    ["C: After last night's maintenance 40 of my projects are gone! Years of work. Please help!!"],
    ticket("data", 5),
  ),
];

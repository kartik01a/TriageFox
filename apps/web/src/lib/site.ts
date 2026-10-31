/**
 * Facts about the product and its operator, used by the public pages (landing, legal, footer, emails).
 * One place, so a change (a new contact address, a company name later) is a one-line edit.
 */
export const SITE = {
  name: "TriageFox",
  /** The person who runs TriageFox (a sole proprietor in India). */
  operator: "Kartik Singh Bisht",
  country: "India",
  repoUrl: "https://github.com/kartik01a/TriageFox",
  // TODO(owner): after buying triagefox.com, change this to support@triagefox.com (and SECURITY.md's
  // security contact). Everything public reads it from here.
  contactEmail: "kartiksinghbisht1@gmail.com",
  securityEmail: "kartiksinghbisht1@gmail.com",
} as const;

/** Last time the legal texts were meaningfully changed. Shown at the top of each. */
export const LEGAL_UPDATED = "31 October 2026";

import type { Metadata } from "next";
import { Guide } from "@/components/site/guide";

export const metadata: Metadata = {
  title: "Crisp to Jira: turn customer chats into Jira issues",
  description:
    "Automatically create Jira issues from Crisp conversations, with priority, steps to reproduce and screenshots.",
  alternates: { canonical: "/integrations/crisp-to-jira" },
};

export default function Page() {
  return (
    <Guide
      slug="crisp-to-jira"
      tool="Jira"
      title="Crisp to Jira: turn customer chats into Jira issues"
      description="Automatically create Jira issues from Crisp conversations, with priority, steps to reproduce and screenshots attached."
      mapping={[
        ["Title written by the AI (what is wrong)", "Summary"],
        [
          "Summary, steps to reproduce, expected and actual, environment",
          "Description (formatted for Jira)",
        ],
        [
          "Bug, UI/UX, feature, improvement, performance, infra, security, data",
          "The issue type you map for each category, plus a label",
        ],
        [
          "Priority 1–5 from a fixed rubric",
          "Your Jira priority (Highest to Lowest), set right after creation",
        ],
        ["A deadline the customer actually said (“by Friday”)", "Due date. No quote, no date"],
        ["Screenshots and files the customer sent", "Attachments (links for very large files)"],
        [
          "More detail later, or a second customer with the same bug",
          "A comment, and “Reported by N customers”",
        ],
      ]}
      setup={[
        "Install the TriageFox plugin on your Crisp website and link it to your workspace.",
        "Connect Jira Cloud (you approve access on Atlassian). TriageFox asks only for the permissions it needs to read projects and create and edit issues.",
        "Choose the Jira project. TriageFox checks it and tells you if an issue type has required custom fields it cannot fill.",
        "Map each ticket category to an issue type and each priority to your Jira priorities (suggestions are filled in).",
        "Try it on your last 10 chats without creating anything, then switch the automation on.",
      ]}
      faq={[
        [
          "Does it work with team-managed and company-managed projects?",
          "Yes, for Jira Cloud. Priority and due date are set after the issue is created, so they work even when they are not on the create screen.",
        ],
        [
          "What if my project has required custom fields?",
          "Setup shows which fields block an issue type, so you can choose another type or make the field optional.",
        ],
        [
          "Can I review tickets before they are created?",
          "Yes. Tickets the AI is less sure about wait in a review queue, and you decide the threshold.",
        ],
        [
          "Does it overwrite what my team edits in Jira?",
          "No. It only adds comments and updates labels and priority. It rewrites the description footer only if nobody has edited the description since.",
        ],
      ]}
    />
  );
}

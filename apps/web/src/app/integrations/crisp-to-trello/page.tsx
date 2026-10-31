import type { Metadata } from "next";
import { Guide } from "@/components/site/guide";

export const metadata: Metadata = {
  title: "Crisp to Trello: turn customer chats into Trello cards",
  description:
    "Automatically create Trello cards from Crisp conversations, with priority labels, steps to reproduce and screenshots.",
  alternates: { canonical: "/integrations/crisp-to-trello" },
};

export default function Page() {
  return (
    <Guide
      slug="crisp-to-trello"
      tool="Trello"
      title="Crisp to Trello: turn customer chats into Trello cards"
      description="Automatically create Trello cards from Crisp conversations, with priority labels, steps to reproduce and screenshots attached."
      mapping={[
        ["Title written by the AI (what is wrong)", "Card name"],
        [
          "Summary, steps to reproduce, expected and actual, environment",
          "Card description (Markdown)",
        ],
        [
          "Bug, UI/UX, feature, improvement, performance, infra, security, data",
          "A coloured type label",
        ],
        [
          "Priority 1–5 from a fixed rubric",
          "A coloured priority label: P5 red, P4 orange, P3 yellow, P2 lime, P1 green",
        ],
        ["A deadline the customer actually said (“by Friday”)", "Due date. No quote, no date"],
        [
          "Screenshots and files the customer sent",
          "Card attachments (links for files over 10 MB)",
        ],
        [
          "More detail later, or a second customer with the same bug",
          "A comment on the card, and “Reported by N customers”",
        ],
      ]}
      setup={[
        "Install the TriageFox plugin on your Crisp website and link it to your workspace.",
        "Connect Trello (you approve access on Trello).",
        "Choose the board and the list new cards should land in. TriageFox creates any missing labels itself.",
        "Choose whether tickets include a link to the conversation or the customer's name (both off by default).",
        "Try it on your last 10 chats without creating anything, then switch the automation on.",
      ]}
      faq={[
        [
          "Will it create lots of labels on my board?",
          "Only the two a card needs (its priority and its type), and only when first used. It reuses labels with the same name.",
        ],
        [
          "Can I send tickets to Trello and Jira at once?",
          "Yes. Each ticket goes to every tool you connect, and a failure in one never blocks the other.",
        ],
        [
          "What if someone moves or edits the card?",
          "Moving cards is fine. TriageFox adds comments and updates labels, and it never overwrites a description a person has edited.",
        ],
        [
          "What if a card is archived and the bug comes back?",
          "Another customer's report of an archived card's problem opens a new card that points to the old one.",
        ],
      ]}
    />
  );
}

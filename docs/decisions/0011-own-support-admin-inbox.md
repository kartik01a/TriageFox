# 0011 — Own support via Crisp, triaged into an admin inbox
- **Status:** Accepted
- **Date:** 2026-10-25

## Context
We need a way for visitors and customers to ask questions and report problems (bugs, billing, refunds), and a single place for the solo owner to see and handle them, at no cost.

## Decision
- Use **Crisp (free plan)** on triagefox.com and inside the app.
- Run our **own TriageFox pipeline** on those chats with a platform automation whose destination is a new **`internal_inbox`** connector, which writes `support_items` instead of Jira/Trello.
- Capture bugs, features, billing, refunds, account issues, complaints, unanswered questions, and praise (saved as testimonial candidates).
- **Urgent alerts by email + Slack** (incoming webhook).
- In-app chats use Crisp identity verification, so the inbox can trust who's asking.
- Separate Crisp websites for development testing and real support.

## Alternatives considered
- **Featurebase:** costs money for API access.
- **Our own chat widget:** reinventing live chat.
- **Jira/Trello for our own support:** the owner prefers seeing everything in the admin panel; billing/refund items aren't dev tickets.
- **Telegram alerts:** the owner is more active on Slack.

## Consequences
- Dogfooding: every bug in the pipeline shows up in our own support first.
- `internal_inbox` is a reusable destination. It can later become a customer-facing **"TriageFox Inbox"** for teams without Jira/Trello (roadmap idea).
- Crisp's free plan limits (~100 contact profiles, no AI answers) will need an upgrade once support volume grows.

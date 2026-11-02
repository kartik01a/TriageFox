# Requirements & Product Decisions

Agreed 2026-10-25 (revised the same day: Featurebase replaced by Crisp, open-core model, global launch). Each item gives the decision and the reason.

## 1. Platform type
- **Open source + hosted SaaS** ([decisions/0005](decisions/0005-open-core-agpl.md)).
  - **Hosted:** multi-tenant. Anyone can sign up, create a workspace, invite teammates.
  - **Self-hosted:** the same code via Docker Compose. Billing switched off, own AI key required.
- Credentials are **stored encrypted** (see [security.md](security.md)).
- The hosted version needs a paid plan (or free tier) before an automation can be enabled ([billing.md](billing.md)).
- **Global launch**, priced in USD; **real INR prices for India** (UPI); an approximate local-currency hint for everyone else ([billing.md](billing.md)).

## 2. Sources
- **MVP: Crisp** conversations ([decisions/0006](decisions/0006-crisp-as-mvp-source.md)).
- In the UI and on pricing, each connected source account (a Crisp website, later a Chatwoot inbox or tawk.to property) is called a **connected inbox**. Free to develop against, a large small-business user base, and a marketplace that brings users.
- Later, one at a time: Chatwoot → tawk.to → Featurebase → Freshdesk → Intercom → Zendesk → others ([roadmap.md](roadmap.md#integrations-roadmap)). More integrations means more potential customers.

## 3. When a ticket is created or updated
- **Don't** create a ticket for openers with no actual problem ("Hi, I'm X and I have a problem").
- **Do** create one as soon as an actionable problem is described.
- A short **quiet window** (~3 min, configurable) groups rapid messages into one AI evaluation. When the conversation is marked **resolved** in Crisp, it's evaluated immediately.
- We store the link between **conversation and ticket(s)**. Later messages that add detail **update the same ticket**.
- One conversation can produce **several tickets** if the customer raises separate problems.
- Updates are posted as **comments**. The description is only rewritten if no person has edited the ticket since our last write, so we never overwrite a developer's edits.
- If support resolves the issue in chat after a ticket exists, we comment "Possibly resolved in chat". Tickets are never deleted automatically.

## 4. What counts as a ticket
**Ticket** = needs a code, config or deployment change:
bug · UI/UX issue · feature request · improvement · performance · infra/deployment · security · data bug.

**Not a ticket** = can be handled in chat:
how-to questions ("how do I open X") · account or billing questions · greetings and thanks · spam · problems already solved in the conversation.

Uncertain cases (confidence below the threshold) go to the **Review queue** with a one-click "Create ticket" button. Full rules in [ai-triage.md](ai-triage.md).

## 5. Priority
Five levels, **5 = highest**, each with a name and colour:

| Level | Name | Colour | Jira priority |
|---|---|---|---|
| 5 | Critical | red | Highest |
| 4 | High | orange | High |
| 3 | Medium | yellow | Medium |
| 2 | Low | lime | Low |
| 1 | Lowest | green | Lowest |

Set by a fixed rubric, not gut feel ([ai-triage.md](ai-triage.md#priority-rubric)).

The names and colours above are the **default labels**. Each team can choose its own label for every level and every type on the Trello connection page (several levels may share one, or use none); in Jira, levels map to the project's priorities and types map to labels. The AI always works on the 1–5 scale and the fixed types; only the ticket's labels change ([ADR 0013](decisions/0013-customer-label-mapping.md)).

## 6. Multiple destinations
- One automation = one source + any number of destinations. **Every destination gets the same ticket.**
- If only one destination is connected, only that one is used.
- Routing rules are future work.

## 7. Dates
- Created date: comes from Trello or Jira itself.
- **Due date only if the customer explicitly stated one** ("needs to be fixed by Friday"). No mention means no due date, so teams never have to delete made-up dates.
- The AI returns the exact quote, and our code turns it into a date using the message time and the workspace timezone.
- Vague urgency ("ASAP", "soon") gives no due date (but may raise priority).

## 8. Two-way sync
- **Not in v1.** Listed in [roadmap.md](roadmap.md#future-updates). We still store ticket links so it's easy to add.

## 9. Automation settings & duplicates
- **Include conversation link** (a link to the Crisp conversation) in the ticket. Toggle, **off by default**, because some teams don't want ticket readers to see the chat. Useful for checking the AI's work.
- **Include customer names** in the ticket. Toggle, **off by default**; when off, tickets say "Reported by N customers".
- **Duplicates are always merged**: the matching existing ticket gets a comment with the new report, the report count goes up by 1, and new attachments are added.

## 10. AI provider & cost
- **OpenAI** ([decisions/0002](decisions/0002-openai.md)). Chosen for image input (screenshots), strict JSON output and embeddings.
- **Bring your own OpenAI key** covers only the AI key, nothing else:
  - **Self-hosted:** their install has no platform key, so they set `OPENAI_API_KEY` in their own `.env` (alongside their own database, Redis, Crisp plugin, Trello and Atlassian app settings). This is just configuration.
  - **Hosted (optional):** a workspace can paste its own OpenAI key in *Settings → AI*. AI usage is then billed to them by OpenAI, so we can offer a cheaper plan. Everything else (database, Redis, server) stays ours. Those costs are tiny per customer because we store only metadata and never store files.
  - **Key only, never the model.** Customers can't choose or change models. We pick the models (via evals) so triage quality stays consistent and a cheaper model can't break the app. When a key is saved, we make a test call **to the exact models we use**, and reject keys that lack access or have too low rate limits.
  - BYOK plans are cheaper (see the pricing doc in `docs/private/`). The code path is the same either way: use the workspace key if present, otherwise the platform key.
- On the hosted version we pay AI costs out of subscription revenue. The free tier is capped so AI cost stays small and predictable. Usage is tracked per workspace.

## 11. Connecting tools
- **Crisp:** the user installs our Crisp Marketplace plugin on their Crisp website. No API key to paste.
- **Trello:** a "Connect Trello" button using Trello's authorize flow.
- **Jira Cloud:** OAuth 2.0 (3LO), with an API token as fallback.
- See [decisions/0004](decisions/0004-per-provider-auth.md).

## 12. Tech stack & hosting
- **TypeScript** monorepo, Next.js, Postgres + pgvector, BullMQ + Redis ([decisions/0001](decisions/0001-typescript-stack.md)).
- Hosting: **one cheap server running Docker Compose**: Oracle Cloud Always Free or a ~₹450/month VPS ([decisions/0007](decisions/0007-hosting-single-vps.md)). The same Compose file is the self-host package.

## 13. Attachments
- **Always** included, with no setting, because screenshots are critical for developers. Every file the customer sends (screenshots, documents, **voice messages**, videos) goes on the ticket, even when the AI thinks a picture doesn't show the bug. When one chat produces several tickets, the AI's choice decides which ticket each file goes on; files it matched to none go on all of them. Operator and internal-note files are attached only when the AI picks them.
- The AI does not listen to voice messages (no transcription yet); they are attached for the developer to play.
- Files are streamed from Crisp and uploaded **directly** into Trello or Jira. We store nothing, so there's no extra cost. Only if a file is too large or the upload fails do we link Crisp's own file URL instead.

## 14. Timeline & budget
- No deadline. Build in phases, check each integration end to end, then release.
- Running cost target: **≤ ₹1,000/month** (server, domain, testing AI usage).

## Working assumptions (override if wrong)
- Tickets are written in **English**; non-English originals are quoted.
- Operator replies and private notes are given to the AI as context.
- No backfill on enable. A **dry run on the last 10 conversations** is offered instead.
- Pricing and free-tier limits will be decided in a separate pricing discussion.

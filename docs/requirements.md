# Requirements & Product Decisions

Agreed 2026-10-25. Each item records the decision and the reason.

## 1. Platform type
- Multi-tenant **SaaS**: anyone can sign up, create a workspace, invite teammates.
- Users enter credentials for their tools; these are **stored encrypted** (see [security.md](security.md)).
- **Billing required** before an automation can be enabled (see [billing.md](billing.md)).

## 2. Sources watched
- **Both** Featurebase Messenger conversations **and** feedback-board posts. Each can be toggled per automation.

## 3. When a ticket is created / updated
- **Don't** create a ticket for openers with no actual problem ("Hi, I'm X and I have a problem").
- **Do** create one as soon as an actionable problem is described.
- A short **quiet window** (~3 min, configurable) batches rapid consecutive messages into a single AI evaluation. Closing the conversation triggers evaluation immediately.
- We store the link **conversation ↔ ticket(s)**. Later messages that add detail **update the same ticket**.
- One conversation can produce **multiple tickets** if the customer raises separate problems.
- Updates are posted as **comments**; the description is only rewritten if no human has edited the ticket since our last write (never clobber developer edits).
- If support resolves the issue in chat after a ticket exists → comment "Possibly resolved in chat". Never auto-delete tickets.

## 4. What counts as a ticket
**Ticket** = needs a code/config/deployment change:
bug · UI/UX issue · feature request · improvement · performance · infra/deployment · security · data bug.

**Not a ticket** = can be handled in chat:
how-to / "how do I open X" · account or billing questions · greetings / thanks · spam · problems already solved in the conversation.

Uncertain cases (confidence below threshold) go to the **Review queue** with one-click "Create ticket". Full rules in [ai-triage.md](ai-triage.md).

## 5. Priority
Five levels, **5 = highest**, each with a name and colour:

| Level | Name | Colour | Jira priority |
|---|---|---|---|
| 5 | Critical | red | Highest |
| 4 | High | orange | High |
| 3 | Medium | yellow | Medium |
| 2 | Low | lime | Low |
| 1 | Lowest | green | Lowest |

Assigned by a fixed rubric, not gut feel ([ai-triage.md](ai-triage.md#priority-rubric)).

## 6. Multiple destinations
- One automation = one source + N destinations. **Every destination receives the same ticket.**
- If only one destination is connected, only that one is used.
- Routing rules are future work.

## 7. Dates
- Created date: native in Trello/Jira.
- **Due date only if the customer explicitly stated one** ("needs to be fixed by Friday"). No mention → no due date (avoids teams having to delete fake dates).
- AI returns the exact quote; our code converts it to a date using the message timestamp + workspace timezone.
- Vague urgency ("ASAP", "soon") → no due date (may raise priority).

## 8. Two-way sync
- **Not in v1.** Listed in [roadmap.md](roadmap.md#future-updates). We still store ticket links so it's easy to add.

## 9. Automation settings & duplicates
- **Include Featurebase link** in ticket — toggle, **default off** (some teams don't want ticket readers to see the chat). Useful to verify AI output.
- **Include customer names** in ticket — toggle, **default off** (then "Reported by N customers").
- **Duplicates always merged**: a matching existing ticket gets a comment with the new report, report count +1, and any new attachments.

## 10. AI provider & cost
- **OpenAI** (user has OpenAI + DeepSeek keys; no Anthropic key). Chosen for vision (screenshots), strict JSON structured outputs, and embeddings. See [decisions/0002-openai.md](decisions/0002-openai.md).
- The **platform** pays AI costs; customers pay a subscription. Usage is metered per workspace.

## 11. Connecting tools
- Use whatever each tool supports best: Featurebase = API key; Trello = "Connect Trello" authorize flow; Jira Cloud = OAuth 2.0 (3LO) with API-token fallback. See [decisions/0004-per-provider-auth.md](decisions/0004-per-provider-auth.md).

## 12. Tech stack
- Not language-locked; best tool wins. Chosen: **TypeScript** monorepo, Next.js, Postgres + pgvector, BullMQ + Redis. See [decisions/0001-typescript-stack.md](decisions/0001-typescript-stack.md).

## 13. Attachments
- **Always** included — no setting. Screenshots are critical for developers.
- Files are streamed from Featurebase and uploaded **directly** into Trello/Jira (no storage on our side → no extra cost). Only if a file is too large or upload fails do we fall back to linking Featurebase's own file URL.

## 14. Timeline
- No deadline. Build in phases, verify each integration end-to-end, then release.

## Working assumptions (override if wrong)
- Tickets are written in **English**; non-English originals are quoted.
- Admin replies and internal notes are included as AI context.
- No backfill on enable; a **dry run on the last 10 conversations** is offered instead.
- Pay before enabling; browsing and connecting are free. Trial policy TBD with pricing.

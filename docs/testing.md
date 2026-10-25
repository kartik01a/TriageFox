# Testing

## Unit
- Date resolver: "by Friday" sent on Saturday, "end of month", "next Tuesday", timezones, unparseable phrases.
- Quote verification (quote must appear verbatim).
- Priority/type → Trello label and Jira priority mapping.
- Markdown → ADF conversion of the ticket template.
- Encryption round trip + key-version handling.
- Webhook signature: valid, tampered body, wrong secret.
- zod rejects malformed AI output and unknown `issueId`s.
- PII stripping.

## AI evals
- Golden set of 60–100 labelled conversations ([ai-triage.md](ai-triage.md#evals)).
- Targets: ticket/no-ticket ≥ 90%, type ≥ 85%, priority ±1 ≥ 85%, **0 hallucinated due dates**.
- Runs in CI on any change under `packages/ai/`.

## Integration
- Each connector against recorded HTTP (msw / nock) using real payload fixtures from Phase 0.
- Shared connector test suite every connector must pass.
- Nightly run against real sandboxes: Trello test board, free Jira Cloud site, Featurebase test workspace.
- Tenant isolation: user from org A cannot read/modify org B resources.

## Pipeline scenarios
1. Same webhook ×3 → exactly 1 ticket per destination.
2. 5 messages within the quiet window → 1 AI evaluation.
3. Follow-up message with more detail → comment on existing ticket, no new ticket.
4. Second customer reports same bug → duplicate comment, `report_count = 2`.
5. Duplicate of a closed ticket → new ticket referencing old.
6. Jira returns 500 → Trello card created, Jira retried and later succeeds.
7. Token revoked mid-run → automation paused, no events lost, replay after reconnect.
8. "Hi" / how-to conversation → no ticket, reason in activity log.
9. Toggles on/off change ticket body (source link, customer names).

## Billing
- Stripe CLI test events: checkout completed (enable allowed), payment failed (pause after grace), subscription deleted (pause).
- Non-owner cannot open billing.

## E2E (Playwright)
Sign up → create workspace → connect Featurebase, Trello, Jira → configure automation → pay with Stripe test card → enable → send a real Featurebase chat → Trello card + Jira issue appear with labels, priority, attachments → visible in activity log.

## Negative
- Wrong Featurebase key → clear error.
- Jira project with required custom field → enabling blocked with explanation.
- Unpaid org → cannot enable.

## Acceptance criteria (MVP done)
- New user self-serves signup → connect → configure → pay → enable.
- Bug chat → Trello card **and** Jira issue with correct type, priority (colour / Jira priority), repro steps, attachments.
- Due date only when explicitly stated.
- "Hi" / how-to → no ticket, reason logged.
- Follow-ups update the linked ticket.
- Same bug from another customer → comment + count.
- Toggles change ticket content.
- Duplicate webhooks never duplicate tickets.
- Revoked access pauses cleanly without losing events (7 days).
- Unpaid org cannot enable.
- Eval targets met.

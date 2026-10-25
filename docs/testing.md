# Testing

## Unit
- Date resolver: "by Friday" sent on a Saturday, "end of month", "next Tuesday", timezones, unparseable phrases.
- Quote check (the quote must appear word for word).
- Mapping from priority and type to Trello labels and Jira priorities.
- Markdown → ADF conversion of the ticket template.
- Encryption round trip and key-version handling.
- Crisp signature: a valid one, a tampered body, the wrong secret, a stale timestamp.
- Crisp dedupe key is stable for repeated deliveries.
- zod rejects malformed AI output and unknown `issueId`s.
- PII stripping.

## AI evals
- A labelled set of 60–100 conversations ([ai-triage.md](ai-triage.md#evals)).
- Targets: ticket vs no ticket ≥ 90%, type ≥ 85%, priority within ±1 ≥ 85%, **0 made-up due dates**.
- Runs in CI on any change under `packages/ai/`.

## Integration
- Each connector against recorded HTTP responses (msw / nock), using real payload samples captured in Phase 0.
- A shared test suite that every connector must pass.
- A nightly run against **free** real accounts:
  - our own Crisp website (development token)
  - a Trello test board
  - a free Jira Cloud site
- Tenant isolation: a user from workspace A cannot read or change workspace B's data.

## Pipeline scenarios
1. Same hook ×3 → exactly 1 ticket per destination.
2. 5 messages within the quiet window → 1 AI evaluation.
3. Follow-up message with more detail → comment on the existing ticket, no new ticket.
4. Second customer reports the same bug → duplicate comment, `report_count = 2`.
5. Duplicate of a closed ticket → new ticket that references the old one.
6. Jira returns 500 → Trello card created; Jira retried and later succeeds.
7. Token revoked mid-run → automation paused, no events lost, replayed after reconnecting.
8. "Hi" or how-to conversation → no ticket, reason shown in the activity log.
9. Settings toggles on/off change the ticket body (conversation link, customer names).
10. A hook dropped on purpose → the reconcile job picks up the conversation within ~10 min.
11. Conversation marked resolved → evaluated immediately, skipping the quiet window.

## Self-host
- `docker compose up` on a fresh VM with only the documented env vars → app starts, first user becomes admin.
- Missing env var → clear startup error.
- Billing UI is hidden and limits are off in `selfhost` mode.
- Bring-your-own OpenAI key works, and runs are recorded as `byok`.

## Billing (hosted)
- MoR test mode: subscription created → limits raised; payment failed → grace period then downgrade; cancelled → free tier.
- Non-owners cannot open billing.
- Trial: no-card sign-up → 50-conversation cap enforced; adding own key lifts the cap during the trial; a second account can't start a new trial on an already-linked Crisp inbox; trial AI budget exhausted → new trials require own key.
- Admin routes: non-admin and admin-without-2FA get 404; changing trial days, card-required or a plan price takes effect without a deploy and is audit-logged; existing subscribers keep their plan version; a plan without MoR price IDs can't be made public.
- Pricing page renders plans from the DB; the Monthly/Yearly and own-key toggles show the right prices.

## UI
- Lighthouse ≥ 90 on landing and pricing (mobile); LCP < 2.5 s.
- `prefers-reduced-motion` shows static versions of all animations.
- Keyboard-only run through sign-up → onboarding → enable.
- Empty, loading and error states render for each app page.

## End to end (Playwright)
Sign up → create a workspace → install the Crisp plugin and link the website → connect Trello and Jira → configure the automation → enable → send a real Crisp chat from the test website → a Trello card and a Jira issue appear with labels, priority and attachments → the result shows in the activity log.

## Negative
- Plugin not installed or website not linked → clear error.
- Jira project with a required custom field → enabling blocked, with an explanation.
- Invalid user OpenAI key → paused, with a clear message.

## Acceptance criteria (MVP done)
- A new hosted user can set everything up alone: sign up → connect Crisp, Trello and Jira → configure → enable.
- A self-hoster can run it with `docker compose up` by following the guide.
- A bug chat creates a Trello card **and** a Jira issue with the right type, priority (colour and Jira priority), repro steps and attachments.
- A due date appears only when the customer stated one.
- "Hi" and how-to chats create no ticket, and the reason is logged.
- Follow-ups update the linked ticket.
- The same bug from another customer adds a comment and raises the count.
- The toggles change the ticket content.
- Duplicate hooks never create duplicate tickets, and dropped hooks are recovered by reconcile.
- Revoked access pauses cleanly without losing events (7 days).
- The eval targets are met.

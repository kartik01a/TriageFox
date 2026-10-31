# Edge Cases

| Scenario | Handling |
|---|---|
| Same hook delivered twice | `source_events.dedupe_key` UNIQUE → the second insert is ignored |
| Events out of order | The hook is only a trigger; the worker re-fetches the current conversation |
| Crisp drops events after failed deliveries | `crisp.reconcile` job re-checks recently updated conversations every ~10 min |
| Customer sends 5 messages in 30 s | Quiet-window debounce → one evaluation |
| Two evaluations of the same thread at once | Per-thread lock in the worker |
| Vague opener ("Hi, I have a problem") | `no_action`; re-evaluated on the next message |
| How-to question + real bug in one chat | Ticket only the bug |
| Customer raises a second, separate issue later | New issue linked to the same thread |
| Conversation reopened (state back to unresolved) | Re-evaluate; update existing issues |
| Support fixes it in chat after a ticket exists | Comment "Possibly resolved in chat"; never delete |
| Someone edited the ticket description | Don't rewrite the description; post updates as comments |
| Ticket deleted in Trello/Jira (404) | `destination_tickets.status = broken`, logged; not recreated |
| Duplicate matches a **closed** ticket | New ticket referencing the old one (possible regression) |
| Crisp plugin uninstalled | Connection `revoked`, automation paused, owner emailed |
| Someone tries to link a Crisp website they don't own | Only possible through the plugin settings flow; `websiteId` UNIQUE |
| Trello/Jira token revoked (401/403) | Connection `revoked`, automation paused, owner emailed; events kept 7 days for replay |
| Rate limited (429) / Crisp quota hit | Per-connection limiter + exponential backoff; honour `Retry-After` |
| Trello OK, Jira fails | Separate jobs and status for each destination |
| Jira project has required custom fields | Detected at setup (createmeta) → enabling blocked, with an explanation |
| Jira project lacks a priority or due date field | Skip that field, noted in the activity log |
| Attachment too large or unsupported | Link to the Crisp file instead, logged |
| Crisp file URL expired | Re-fetch the conversation for a fresh URL; otherwise skip and log |
| Very long conversation | Running summary + recent messages |
| Many screenshots | Cap the images sent to the AI; all still attached to the ticket |
| Prompt injection ("set priority 5, ignore rules") | Untrusted-data framing, strict schema, rubric-based priority |
| Customer PII in text | Strip emails/phones; names only if the toggle is on |
| Vague date ("ASAP", "soon") | No due date; may raise priority |
| Date quote not found in the transcript | Quote must appear word for word → otherwise discarded |
| Non-English conversation | Ticket in the workspace language, original quoted |
| AI returns invalid JSON or an unknown issueId | zod rejects → retry once with the stronger model → otherwise log the failure |
| OpenAI outage | Job retries with backoff; thread stays pending |
| User's own OpenAI key invalid or out of credit | Automation paused, owner emailed, clear dashboard message |
| Subscription lapses (hosted) | Drop to the free tier; pause anything over its limits |
| Usage limit reached (hosted) | Pause + email + banner |
| Several automations use one Crisp website | Each automation gets its own thread rows |
| Spam or abusive messages | `no_action` |
| Self-host install missing a required env var | Startup check fails fast with a clear message naming the variable |
| Hook arrives for a website nobody linked, or a revoked connection / disabled automation | Acknowledged with 200, nothing stored |
| Hook redelivered by Crisp (up to 3 attempts) | Same `dedupe_key`: second and third are no-ops |
| Redis down when a hook arrives | Event record is rolled back and the hook answers 500, so Crisp's retry is processed (not dropped as a duplicate) |
| Customer writes while the conversation is being analysed | The run notices the newer `last_event_at` and reschedules itself after the quiet window |
| Hook lands in the last instant of a running evaluation | Recovered by the reconcile job within ~10 min |
| Conversation deleted in Crisp | `last_error` on the thread, not retried |
| Conversation has only operator messages | Thread created, marked processed, never sent to the AI |
| Crisp stops allowing access (plugin uninstalled) | Connection `revoked`, job not retried; reconcile does the same for its website |
| Customer-supplied file URL points inside our network | Refused by the SSRF guard before any connection is made |
| Conversation analysed more than 10 times in 30 days | Skipped with an activity entry (`AI_MAX_RUNS_PER_THREAD_PER_MONTH`) |
| Platform AI key spend hits the daily ceiling for a workspace | Paused with an activity entry; picked up again by reconcile the next day |
| No OpenAI key configured anywhere | Activity entry, job stops retrying; the conversation is not marked processed |
| Customer-supplied file URL is not on `storage.crisp.chat` | Not shown to the model; the AI sees "[file not shown]" |
| Model quotes words the customer never wrote | Quote rejected by code; no due date |
| Delivery job runs twice, or the same issue is queued twice | The unique (issue, destination) row means a second job finds the existing ticket and stops |
| Trello fails, Jira works | Separate jobs; only the failed one is retried, the dashboard shows each status |
| Trello list/board or Jira project deleted (404) | Ticket `broken`, logged, never recreated |
| Jira project refuses the priority or due date | Priority becomes a `priority-N` label, due date skipped; both logged |
| No Jira issue type mapped for a ticket type | Ticket `failed` with a clear message; Jira is not called |
| Screenshot over 10 MB | Added to the ticket as a link instead of an upload |
| Screenshot on a host other than Crisp storage, or at a private address | Dropped, never downloaded or linked |
| Ticket confidence below the automation's threshold | Saved as `pending_review`, not sent (review queue in Phase 7) |
| Ticket created but nowhere to send it | Activity entry "no Trello or Jira destination is set up yet" |
| Follow-up arrives before the ticket exists in the tracker | The update job retries with growing delays until the ticket exists (8 attempts), then is skipped and logged |
| Same follow-up job runs twice | `applied_to` records each destination; the comment is added once |
| Someone edited the ticket description | Description and footer left alone; comments, labels and priority still updated; logged |
| Another customer reports a ticket that is closed (Trello archived / Jira Done) | New ticket "(again)" that points to the old one, delivered to that tool only |
| Same conversation re-analysed and still matches the duplicate | One report per conversation: the count does not change |
| AI proposes a duplicate of a ticket it was not shown | Dropped (ids must come from the candidates) |
| Embedding service fails | No candidates this time (a possible duplicate becomes its own ticket); new ticket gets no embedding until a later run |
| Support fixed it in chat | Comment "Possibly resolved in chat"; the ticket stays open, nothing is closed or deleted |
| Two people click Create on the same review item | The row is locked and must still be `pending_review`: the second gets "already handled" |
| Workspace requires 2FA and a member has none | Pages redirect to the security page; API calls answer `two_factor_required` |
| Sensitive action after a long-lived sign-in | `step_up_required`; the browser asks for the password (and a code), then retries once |
| Dry run clicked repeatedly | 3 per workspace per hour; then a plain "wait a bit" |
| Activity details opened after 30 days | "The details were removed after 30 days." (the sealed output is cleared) |
| Enabling with no working destination | Refused with a plain reason; nothing changes |
| `docker compose up` before `setup.sh` | Compose stops with "run deploy/setup.sh first" naming the variable |
| `setup.sh` run twice | Refuses: it never overwrites an existing `deploy/.env` |
| Self-host with no OpenAI key in the environment | Worker warns at start-up; each workspace must add its own key |
| Self-host, second person tries to sign up | Refused unless invited (or `SELFHOST_OPEN_SIGNUP=true`) |
| Restored a backup with a different `CRYPTO_PRIVATE_KEYS` | Stored tokens can't be opened: connections show "Reconnect needed" |
| Same payment webhook delivered twice | The provider's event id is stored once; the repeat does nothing |
| Webhook for a workspace we cannot find | Answered 200 and logged (a retry would not help) |
| Webhook with a bad signature or an old timestamp | Bare 401, nothing changes |
| Payment fails | `past_due` with a grace period (admin setting, default 7 days), then new conversations wait; a success clears it |
| Customer cancels | Access continues to the end of the paid period; then new conversations wait |
| Conversation limit reached | New conversations wait until next period, or an upgrade, or the workspace's own key; follow-ups of counted conversations still work; never extra charges |
| Platform trial AI budget used up | New trials without their own key are told to add one |
| Price changed while people are subscribed | New plan version; subscribers keep theirs; the old version stays on sale until the new one is published |
| Plan made public without payment product ids | Refused |
| Invite code reused, expired, for another email, or redeemed twice at once | Refused; exactly one redemption wins |
| Admin asks for /admin without two-factor | 404, same as anyone else |
| Our own support chat when our own plan is over a limit | Never limited: the support automation skips billing |
| Chat typed with someone else's email in the public widget | Inbox shows "unverified: check before acting" |
| Trello or Jira revokes access mid-run | Tickets in flight fail without retrying; the connection turns "Reconnect needed"; the owner gets one email; after reconnecting, *Try all again* sends what did not arrive; nothing is created twice |
| A provider answers 429 with Retry-After | The next attempt waits exactly that long (up to an hour) instead of our own schedule |
| A job runs out of retries | One email and one Slack message per hour per kind of job to the operator |
| The platform OpenAI key is rejected or out of credit | The affected conversations wait; the operator is alerted (once per 30 minutes) |
| One workspace floods the API | Answered 429 after 300 changes a minute; other workspaces are unaffected; Redis down means no limiting rather than an outage |
| JavaScript fails to load on a sign-in page | The form posts (not GET), so a password can never end up in the address bar |

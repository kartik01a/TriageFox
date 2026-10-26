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

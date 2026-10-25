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

# Our Own Support: Crisp + Admin Inbox

Agreed 2026-10-25 ([decisions/0011](decisions/0011-own-support-admin-inbox.md)).

TriageFox handles **its own support with its own pipeline**. Visitors and customers chat with us through Crisp on triagefox.com and inside the app. The same AI triage reads every conversation, and the results land in an **admin inbox** (not Jira/Trello) where the owner handles them.

## Why Crisp
- Free plan: chat widget, 2 seats, shared inbox, desktop and mobile apps (reply on the go).
- It's the integration we're building anyway, so there's almost no extra code. It also makes a good marketing line: *"TriageFox triages TriageFox's support."*
- Free-plan limits: ~100 saved contact profiles; no built-in AI answers or knowledge base. Upgrade to Crisp Mini (~$45/month) or build an "Ask TriageFox" docs-answering bot once there's revenue.

## Two separate Crisp websites
| Crisp website | Purpose |
|---|---|
| `TriageFox Dev` | Our **trusted website** for the development token; integration testing only |
| `TriageFox Support` | Real support on triagefox.com and in the app; uses the production plugin like any customer |

Test chats never mix with real customers.

## Flow
```
Chat on triagefox.com or in the app (Crisp widget)
        ↓  plugin hook
Platform automation "TriageFox Support" (normal pipeline, platform AI key)
        ↓
Destination: internal_inbox  →  support_items table
        ↓
/admin/inbox  +  urgent alerts (email + Slack)
```

The `internal_inbox` destination implements the normal `DestinationConnector` interface: `createTicket` → new item; `addComment` / `updateTicket` → item updated. So updates and duplicate merging work exactly like for customers.

## What lands in the inbox
The platform automation captures more than customer automations do (billing and refunds matter for us):

| Category | Example | Urgent alert |
|---|---|---|
| 🐞 Bug | "Tickets stopped appearing in Jira" | Yes, if priority 4–5 |
| 💡 Feature request | "Please add Linear" | No |
| 💳 Billing | "I was charged twice" | **Yes** |
| ↩️ Refund request | "I want a refund" | **Yes** |
| 👤 Account / access | "Can't log in", "lost my 2FA" | **Yes** |
| 😠 Complaint | "This is too slow" | No |
| ❓ Unanswered question | A how-to with no operator reply after 4 hours | No |
| ⭐ Praise | "Love this tool!" | No, saved as a **testimonial candidate** |
| Greeting / spam | "hi" | Ignored |

Categories come from the AI's `category` field ([ai-triage.md](ai-triage.md#output-schema)). Which categories are captured, and which alert, is an admin setting.

## Admin inbox page (`/admin/inbox`)
- A list with filters: category, priority, status (**New → In progress → Done**), verified/unverified.
- Each item shows:
  - the AI summary
  - **who it is**: the matched user, workspace, plan, usage and trial status
  - an **Open in Crisp** button to reply
  - private notes and history
- A **Testimonials** tab holds praise items. Mark one "approved to quote" after asking the customer's permission.
- Same simple admin UI style (plain tables/forms).

## In-app help
- A **Help / Report a problem** button opens the Crisp widget pre-filled with the signed-in user's email, workspace ID and current page URL.
- **Identity verification:** our server signs the user's email (Crisp's identity-verification HMAC, to confirm in Phase 0). The inbox shows **Verified** only for signed identities. Anyone can type someone else's email into a public chat, so refund or account requests from **unverified** chats are never acted on without checking.

## Urgent alerts
- **Email + Slack** (Slack incoming webhook to a private channel, e.g. `#triagefox-alerts`; free).
- Sent for: refund requests, billing problems, account/access issues, priority 4–5 bugs, plus the system alerts from [security.md](security.md#11-logging-monitoring--audit).
- The Slack webhook URL is a platform secret (env / Vault), never in code or the repo.

## Cost
Crisp free plan: ₹0. AI for our own support uses the platform key and is tiny at our volume.

## When it's built
| Phase | Work |
|---|---|
| 1 | Crisp widget on the landing page (plain live chat; reply in the Crisp app) |
| 7 | In-app Help button with identity verification |
| 9 | `internal_inbox` destination, platform automation, `/admin/inbox`, testimonial tab, email + Slack alerts |

## As built in Phase 9

- **Automation flag instead of a destination:** the platform workspace's automation is marked `supportInbox` (admin: *Support inbox → Which workspace is our own support?*). The normal pipeline runs on it; in addition `recordSupportItems` files what the AI found in `support_items` (one item per conversation and category, updated when the conversation is read again). This is simpler than a connector and gives the same result; the inbox is not a tracker destination. That automation is **never limited by plans** and uses the platform AI key.
- **Categories:** created tickets become `bug` (bug, UI/UX, performance, infra, security, data) or `feature` (feature, improvement); no-action chats become `billing`, `refund_request`, `account`, `complaint`, `praise` or `question`; greetings and spam are ignored. Which categories are captured, which are urgent and the bug priority that is urgent are admin settings (`support`).
- **Who it is:** the customer's email is matched to a user and workspace. `identity_verified` is true only when Crisp reports a signed identity for the conversation (`verified` on the conversation / email verification entry: the exact field is **to confirm against a real signed chat**; until then it simply stays false, which is the safe side).
- **In-app help:** a *Help* button opens the chat; the app signs the user's email with `CRISP_IDENTITY_SECRET` (Crisp identity verification) and attaches the workspace id and name.
- **Alerts:** a new urgent item sends an email to `ALERT_EMAIL` and a Slack message to `SLACK_ALERTS_WEBHOOK_URL` (both optional), once per item.
- **Admin inbox:** `/admin/inbox` with status filters, private notes, identity shown as verified / "unverified: check before acting", an *Open in Crisp* link and a Testimonials tab with "approved to quote". Unanswered questions after 4 hours are not built yet (a later improvement).

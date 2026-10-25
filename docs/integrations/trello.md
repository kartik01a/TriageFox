# Trello (Destination)

## Auth
- We register **one app / Power-Up API key** for the platform.
- "Connect Trello" button → Trello authorize URL (scope `read,write`, expiration `never`, return URL = our callback) → we receive a user **token**.
- Store token encrypted. Users never create their own API keys.
- Review Trello's API terms / Power-Up rules for commercial use before launch.

## Setup (wizard)
1. List the user's boards → pick a board.
2. List lists on the board → pick the target list (e.g. "Inbox" / "Triage").
3. `ensureSetup`: create any missing labels on the board and store their ids.

## Labels

| Label | Colour |
|---|---|
| P5 Critical | red |
| P4 High | orange |
| P3 Medium | yellow |
| P2 Low | lime |
| P1 Lowest | green |
| Bug, UI/UX, Feature, Improvement, Performance, Infra, Security, Data | blue / sky / purple / pink / black (type labels) |

Trello has no native priority field — priority is a label.

## Card mapping
| Our field | Trello |
|---|---|
| title | card name |
| body (markdown) | card description (Trello renders markdown) |
| type | type label |
| priority | priority label |
| due_date | `due` |
| attachments | card attachments (multipart upload) |
| updates / duplicates | card comments |

## Limits & errors
- Rate limits apply per token and per API key → per-connection limiter in BullMQ + backoff.
- Attachment size limit depends on the workspace plan → on failure fall back to linking the source file.
- 401 → token revoked → connection `revoked`, automation paused, owner emailed.
- 404 on card → `destination_tickets.status = broken`, log, do not recreate.

## Phase 0 checks
- [ ] Authorize flow end-to-end with our app key.
- [ ] Attachment upload size limits on free vs paid workspaces.
- [ ] Card `dateLastActivity` usable for the "human edited?" check.

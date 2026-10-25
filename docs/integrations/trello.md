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

## Phase 0 findings (2026-10-25, verified against a real board)
- [x] **Authorize flow works** with our app key: `https://trello.com/1/authorize?key=…&scope=read,write&expiration=never&response_type=token` → the page shows the token.
- [x] **Cards, labels, due dates work.** Labels created by name + colour (`orange`, `blue`, …); card created with `idLabels`, `due`, markdown `desc`.
- [x] **Attachment limits (free workspace):** 1 MB and 10 MB uploaded fine; **26 MB rejected with HTTP 413 "File too large"**. Plan for **10 MB**; larger files fall back to a link.
- [x] **Human-edit detection:** `dateLastActivity` changes on *any* activity, including our own comments, so it **can't** tell us whether someone edited the description. Use the card's **actions** (`GET /cards/{id}/actions?filter=updateCard:desc`) and compare with our last write. (To re-verify by hand-editing a description.)
- Safety: the Trello client refuses writes to closed boards (HTTP 409 "Closed boards cannot be edited"). Handle as a configuration error in the wizard.
- Lesson: a user's Trello account holds many boards (including real work boards). The wizard must always show board names and never preselect one.

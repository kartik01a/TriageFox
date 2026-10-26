# Trello (Destination)

## Auth
- We register **one app / Power-Up API key** for the platform.
- "Connect Trello" button → Trello authorize URL (scope `read,write`, expiration `never`, return URL = our callback) → we receive a user **token**.
- Store token encrypted. Users never create their own API keys.
- Review Trello's API terms / Power-Up rules for commercial use before launch.

## As built (Phase 2)
- `GET /api/connections/trello/start` (owner/admin) sets a one-time httpOnly cookie and redirects to Trello's authorize URL (`scope=read,write`, `expiration=never`, `response_type=token`, `callback_method=fragment`, `return_url=APP_URL/app/connections/trello/callback`).
- The token comes back in the URL **fragment**. The callback page reads it once, removes it from the address bar and history, and POSTs it to `/api/connections/trello`, which requires: same origin, signed-in owner/admin, and the one-time cookie from `/start`. The token is sealed immediately with the worker's public key and stored as a `pending` connection; the worker (`trello.verify`) opens it, calls Trello, and activates the connection (or deletes it if Trello rejects the token).
- Board and list pickers use `trello.listBoards` / `trello.listLists` through the worker; only **open** boards are offered. The chosen board/list are re-checked against Trello on save and stored as `connections.metadata.defaults` (`boardId, boardName, listId, listName`).
- Disconnect: the worker revokes the token at Trello (`DELETE /1/tokens/{token}`, best effort) and deletes our copy. A 401 later marks the connection `revoked` ("Reconnect needed").
- To verify manually (not automated): the real Trello consent screen and the *Allowed origins* requirement for `return_url`.

## As built (Phase 5)
- Delivery job `ticket.deliver` (one per issue x destination, worker). Labels are found by name on the board (case-insensitive) or created on first use: `P5 Critical` red, `P4 High` orange, `P3 Medium` yellow, `P2 Low` lime, `P1 Lowest` green, plus the type label; only the two a ticket needs are created, and their ids are remembered in `automation_destinations.config.labelIds`.
- The card is created with a JSON body (descriptions can exceed URL length): name (250 chars), markdown description (16,000), `due` = the date at 12:00 UTC, and the two label ids.
- Attachments: re-fetched from Crisp at delivery (the conversation is never stored), downloaded with `safeDownload` (host `storage.crisp.chat` only, 10 MB cap) and uploaded as multipart. Over 10 MB → added as a link attachment and noted in the activity log. Files from any other host are dropped, never linked.
- Errors: 401 → connection `revoked`, ticket `failed`, no retry. 404 (list/board gone) → `broken`, never recreated. 429/5xx → retried with backoff (5 attempts), then `failed`. 400 → `failed` with a plain message.

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

# 0016 — Linear: connected as the TriageFox app, P1 maps to Low, new issues go to Triage
- **Status:** Accepted
- **Date:** 2026-11-19

## Context
Linear is the next destination after Trello and Jira ([plan](../plans/2026-11-19-linear-destination.md)). Three choices had no obvious default: whose name new issues carry, how our five priority levels fit Linear's four, and where new issues land.

## Decision
- **Connected as the app** (`actor=app` in Linear's OAuth): issues and comments show "TriageFox" as their creator, and the connection does not depend on the person who connected staying in the company. Connecting needs a Linear workspace admin; the Connect page says so before sending the user to Linear.
- **Priority:** P5 → Urgent, P4 → High, P3 → Medium, P2 → Low, **P1 → Low**. The ticket text keeps "Priority: 1 (Lowest)" and the reason, so nothing is lost.
- **Starting state:** the team's **Triage** inbox when the team has triage switched on, otherwise the team's default state. The customer can pick another starting state in the setup.
- Scopes: `read`, `issues:create`, `comments:create` only.

## Alternatives considered
- **Connected as the user:** any member could connect, but every ticket would look as if that person wrote it, and the connection would break when they leave.
- **P1 → "No priority":** keeps five distinct values, but in Linear "No priority" usually means "not looked at yet", which misleads.
- **Always the default state:** simpler, but skips Linear's own inbox built for incoming reports.

## Consequences
- Non-admins see a clear message instead of a failed Linear consent screen.
- The human-edit check compares the description with a hash of what we last wrote, so it does not depend on telling our edits apart in Linear's history.
- Linear refresh tokens expire 30 days after issue, so the connection keep-alive job (same plan) is required before Linear ships.

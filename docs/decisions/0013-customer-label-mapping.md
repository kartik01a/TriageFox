# 0013 — Customers choose the labels on their tickets
- **Status:** Accepted
- **Date:** 2026-11-03

## Context
Requirements §5 fixed the ticket labels: Trello cards got `P1 Lowest` … `P5 Critical` plus a type label (`Bug`, `Feature`, …), and Jira issues got the type as a label. Teams already have their own labels: some use only High / Medium / Low, or call feature requests "Modification". The owner asked for a way to use those instead.

## Decision
- **The AI does not change.** It still rates priority 1–5 with the fixed rubric and picks one of the fixed types (docs/ai-triage.md), so the evals stay meaningful. The customer's choice only changes what appears on the ticket.
- **Trello:** on the Trello connection page, each priority level and each type maps to a label on the chosen board, or to "No label". Several levels can share a label (Critical and High → "High"). Existing board labels are listed; a new one can be created from the page (name + colour). Saved as `connections.metadata.defaults.labels`, copied into the automation's destination as `labelMap`.
- **Jira:** priority already maps to the project's Jira priorities. Each type now maps to a Jira label (listed from the site, or typed: no spaces) or none, saved as `defaults.typeLabels`. `from-chat` is always added.
- **Defaults stay as they were.** A level or type the customer did not set gets the old default label, so nobody's tickets change until they choose.
- The web app checks every chosen Trello label id against the board before saving; a label deleted from the board later is skipped and the card is still created.
- Changing the Trello board clears the Trello choice (label ids belong to one board); the Jira choice is kept (Jira labels are site-wide).

## Alternatives considered
- **Let the AI choose between the customer's own levels:** every team would get a different rubric, the evals could not measure it, and "High" means different things to different teams.
- **Rename the default labels only:** would not allow merging levels or "no label".

## Consequences
- Requirements §5 now describes the 1–5 scale as internal, with the labels configurable.
- When a follow-up changes the priority, every label that stands for a priority (default or chosen) is swapped for the new one.

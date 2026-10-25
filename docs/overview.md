# Overview

## Problem

Product teams collect customer feedback through tools like **Featurebase** (an in-app Messenger chat plus a public feedback board). Customers report things like "this form isn't working", "the UI is bad on mobile", or "please add CSV export". Someone then has to read every chat, decide whether it needs engineering work, and hand-create a ticket in Trello or Jira — copying details, guessing a priority, attaching screenshots. It's slow, inconsistent, and duplicate reports pile up.

## Vision

A SaaS where any team can sign up, connect a **source** (Featurebase) to one or more **destinations** (Trello, Jira), pay, and switch on an automation. From then on:

- Every chat and feedback post is read by AI.
- If it needs a **code change** (bug, UI/UX, feature, improvement, performance, deployment/infra, security, data issue) a ticket is created automatically with:
  - type label, priority 1–5 (5 = highest), clear title and description
  - steps to reproduce / expected / actual (for bugs)
  - all screenshots and files the customer attached
  - a due date **only if the customer explicitly asked for one**
- If the customer adds more detail later, the **same ticket is updated**.
- If many customers report the same thing, it becomes **one ticket** with a report count, not many.
- If both Trello and Jira are connected, **both get the same ticket**.

## Users

- **Primary:** small/medium SaaS teams already using Featurebase who track work in Trello or Jira.
- **Roles inside a workspace:** owner (billing), admin (connections + automations), member (view activity, review queue).

## In scope (MVP)

- Sign-up, workspaces (teams), invites
- Source: Featurebase (Messenger conversations + feedback posts)
- Destinations: Trello, Jira Cloud
- AI triage, ticket creation, linked updates, duplicate merging
- Automation settings (include Featurebase link, include customer names)
- Activity log, review queue, dry run
- Stripe billing with paywall on enabling automations

## Out of scope (MVP) — see [roadmap.md](roadmap.md)

- Two-way sync (ticket status → Featurebase / customer)
- Routing rules (bugs → Jira, features → Trello)
- Other sources/destinations (Linear, GitHub, Intercom, …)
- Jira Server / Data Center
- Backfilling historical conversations

## Project context

Starts as a personal / portfolio project (resume + YouTube), built to production quality so it can launch as a paid SaaS. No deadline — ship when every integration is verified working. Business model (open-source vs SaaS vs open-core) to be decided after a market analysis.

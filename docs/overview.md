# Overview

## Problem

Small teams talk to customers through live-chat tools like **Crisp**. Customers report things like "this form isn't working", "the UI is broken on mobile", or "please add CSV export". Someone then has to read every chat, decide whether it needs engineering work, and create a Trello card or Jira issue by hand: copying details, guessing a priority, attaching screenshots. It's slow and inconsistent, and duplicate reports pile up.

## Vision

**An open-source AI that turns customer chats into Trello and Jira tickets.** Teams connect a **source** (a support or chat tool) to one or more **destinations** (issue trackers) and switch the automation on. From then on:

- AI reads every conversation.
- If it needs a **code change** (bug, UI/UX, feature, improvement, performance, deployment/infra, security, data issue), a ticket is created automatically. It has:
  - a type label, a priority from 1 to 5 (5 = highest), and a clear title and description
  - steps to reproduce, expected and actual behaviour (for bugs)
  - every screenshot and file the customer attached
  - a due date **only if the customer explicitly asked for one**
- If the customer adds detail later, the **same ticket is updated**.
- If many customers report the same thing, it becomes **one ticket** with a report count.
- If both Trello and Jira are connected, **both get the same ticket**.

## Business model: open source with a paid hosted version

- The code is **public under AGPL-3.0** ([decisions/0005](decisions/0005-open-core-agpl.md)). Anyone can self-host it for free and use their own AI key.
- We sell a **hosted version** for teams that don't want to run servers or register their own developer apps.
- **Global from day one**: priced in USD, payments through a merchant of record ([decisions/0008](decisions/0008-billing-merchant-of-record.md)).

## Users

- **Primary:** small and medium SaaS or e-commerce teams that use Crisp for support and Trello or Jira for work tracking.
- **Self-hosters:** developers and open-source fans. They're the community and the audience for the build-in-public series.
- **Roles inside a workspace:** owner (billing), admin (connections + automations), member (view activity, review queue).

## In scope (MVP)

- Sign-up, workspaces (teams), invites
- **Source: Crisp** conversations ([decisions/0006](decisions/0006-crisp-as-mvp-source.md))
- **Destinations: Trello, Jira Cloud**
- AI triage, ticket creation, linked updates, duplicate merging
- Automation settings (include conversation link, include customer names)
- Activity log, review queue, dry run
- Self-host package (Docker Compose, bring your own OpenAI key)
- Hosted version with billing and free-tier limits

## Out of scope (MVP), see [roadmap.md](roadmap.md)

- More sources: Chatwoot, tawk.to, Featurebase, Freshdesk, Intercom, Zendesk, …
- More destinations: Linear, GitHub Issues, ClickUp, Asana, Notion, …
- Two-way sync (ticket status flowing back to the chat or customer)
- Routing rules (bugs → Jira, features → Trello)
- Jira Server / Data Center
- Backfilling historical conversations

## Project context

Built by a solo developer in India. It starts as a portfolio and YouTube project, built to production quality, with the goal of earning money from the hosted version. Budget: about ₹1,000/month. No deadline. Ship when every integration has been checked and works.

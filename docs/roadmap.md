# Roadmap

## MVP build phases

Each phase ends with something you can check before moving on.

| # | Phase | Work | Done when |
|---|---|---|---|
| 0 | **API spike** | Crisp: free plugin dev token, plugin hooks on a free workspace, REST routes, file URLs, settings-page linking. Trello authorize flow. Jira 3LO + createmeta. Open questions in [integrations/](integrations/). | Notes + real payload samples saved. Crisp confirmed free to test (otherwise switch to Chatwoot) |
| 1 | **Foundation** | Monorepo, Docker Compose dev environment, DB schema + migrations, Better Auth + workspaces/invites, crypto package, CI, Sentry, AGPL `LICENSE`, design system setup (Tailwind + shadcn/ui + Motion, brand tokens), **landing v0 with waitlist + Crisp support widget** ([ui-ux.md](ui-ux.md), [own-support.md](own-support.md)) | Sign up, create a workspace, invite a member; waitlist page live |
| 2 | **Connections** | Crisp (plugin install + link website), Trello (authorize + board/list picker), Jira (OAuth + project/types + required-field check), OpenAI key entry | All 3 connect; bad setup gives a clear error; secrets never reach the browser |
| 3 | **Ingest + queue** | Crisp hook route, signature check, dedupe event store, threads, debounce, per-thread lock, conversation fetch, reconcile job | Same hook ×3 → 1 evaluation; 5 quick messages → 1 evaluation; a dropped hook is recovered |
| 4 | **AI triage** | Schema, prompt + rubric, ticket rules, image input, date resolver, bring-your-own key, eval runner + labelled set | Eval targets met |
| 5 | **Ticket creation** | Trello + Jira destinations, labels, priority mapping, markdown→ADF, attachments, fan-out, no double-creates | A real Crisp chat → a complete Trello card **and** Jira issue |
| 6 | **Updates + duplicates** | Linked updates/comments, human-edit check, embeddings, duplicate merging, toggles | A follow-up updates the ticket; a 2nd customer adds a comment |
| 7 | **Dashboard** | App UI per [ui-ux.md](ui-ux.md): onboarding wizard, integrations page, overview, activity log, review queue, dry run, connections, settings (incl. own-key entry) | A new user sets up without help |
| 8 | **Self-host package** | Production `docker-compose.yml` + Caddy, setup script (generates master key), `APP_MODE`, self-host guide (create your own Crisp plugin / Trello key / Atlassian app), README with demo GIF | A fresh VM runs it by following the guide |
| 9 | **Billing + admin (hosted)** | MoR (Dodo) checkout, portal, webhooks; trial; plan limits + usage metering; **plans / trial / platform settings in DB + admin routes + simple admin UI** ([0009](decisions/0009-config-in-db-admin-routes.md)); **own-support admin inbox + email/Slack alerts** ([own-support.md](own-support.md)); billing page with Monthly/Yearly toggle | Limits enforced; changing trial days or a price via admin takes effect without a deploy |
| 10 | **Hardening + launch** | Rate limiting, backoff, revoked-token handling, alerts, **full animated landing + pricing page** ([ui-ux.md](ui-ux.md)), privacy policy/terms, `SECURITY.md`, submit to the Crisp Marketplace, **flip the repo public** (checklist below) | Revoking Trello mid-run → clean pause, no lost events; landing scores ≥ 90 in Lighthouse; plugin submitted |

### Making the repo public (end of Phase 10)
The repo stays **private** while building, so the first public version is complete and working.
- [ ] triagefox.com bought; hosted version deployed and working end to end
- [ ] `gitleaks detect` over the **full git history** shows nothing (rotate any secret ever committed, even if later deleted)
- [ ] No private material in pushed files (`docs/private/` and `marketing/` are git-ignored; check `docs/` reads well for the public)
- [ ] README (demo GIF, self-host guide, hosted link), `LICENSE` (AGPL-3.0), `SECURITY.md`, `CONTRIBUTING.md` + CLA, issue templates
- [ ] Turn on CodeQL, secret scanning + push protection, Dependabot alerts, branch protection
- [ ] Then flip to public and start launch week (marketing/launch-checklist.md)

### Progress
- Phase 0: done (2026-10-25).
- Phase 1: done (2026-10-26). Scope notes: the schema created so far covers tenancy/auth (Better Auth), `platform_settings` (seeded `signupEnabled`), `audit_log` (RLS) and `waitlist_signups`. Tables for plans, subscriptions, connections, automations, threads, issues and the rest are created in the phase that first uses them (each with RLS where tenant-scoped). 2FA UI, step-up re-auth and "Require 2FA" stay in Phase 7 as planned (the 2FA plugin and schema are already enabled).

- Phase 2: done (2026-10-26). Crisp linking (iframe widget + one-time ticket), Trello and Jira OAuth with board/project pickers and required-field checks, OpenAI key entry, disconnect/revoke/health check, web↔worker channel. Scope note: chosen targets are stored per connection (`metadata.defaults`); the wizard copies them into automations in Phase 7. Owner tasks: [setup/providers.md](setup/providers.md).

- Phase 3: done (2026-10-26). Signed hook route, IDs-only event store, threads, debounced evaluation, per-thread lock, full conversation fetch, reconcile, cleanup, SSRF guard. The AI step is a single seam (`triage` in `apps/worker/src/pipeline/deps.ts`) filled in Phase 4. Scope note: `automations` rows are created by tests/scripts until the Phase 7 wizard; the hook URL in the Crisp Marketplace must be switched to `/api/webhooks/crisp`.

- Phase 4: done (2026-10-26). `packages/ai` (prompt, schema, redaction, date resolver, cost, model policy), worker step with own-key/platform-key selection and cost guardrails, `ai_runs` + `activity_log` (RLS, sealed output, 30-day clearing), 154-case eval set. Eval targets met. Scope note: nothing is sent to Trello/Jira yet (Phase 5).
- Phase 5: done (2026-10-27). Trello + Jira delivery, labels, priority mapping, in-house markdown→ADF, attachments, fan-out, idempotent creation, `issues` / `destination_tickets` / `automation_destinations` with RLS. Scope note: updates and duplicates are Phase 6; `pnpm db:dev-automation` stands in for the wizard until Phase 7.

## Integrations roadmap

We add integrations **one at a time** after the MVP. Each new integration widens the market. Order is chosen by: free to test → user base → gap (no strong built-in AI ticketing) → a marketplace that brings users. The checklist is in [integrations/adding-a-connector.md](integrations/adding-a-connector.md).

### Sources (support / chat tools)
| Order | Tool | Status | Why / notes |
|---|---|---|---|
| 1 | **Crisp** | **MVP** | Free dev token, SMB customers who pay for tools, Marketplace. Competitor plugin "Jira Boss AI" shows demand |
| 2 | **Chatwoot** | Next | Open source, free to self-host and test; only a manual Linear integration exists; matches our self-host audience |
| 3 | **tawk.to** | Planned | Free and very widely installed; signed webhooks include full transcripts; REST API in private beta |
| 4 | **Featurebase** | Planned | Chat → ticket isn't direct, Trello isn't native. Needs a paid plan for API access, so ask for a partner workspace ([integrations/featurebase.md](integrations/featurebase.md)) |
| 5 | **Freshdesk** | Planned | Free plan with API; has a native Jira app, so we compete on AI quality and Trello support |
| 6 | **Intercom** | Planned | Large; native Jira app is mostly manual; free developer workspace |
| 7 | **Zendesk** | Planned | Large; enterprise-heavy; native Jira integration exists |
| — | Help Scout, Zoho Desk, LiveChat, Front, HubSpot inbox, email inbox, Slack channel, Typeform / Google Forms, GitHub Discussions | Ideas | Assess when the list above is done |

### Destinations (issue trackers)
| Order | Tool | Status |
|---|---|---|
| 1 | **Trello** | **MVP** |
| 1 | **Jira Cloud** | **MVP** |
| 2 | Linear | Next (popular with startups, good API, OAuth) |
| 3 | GitHub Issues | Planned (GitHub App; great for open-source/dev audience) |
| 4 | ClickUp | Planned |
| 5 | Asana | Planned |
| 6 | Notion (databases) | Planned |
| 7 | GitLab | Planned |
| — | Monday, Azure DevOps, Shortcut, Jira Data Center | Ideas |

### Notifications
Slack and Discord alerts (e.g. for P5 Critical tickets) and an email digest. Planned after the first extra source.

## Future updates (product features)

Not in v1. Add new ideas here.

- **Two-way sync**: ticket marked done → update the conversation / notify the customer.
- **Routing rules**: e.g. bugs → Jira, features → Trello; filters by type or priority.
- **Automatic priority bump** based on the duplicate report count.
- **Custom AI instructions** per workspace ("our checkout is critical", a glossary of product areas).
- **Other AI providers** (DeepSeek for text-only, Anthropic) through the provider interface.
- **Analytics**: top bugs, volume by type, time to ticket.
- **Backfill** of historical conversations when an automation is enabled.
- **Duplicate search across the whole destination backlog**, not just tickets we created.
- Optional Trello Power-Up (a badge showing the source conversation) for a listing in the Power-Up directory.
- **TriageFox Inbox for customers**: offer the internal inbox (built for our own support) as a destination for teams that don't use Jira or Trello.
- **"Ask TriageFox"** docs-answering chat bot for our own support (or upgrade to Crisp Mini for its AI answers).

## Business & launch track

- Business analysis and pricing: `docs/private/` (not pushed).
- Marketing plan, YouTube scripts, launch posts, outreach: `marketing/` (not pushed).

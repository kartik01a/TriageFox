# UI / UX Plan

Two very different surfaces:
- **Customer-facing (landing, pricing, onboarding, app):** polished and trustworthy. The landing page should make visitors think *"wow, I should at least try the free trial"*.
- **Admin:** simple default components, no polish.

## Principles
1. **Show, don't tell.** The landing page *shows* a chat turning into a ticket within seconds.
2. **Trust first.** Customers connect their Jira and Trello. We show security, open source, and an activity log that explains every AI decision.
3. **Zero-jargon copy.** Say "decides if it's a real bug", not "LLM classification". Explain "triage" once.
4. **Fast.** Animations never slow the page. Landing LCP < 2.5 s, Lighthouse ≥ 90.
5. **Calm app, exciting landing.** The dashboard is clean and quiet; the delight lives on the marketing pages and in key moments (first ticket created).
6. **Accessible:** WCAG AA contrast, full keyboard support, visible focus, `prefers-reduced-motion` respected everywhere.

## Brand
- **Name / mascot:** TriageFox: a simple geometric fox head. It can "sniff out" bugs in animations.
- **Colours** (design tokens; light + dark):
  - Fox orange accent (~`#F26B1D`) for CTAs and highlights
  - Neutral slate greys for text and surfaces
  - Priority colours reused from the product: green → lime → yellow → orange → red (P1→P5)
- **Type:** Inter or Geist (via `next/font`), with a mono font for code and terminal snippets.
- **Icons:** Lucide.
- **Illustration style:** flat, rounded cards (chat bubbles, ticket cards) rather than stock photos.

## Stack
- **Tailwind CSS** + **shadcn/ui** (Radix primitives: accessible by default, fully customisable).
- **Motion** (Framer Motion) for animations: layout/morph transitions, scroll-triggered reveals, number counters.
- **react-hook-form + zod** for forms (same schemas as the API).
- **Fumadocs** (or Nextra) for the docs and self-host guide at `/docs`.
- OG images with `next/og`.

## Route map
| Group | Routes |
|---|---|
| Marketing `(marketing)` | `/` landing · `/pricing` · `/integrations` · `/integrations/crisp-to-jira`, `/integrations/crisp-to-trello` (search-friendly guide pages) · `/docs` · `/changelog` · `/legal/privacy`, `/legal/terms` · `/waitlist` (pre-launch) |
| Auth `(auth)` | `/login` · `/signup` · `/forgot-password` (Google sign-in + email/password) |
| App `(dashboard)` | `/app` overview · `/app/onboarding` · `/app/integrations` · `/app/automations/[id]` · `/app/activity` · `/app/review` · `/app/settings` (workspace, members, AI key) · `/app/billing` |
| Admin | `/admin` (simple; see bottom) |

---

## Landing page (`/`)

Sections in order:

### 1. Nav
Sticky, transparent → blurred background on scroll. Logo · Features · Pricing · Docs · GitHub ★ (live star count) · **Start free trial**.

### 2. Hero, the "wow" moment
- **Headline:** "Customer chats in. Perfect tickets out."
- **Sub:** "TriageFox reads your Crisp conversations and creates Jira & Trello tickets for real bugs and feature requests, with priority, steps to reproduce and screenshots."
- **CTAs:** **Start free: no card needed** (primary) · **View on GitHub** (secondary) · small line: "Open source · Self-host free".
- **Hero animation** (looping, ~8 s, built with Motion and real HTML, not a video, so it's sharp and fast):
  1. A chat panel: a customer bubble types *"Checkout button does nothing on Safari 😡"* and drops in a screenshot thumbnail.
  2. A fox-orange scan line sweeps over the message ("reading…").
  3. The bubble **morphs** (shared-layout animation) into a ticket card on the right.
  4. Fields fill in one by one: **Bug** label pops in → **P4 High** chip slides in (orange) → steps-to-reproduce lines type out → the screenshot thumbnail flies into the card.
  5. Tiny Jira + Trello icons light up: "Created in Jira & Trello".
  6. Second loop variant: a "how do I reset my password?" bubble gets a soft grey "No ticket needed: answered in chat" tag.
- Reduced motion: a static before/after composition.

### 3. "Works with" strip
Crisp · Jira · Trello, plus faded "Coming soon": Chatwoot, Linear, GitHub Issues, tawk.to… Follow each brand's logo usage guidelines.

### 4. Problem → solution
A **before/after slider** the visitor can drag: *Before*, a messy screen of copy-paste between chat and Jira. *After*, a clean auto-generated ticket.

### 5. Features (6 cards, staggered reveal on scroll)
| Card | Micro-animation |
|---|---|
| Understands the chat (bug vs question) | Two bubbles sorted into "Ticket" / "Answer in chat" |
| Priority 1–5 by clear rules | Priority chip cycling green → red |
| Screenshots attached automatically | Thumbnail sliding into a card |
| Keeps the same ticket updated | Comment bubble appearing on a ticket |
| Merges duplicates | Counter "Reported by 1 → 5 customers" |
| Never invents due dates | A date only appears when the quote "by Friday" is highlighted |

### 6. How it works (3 steps, scroll-linked progress line)
**Connect Crisp → Connect Jira or Trello → Enable.** "Five-minute setup", with small wizard screenshots.

### 7. Trust
- Activity log screenshot: "Every decision explained".
- Review queue: "Unsure? It asks you first".
- Security bullets: encrypted credentials · you choose what goes into tickets (toggles) · open source, read the code.

### 8. Open source
Terminal card that types `git clone … && docker compose up -d` → "✓ TriageFox running on localhost:3000". GitHub stars badge. "Self-host free forever, or let us host it."

### 9. Pricing preview
Same Monthly / Yearly toggle as `/pricing`, showing the three main plans → "See all plans".

### 10. FAQ (accordion)
What counts as a conversation? · Does it work with my Jira setup? · What does the AI see? · Can I use my own OpenAI key? · What happens at my limit? · Is my data safe?

### 11. Final CTA band
"Stop copy-pasting bugs." → **Start free trial**.

### 12. Footer
Product · Docs · GitHub · Changelog · Privacy · Terms · Contact · "Made in India 🇮🇳 by [name]".

**Pre-launch (landing v0, Phase 1):** hero + three feature cards + **waitlist form**, so marketing can start early.

---

## Pricing page (`/pricing`)

```
           [ Monthly | Yearly  · 2 months free ]        ← default: Yearly
           [ TriageFox AI | Use my own OpenAI key ]

  ┌ Starter ┐   ┌ Pro ★ Most popular ┐   ┌ Business ┐      ← own-key tab: Starter / Pro / Unlimited
  │ $7.50/mo│   │ $20/mo              │   │ $49.17/mo │       (yearly shows per-month equivalent
  │ billed  │   │ billed $240/year    │   │ ...       │        + "billed $X yearly")
  │ $90/yr  │   │                     │   │           │
  │ 300 conv│   │ 1,500 conversations │   │ 5,000     │
  │ 1 inbox │   │ 3 connected inboxes │   │ 10 inboxes│
  │ [Start  │   │ [Start free trial]  │   │ [Start…]  │
  └─────────┘   └─────────────────────┘   └───────────┘
       ✓ Every plan includes every feature (checklist)
       Self-host: free forever → [Read the guide]
```

- **Two toggles:** billing period (animated sliding pill; prices count up/down when switched) and AI source (TriageFox AI / own key).
- On the own-key tab, an info line: "You pay OpenAI directly: roughly $X per 1,000 conversations."
- Plans, prices and badges come from the **DB** (admin-managed); nothing is hard-coded.
- Below the cards: a full comparison table, a "Need more than 5,000? Contact us" row, and a pricing FAQ.
- Prices shown in USD, "+ tax where applicable".

---

## Onboarding wizard (`/app/onboarding`)

A left-side stepper with progress; every step saves, so users can leave and resume.

| Step | Screen | Details |
|---|---|---|
| 1 | Workspace | Name, timezone (auto-detected) |
| 2 | **Connect your inbox** | Integration cards (Crisp active; others "Coming soon" with a **"Notify me / vote"** button, which tells us what to build next). Crisp → "Install from Crisp Marketplace" → a **live waiting state** ("Waiting for Crisp… ●●●") that turns into ✓ Connected with a small success animation |
| 3 | **Connect destinations** | Trello and Jira cards with **Connect** buttons (OAuth pop-ups); pick one or both |
| 4 | Map | Trello: board + list. Jira: project, issue types, priorities. Priority mapping shown as coloured chips P1–P5 |
| 5 | Ticket settings | Toggles (*Include conversation link*, *Include customer names*) with a **live ticket preview** that changes as you flip them |
| 6 | AI | "Use TriageFox AI (included)" or "Use my own OpenAI key": paste → validates against our models (spinner → ✓) → masked `sk-…1234` |
| 7 | **Dry run** (the second wow moment) | Runs on your last 10 Crisp conversations and shows a table: *would create ticket (P4 Bug)* / *skip: how-to question*. Click a row to preview the ticket |
| 8 | Enable | Big toggle → subtle confetti → "We'll create your first ticket as soon as a customer reports a bug." |

---

## App pages

| Page | Contents |
|---|---|
| **Overview** `/app` | Usage meter (conversations used / limit, trial days left), this month's tickets created / updated / skipped / duplicates merged, "time saved" estimate, recent activity, connection health badges |
| **Integrations** `/app/integrations` | Grid of all integrations: Connected / Available / Coming soon (+ vote). Each card: status, last checked, Reconnect / Disconnect |
| **Automation** `/app/automations/[id]` | Source → destinations diagram, settings toggles, mappings, pause/resume, per-destination health |
| **Activity log** `/app/activity` | Timeline with filters (Created · Updated · Skipped · Duplicate · Error); each row expands to show the AI's reason, priority reason, links to the ticket and the Crisp conversation |
| **Review queue** `/app/review` | Cards for unsure cases: summary, suggested type/priority (editable), **Create** / **Dismiss** |
| **Settings** `/app/settings` | Workspace, members & roles, AI key (masked, replace/remove, last verified), notification emails |
| **Billing** `/app/billing` | Current plan, usage, trial status, the same Monthly/Yearly + own-key toggles to change plan, "Manage payment" (MoR portal), invoices |

**States, designed for every page:**
- **Empty:** illustration + one clear action ("Connect Crisp to get started").
- **Loading:** skeletons, not spinners.
- **Errors:** plain words + a fix button ("Jira access expired → Reconnect").
- **Limits:** banner at 80% and 100% with Upgrade / Add own key.

**Key-moment delight (small, rare):** first ticket created → toast with a mini fox animation + "View in Jira". Nothing else animates in the app beyond subtle transitions.

**Responsive:** landing and pricing fully mobile-first; the app works well on tablets and is usable on phones (activity log and review queue especially).

---

## Admin (`/admin`): deliberately simple
Plain shadcn tables and forms, no animation, no custom styling:
- **Settings:** trial days, trial conversation cap, card required (toggle), unlimited trial with own key (toggle), trial AI budget, platform AI ceiling, sign-ups on/off.
- **Plans:** table + edit form (creates a new version), visibility, "most popular", order, MoR price IDs.
- **Workspaces:** search, plan, usage, trial end, actions (extend trial, pause/resume).
- **AI spend:** this month, by platform, trials and top workspaces.

---

## Design process
1. **Before Phase 7:** low-fidelity wireframes of onboarding + app pages → review together. They can be clickable HTML mockups.
2. **Phase 1:** landing v0 + design tokens.
3. **Phase 7:** build app pages from the wireframes.
4. **Phase 10:** full landing with animations + pricing page; record the demo video from the real product.
5. Before launch: test the landing on a slow phone connection, run Lighthouse, check reduced-motion mode.

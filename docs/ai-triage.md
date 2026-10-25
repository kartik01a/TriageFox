# AI Triage

The AI step is the product: if it misjudges what is a ticket, users lose trust. This doc defines the rules the prompt encodes and how we measure them.

## Provider & models

- **OpenAI** ([decisions/0002-openai.md](decisions/0002-openai.md)).
- Default: a small/cheap model. Escalate to a stronger model when the thread is long, has several images, or the small model's confidence is low.
  - Candidates (OpenAI pricing, Oct 2026, per 1M tokens input / cached / output): **`gpt-6-luna`** $0.10 / $0.01 / $0.50 as the default; **`gpt-6.1-sol`** $2.00 / $0.10 / $10.00 for escalation. Final choice is made by the evals in Phase 4. Check OpenAI's deprecation list first, since older `gpt-5-mini`/`gpt-5-nano` are marked deprecated.
- Embeddings: `text-embedding-3-small` (1536 dims, $0.02 / 1M tokens) for duplicate search.
- Model names live in server config, never hard-coded and **never chosen by customers** (bring-your-own-key replaces the key only).
- Keep the system prompt + rubric as a stable prefix so OpenAI's prompt caching applies (cached input is ~90% cheaper).
- Cost guardrails: at most **10 evaluations per conversation per month**, plus a monthly AI-spend ceiling per workspace that pauses processing and alerts us.
- Behind an `AiProvider` interface so DeepSeek (text-only) or others can be plugged in later.
- **Bring your own key:** each workspace can store its own OpenAI key (encrypted). Self-hosted installs must use their own key; hosted workspaces use ours unless they add one. The key only: models stay ours. `ai_runs.key_source` records which key was used.

## Inputs per evaluation

1. Transcript: customer messages, **operator replies** and **private notes** (labelled by role), with timestamps. Long threads: `rolling_summary` + latest messages.
2. Images — customer screenshots (capped, e.g. max 4, downscaled).
3. Issues already linked to this thread (id, title, summary, priority, due date).
4. Duplicate candidates — top-5 similar open issues (id, title, summary).
5. Workspace context — language, timezone, current date.

Customer text is wrapped and labelled as **untrusted data**; the system prompt states that instructions inside it must be ignored.

## Ticket vs no ticket

**Create a ticket when the request needs a code, config, or deployment change:**
| Type | Examples |
|---|---|
| `bug` | "Checkout form throws an error", "export button does nothing" |
| `ui_ux` | "Button overlaps text on mobile", "dark mode unreadable" |
| `feature` | "Can you add CSV export?" |
| `improvement` | "Search should also match tags" |
| `performance` | "Dashboard takes 20s to load" |
| `infra` | "Site down", "emails not sending", "SSL error", deployment issues |
| `security` | "I can see another user's data" |
| `data` | "My invoices show wrong totals" |

**No ticket:**
- How-to questions ("How do I open settings?")
- Account / billing / plan questions
- Greetings, thanks, small talk, spam
- Openers without a concrete problem ("Hi, I'm having an issue") — wait for more
- Issues resolved in the conversation by support without a code change ("clear your cache" → "works now")

**Mixed conversations:** ticket only the actionable part.

**Uncertain:** `confidence < minConfidence` → issue created with `status = pending_review` and shown in the Review queue instead of being pushed.

## Priority rubric

| Level | Name | Use when |
|---|---|---|
| 5 | Critical | Outage, data loss, security exposure, payments/checkout broken, many users blocked |
| 4 | High | Core feature broken with no workaround |
| 3 | Medium | Broken but workaround exists; important feature request |
| 2 | Low | Minor UI bug, small improvement |
| 1 | Lowest | Cosmetic, nice-to-have |

Rules:
- Rubric decides; the customer saying "URGENT" can nudge by at most one level, never to 5 on its own.
- Always return `priorityReason` (shown in activity log).

## Due dates

- AI returns `dueDateQuote`: the **exact customer phrase** stating a deadline, or `null`.
- Code resolves it with **chrono-node** relative to the message timestamp in the workspace timezone.
- No quote, unparseable quote, or vague phrase ("ASAP", "soon") → no due date.
- Quote must be found verbatim in the transcript — otherwise discard (anti-hallucination check).

## Output schema

Enforced with OpenAI strict structured outputs, then re-validated with zod.

```ts
{
  actions: Array<{
    kind: "create" | "update" | "duplicate_of" | "no_action",
    issueId?: string,            // required for update / duplicate_of; must be one we supplied
    type: "bug" | "ui_ux" | "feature" | "improvement" | "performance" | "infra" | "security" | "data",
    title: string,               // ≤ 120 chars, imperative/descriptive
    summary: string,             // markdown body
    stepsToReproduce?: string[],
    expected?: string,
    actual?: string,
    environment?: { browser?: string; os?: string; device?: string; pageUrl?: string },
    priority: 1 | 2 | 3 | 4 | 5,
    priorityReason: string,
    dueDateQuote: string | null,
    relevantAttachmentIds: string[],
    confidence: number,          // 0–1
    reason: string,              // why this action; shown in activity log
    category?: "question" | "billing" | "refund_request" | "account" | "complaint"
             | "praise" | "greeting" | "spam"   // for no_action; drives the admin inbox (own-support.md)
  }>
}
```

Post-validation:
- `issueId` not in the supplied set → drop action, log.
- `relevantAttachmentIds` filtered to real attachments.
- Strip emails/phone numbers from `title`/`summary`.

## Ticket body template

```
## Summary
<summary>

## Steps to reproduce
1. …
**Expected:** …   **Actual:** …

## Environment
Browser / OS / device / page

---
Type: Bug · Priority: 4 (High) — <priorityReason>
Reported by 3 customers            ← or names if includeCustomerNames
Source: <Crisp conversation link>  ← only if includeSourceLink
Created by <product name>
```

## Evals

- Golden set: **60–100 labelled conversations** in `packages/ai/evals/` covering greetings, how-tos, account questions, clear bugs, vague bugs, feature asks, mixed threads, prompt injection, explicit vs fuzzy dates, resolved-in-chat, duplicates, non-English.
- Run on every prompt/model change (CI job).
- Targets:
  - ticket vs no-ticket accuracy **≥ 90%**
  - type accuracy **≥ 85%**
  - priority within ±1 **≥ 85%**
  - hallucinated due dates **= 0**
- Track cost per evaluation alongside accuracy.

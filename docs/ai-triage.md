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

## As built in Phase 4

- **`packages/ai`** (no DB, no queue; the worker wires it in): `triage(provider, input, options)` returns validated actions.
  - **Prompt** (`prompt.ts`): fixed system prompt with the rubric. The conversation is fenced with a random boundary per call and declared untrusted data. Emails, phones and card numbers are redacted *before* anything is sent (`redact.ts`). At most 4 images are shown.
  - **Output** (`schema.ts`, `postprocess.ts`): strict JSON schema, re-validated with zod. `cleanOutput` drops unknown ids and invalid actions and clamps text. The model is never trusted.
  - **Due dates** (`dates.ts`): the model only returns a quote. Code checks the quote appears word for word in a *customer* message, then resolves it with chrono-node (en/es/de/fr/pt, workspace time zone). Vague phrases ("soon", "end of Q4") give no date.
  - **Models** (`triage.ts`): the cheap model (`AI_MODEL_DEFAULT`, reasoning effort low) first. The strong model (`AI_MODEL_ESCALATION`) is used straight away for large or image-heavy conversations (> 30 messages, > 12,000 characters, > 2 images), and as a second opinion when confidence is below 0.7 or the answer is unusable. Customers never choose models.
  - **Cost**: `pricing.ts` converts token usage to USD.
- **Worker step** (`apps/worker/src/pipeline/triage.ts`) is the `triage` seam from Phase 3:
  1. Guardrail: at most `AI_MAX_RUNS_PER_THREAD_PER_MONTH` (10) analyses per conversation per 30 days.
  2. Key: the workspace's own key (`ai_settings`, opened only here) else the platform `OPENAI_API_KEY`; none → activity entry and the job stops retrying.
  3. Platform key only: stop when the workspace spent `AI_PLATFORM_DAILY_USD_PER_ORG` (default $1) in 24 h. Own keys are never capped by us.
  4. Crisp files are shown to the model only when the URL is `https://storage.crisp.chat/…`.
  5. Saves one `ai_runs` row (model, tokens, cost, key source, a decision with kinds/types/priorities only, and the model's full answer **sealed**) and plain-language `activity_log` rows ("Ticket proposed (bug, priority 3)."). No titles or message text in plain columns.
  6. Rejected or out-of-credit key → activity entry + stop retrying (the conversation is picked up again by reconcile once fixed). Rate limits and outages are retried with backoff.
  7. Sealed outputs are cleared after 30 days by the daily cleanup job (counts and cost stay).
- Nothing is created in Trello/Jira yet: that is Phase 5. Linked tickets and duplicate candidates are passed as empty lists until Phase 6.

## Evals

- Golden set: **60–100 labelled conversations** in `packages/ai/evals/` covering greetings, how-tos, account questions, clear bugs, vague bugs, feature asks, mixed threads, prompt injection, explicit vs fuzzy dates, resolved-in-chat, duplicates, non-English.
- Run on every prompt/model change (CI job).
- Targets:
  - ticket vs no-ticket accuracy **≥ 90%**
  - type accuracy **≥ 85%**
  - priority within ±1 **≥ 85%**
  - hallucinated due dates **= 0**
- Track cost per evaluation alongside accuracy.
- **As built:** 154 labelled cases in `packages/ai/evals/cases/` (no-ticket, bugs, features, priority, dates, injection, existing tickets, long conversations, images, non-English, boundary cases). Run `pnpm --filter @triagefox/ai eval` (needs `OPENAI_API_KEY`; about 2 minutes, about $0.03). Options: `--model luna|sol`, `--filter <tag>`, effort variants. Results go to `packages/ai/evals/results/` (git-ignored). The runner also fails on any personal data in the AI's output and on a wrong *set* of ticket actions (a spurious extra update counts as a miss).
- **Measured on the first full run** (luna, low effort, sol escalation): ticket vs no-ticket 99.4%, type 96.2%, priority ±1 98.1%, false due dates 0, personal data leaks 0, about $0.00016 per conversation, 1% escalated. The remaining misses are listed by the runner; two are genuinely ambiguous labels.
- Evals call the real API, so they are **not** in CI; run them by hand after any prompt, rubric or model change.

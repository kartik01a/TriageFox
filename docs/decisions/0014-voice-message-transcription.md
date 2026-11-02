# 0014 — Voice messages are turned into text for the AI
- **Status:** Accepted
- **Date:** 2026-11-03

## Context
Crisp customers can send voice messages. The AI reads text only, so a chat that is mostly a voice note ("I sent a voice message, please check") was judged a question and got no ticket. The owner tested exactly this and chose speech to text (the alternative was sending such chats to the Review page).

## Decision
- Before the AI decides, the worker downloads the customer's voice messages (safely, from Crisp's storage only) and sends them to OpenAI speech to text. The AI sees the words as the message text, marked "(voice message, transcribed)". The audio file is still attached to the ticket.
- **Never stored:** transcripts live in memory for that analysis only, like the conversation itself. A later analysis of the same chat transcribes again.
- **Model:** server configuration `AI_MODEL_TRANSCRIBE`, default **`gpt-transcribe`** ($0.0045 per minute). The owner asked for `gpt-4o-mini-transcribe`, but OpenAI has deprecated it (shuts down 26 February 2027); it can still be set in the same variable until then. Customers never choose models.
- **Limits:** the newest 3 voice messages per analysis, each up to 5 minutes and 25 MB. Longer or extra ones stay as attachments only; the activity log says so.
- **Key and cost:** the same OpenAI key as the rest of the analysis (the workspace's own, else the platform key). The cost is added to that analysis (`ai_runs.cost_micro_usd`) and counts against the same budgets and plan limits.
- **Failure:** an outage or a bad file skips that voice message and the analysis continues; a rejected key or missing credit pauses analysis exactly like any other AI call.

## Alternatives considered
- **Review queue for voice-only chats:** free, but a person must listen to every one.
- **Store transcripts (sealed) to avoid re-transcribing:** cheaper on long chats, but it would store what the customer said, which we never do.

## Consequences
- Requirements §13 and docs/ai-triage.md mention voice messages; the privacy page already names OpenAI as the AI processor.
- One prompt sentence was added; the eval suite was re-run (all targets met).

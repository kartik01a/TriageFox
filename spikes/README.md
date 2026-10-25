# Phase 0 spikes (throwaway)

Small scripts that answer the open questions in `docs/integrations/*.md` and `docs/security.md` §15. Not part of the product. Config comes from the root `.env` (see `.env.example`).

Run order, each needing only a free account:

| #   | Command                                                                                                      | Account needed                                                 | Answers                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `pnpm trello:url`, then `pnpm trello` (twice: boards/lists, then full probe)                                 | Trello + a Power-Up API key                                    | authorize flow, labels, due date, attachment limits, edit detection                  |
| 2   | `pnpm jira` (twice: auth + projects, then full probe)                                                        | Atlassian OAuth app + free Jira Cloud site                     | 3LO + refresh, createmeta, ADF, priority/duedate fields, attachment limit, `updated` |
| 3   | `pnpm openai`                                                                                                | OpenAI key                                                     | gpt-6-luna / gpt-6.1-sol access, image input, strict JSON, embeddings                |
| 4   | `pnpm crisp:hook` + `ngrok http --url=<your-static-domain> 3000`, chat on the Dev website, then `pnpm crisp` | Crisp + Marketplace developer account, `TriageFox Dev` website | free-plan plugin hooks, payloads, signature, REST routes, files, deep link           |

Raw captures land in `spikes/captured/` (git-ignored). Anonymise the useful ones into `spikes/fixtures/` before committing.

# Crisp Marketplace submission (hosted version)

Everything needed to publish the TriageFox plugin on the Crisp Marketplace, so any Crisp user can install it.
Fill the fields in the Crisp Marketplace developer dashboard (marketplace.crisp.chat → the TriageFox plugin) from this page. Field names on Crisp's side may differ slightly; if a field here has no match, skip it, and if Crisp asks for something not listed, note it at the end of this page.

Self-hosters do not need this page: a private plugin with a development token is enough for your own website ([providers.md](providers.md) "Crisp").

## 1. Listing

**Name:** TriageFox

**Short description** (one line):
> Turns customer chats into Jira and Trello tickets, automatically.

**Long description:**
> TriageFox reads your Crisp conversations and turns the ones that need a code change into clean tickets in Jira and Trello: bugs, UI problems, feature requests and performance issues. Questions like "how do I reset my password?" don't become tickets.
>
> Each ticket gets a clear title, a summary, steps to reproduce, a priority from 1 to 5 set by a fixed rubric, and the screenshots and files the customer sent. Voice notes are transcribed. A due date is added only when the customer actually named one ("by Friday"); TriageFox never invents dates.
>
> When the customer adds details later, the same ticket gets a comment instead of a new ticket, and edits your team made by hand are never overwritten. When a second customer reports the same bug, the first ticket shows "Reported by 2 customers" instead of a duplicate.
>
> You stay in control: an activity log explains every decision and its priority, low-confidence tickets wait in a review queue, and you can test the AI on your last 10 conversations before switching it on. Customer names and conversation links are off by default.
>
> Privacy by design: TriageFox does not store chat transcripts, keeps your Jira and Trello access encrypted, and only reads from Crisp (it never sends messages or changes conversations).
>
> TriageFox is open source (AGPL-3.0). Use the hosted version at triagefox.com, with a free trial, or run it on your own server.
>
> How to start: install the plugin, open TriageFox from your Crisp inbox, choose "Continue in TriageFox", then connect Jira or Trello.

**Category:** Productivity (or Developer tools / Integrations, whichever Crisp offers)

**Links:**

| Field | Value |
|---|---|
| Website | `https://triagefox.com` |
| Support | `https://triagefox.com/support` (help page with a contact form; email `support@triagefox.com`) |
| Documentation | `https://triagefox.com/integrations/crisp-to-jira` (the GitHub docs once the repository is public) |
| Privacy policy | `https://triagefox.com/legal/privacy` |
| Terms of service | `https://triagefox.com/legal/terms` |
| Security | `https://triagefox.com/security` |
| Source code (once the repository is public) | `https://github.com/kartik01a/TriageFox` |

**Price on Crisp:** free to install. The TriageFox subscription is bought on triagefox.com (free trial first), so there is nothing to charge through Crisp.

**Logo:** the fox mark as a square PNG. Ready-made copies (1024 and 512 px, white background) are in the git-ignored `marketing/crisp/` folder; re-make them from `apps/web/src/app/icon.svg` if needed.

**Screenshots (3 to 5).** Use the test workspace with real-looking but invented chats; no real customer data.
1. A Crisp chat next to the Trello card TriageFox made from it (title, steps, priority label, screenshot attached).
2. The same kind of ticket in Jira (priority field, labels, formatted description).
3. The Activity page, showing a ticket created, an update, a duplicate and a "no ticket" decision with its reason.
4. The Automation settings page (destinations, the "include customer names" and "include conversation link" switches with the preview).
5. The page Crisp opens inside the plugin (`/crisp/link`, "Continue in TriageFox"). Inside Crisp it only appears once the plugin is approved, so take this one in the browser.

## 2. Plugin settings

| Setting | Value |
|---|---|
| Widget | iFrame widget, definition `{ "version": "1.0", "url": "https://triagefox.com/crisp/link" }`, placed where operators see it (conversation sidebar). Crisp adds `website_id`, `token` and `locale`. |
| Web hook (production) | `https://triagefox.com/api/webhooks/crisp` |
| Hook events | `message:send`, `message:received`, `session:set_state` |
| Hook signing secret | Goes into `CRISP_HOOK_SECRET` on the server (web container). Never paste it anywhere else. |

## 3. Scopes: read-only, and why each is needed

TriageFox never writes to Crisp. Ask for **read** access only, and only for these routes (this is everything `packages/connectors/src/crisp.ts` calls). Pick the scope in Crisp's list that covers each route:

| Crisp API route | Access | Why TriageFox needs it |
|---|---|---|
| `GET /v1/website/{website_id}/conversation/{session_id}` | read | Load the conversation (state, and the visitor's display name, used on tickets only if the workspace turns names on). Hooks are only a signal; TriageFox always re-reads the conversation because hooks can arrive out of order. |
| `GET /v1/website/{website_id}/conversation/{session_id}/messages` | read | Read the messages, files and voice notes to decide whether a ticket is needed and to write it. |
| `GET /v1/website/{website_id}/conversations/{page}` | read | Catch up on conversations whose hooks were lost (Crisp can drop hooks after failed retries), every ~10 minutes. |
| `GET /v1/website/{website_id}` | read | Show the website's name when linking it, so the user can confirm the right one. |
| `GET /v1/plugins/subscription/{website_id}/{plugin_id}/settings` | read | Check the per-website token Crisp passes to the plugin page, so only a real operator of that website can link it, and notice when the plugin is uninstalled. |

No write, send, delete, people, campaign, or billing scopes.

## 4. Answers to the usual review questions

**What does the plugin do with conversation data?**
It reads a conversation after the customer stops typing (about 3 minutes), decides with AI whether it describes a code change, and if so creates or updates a ticket in the Jira or Trello project the customer chose. The ticket text is the product's output and is stored with the ticket record. Chat transcripts are **not** stored: webhook events are kept as identifiers only, and AI working notes are encrypted.

**Which personal data is stored?**
The Crisp website id and name; the visitor's display name only if the workspace turns on "include customer names" (off by default); never the visitor's email. Account data of TriageFox users (email, name) for sign-in. Details: `https://triagefox.com/legal/privacy`.

**Which AI provider sees the data? Is it used for training?**
OpenAI's API, for the analysis and for transcribing voice notes. Under OpenAI's API terms, API data is not used to train their models. *(Check OpenAI's current API data terms before submitting, and keep this sentence true.)* Workspaces can also use their own OpenAI key.

**Where is data stored, and how is it protected?**
On our server in India (Oracle Cloud, Mumbai), behind Cloudflare. Jira and Trello credentials are encrypted with a key pair whose private half only the background worker has; the website itself can store them but never read them back. Database rows are separated per workspace with Postgres row-level security. Encrypted backups, kept 30 days. More: `https://triagefox.com/security`.

**What happens on uninstall?**
TriageFox notices the plugin is gone, marks the Crisp connection as disconnected and stops reading that website. Workspaces can ask for deletion at `support@triagefox.com`; it is done within 7 days.

**Does it write to Crisp or message customers?**
No. Read-only.

**How can the reviewer test it?**
Give the reviewer a TriageFox account with free access (`/admin` → a comp grant or an invite code for their email), so they can link a Crisp test website, connect a Trello board and see a ticket appear without paying. Tell them to send a bug-like message from the website's chat box and wait about 3 minutes.

## 5. After approval

1. Crisp issues the **production token** and the **production hook** secret.
2. On the server (`nano ~/triagefox/deploy/.env`): `CRISP_PLUGIN_ID` and `CRISP_PLUGIN_KEY` = the production token, `CRISP_HOOK_SECRET` = the production hook's signing secret. `CRISP_PLUGIN_UUID` stays the same.
3. Restart: `docker compose -f deploy/docker-compose.yml up -d web worker`.
4. Install the plugin on your own website from the public Marketplace, link it again if asked, and send one test chat.
5. Add a "Get it on Crisp" link to the listing on the website and the Connections page (a small code change).
6. Rotate away from the development hook secret: it is no longer needed.

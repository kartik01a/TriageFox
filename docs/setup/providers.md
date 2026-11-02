# Setting up the provider apps

TriageFox talks to Crisp, Trello and Jira through apps registered under your own developer accounts. The hosted version uses the project owner's apps; self-hosters register their own (same steps). Credentials go in `.env`: see `.env.example`, and never paste them into chat or commit them.

Running your own copy? The whole install is in [../self-hosting.md](../self-hosting.md); this page is the detail for each provider. `APP_URL` below is the public address of the web app (`http://localhost:3000` in development).

## Trello (Power-Up API key)
1. https://trello.com/power-ups/admin → create a Power-Up (any name) → **API key**: copy it to `TRELLO_API_KEY` (web **and** worker).
2. On the API key page, add `APP_URL` to **Allowed origins**. Trello only redirects back to approved origins.
3. Nothing else: each customer approves access through the *Connect Trello* button (`/api/connections/trello/start`) and the token comes back in the URL fragment to `APP_URL/app/connections/trello/callback`.

## Jira Cloud (Atlassian OAuth 2.0 / 3LO)
1. https://developer.atlassian.com/console/myapps → create an **OAuth 2.0 integration**.
2. **Permissions → Jira API → Configure**: add scopes `read:jira-work`, `write:jira-work`, `read:jira-user`. (`offline_access` is implicit.) Without this the consent screen fails with "app has requested Jira API scopes that have not been added".
3. **Authorization → OAuth 2.0 (3LO)**: callback URL **`APP_URL/api/connections/jira/callback`**. (You can keep other URLs registered.)
4. Copy the client id to `ATLASSIAN_CLIENT_ID` (web and worker) and the secret to `ATLASSIAN_CLIENT_SECRET` (**worker only**).
5. **Distribution**: while "Not shared" only your own Atlassian account can authorize. Before opening to customers, set distribution to **Sharing** (requires the app's privacy policy URL and vendor details).

## Crisp (Marketplace plugin)
1. https://marketplace.crisp.chat → create a plugin (private while developing).
2. **Tokens**: create the token pair: `CRISP_PLUGIN_ID` = token *identifier*, `CRISP_PLUGIN_KEY` = key (**worker only**). `CRISP_PLUGIN_UUID` = the plugin's own id shown at the top of the plugin page (a UUID).
3. **Development**: add your test website under *trusted workspaces* ("Install Plugin on Workspace"). Until a website has the plugin installed, every API call returns `not_subscribed`.
4. **Widget (this is how users link their website).** In the plugin's Widgets settings, add an **iFrame widget** with this definition and place it where your operators will see it (e.g. the sidebar or conversation panel):
   ```json
   { "version": "1.0", "url": "APP_URL/crisp/link" }
   ```
   Crisp appends `website_id`, `token` and `locale` to that URL. The page verifies the token against Crisp's API through the worker, then offers *Continue in TriageFox*, which opens a normal tab where the signed-in owner/admin confirms the link.
   *Status: our side is implemented and tested end to end with the real Crisp API (token fetched from Crisp, page opened with it). Placing the widget in Marketplace is a manual step; confirm the exact Marketplace labels when you do it and correct this guide.*
   *Before the plugin is activated:* Crisp only shows the widget for an **activated** plugin, and activation needs a production token (Crisp's review). For local testing, run `pnpm --filter @triagefox/worker dev:crisp-link` (uses `CRISP_WEBSITE_ID` and the development token). It prints the exact page address Crisp would open; open it in the browser where you are signed in and continue as above. The address works like a password: don't share it. Development only.
5. **Hooks**: set the **Development Web Hook** URL to `<public URL>/api/webhooks/crisp` (locally your ngrok static domain; change any older `/crisp` URL) and put the signing secret Crisp shows in `CRISP_HOOK_SECRET` (web app). Subscribe to `message:send`, `message:received` and `session:set_state`.
6. **Production**: "Ask a production token" and publish for review before customers can install (launch task).

## Dodo Payments (hosted version only)
1. https://app.dodopayments.com → start in **test mode**. Developer → API Keys: create a key → `DODO_API_KEY`. Keep `DODO_ENV=test`; switch to `live` (with the live key and webhook secret) only at launch.
2. Developer → Webhooks: add the endpoint **`APP_URL/api/webhooks/billing`**, subscribe to the subscription and payment events, copy the signing secret → `DODO_WEBHOOK_SECRET` (it starts with `whsec_`).
3. Products: create one **subscription** product per plan, per interval and per currency (monthly and yearly, in USD and, for India, INR at a fixed price). Copy each product id (`pdt_…`).
4. In `/admin/plans`, enter the ids on the plan (`providerPriceIds`: `{ "dodo": { "USD": { "monthly": "pdt_…", "yearly": "pdt_…" }, "INR": { … } } }`), then make the plan public.
5. Customer portal: allow cancelling and updating the payment method.
6. Test once with Dodo's test cards: buy a plan, check *Billing* turns to Active, cancel in the portal, check it shows the end date.
7. Admins: set `PLATFORM_ADMIN_EMAILS` and turn on two-factor for that account. Alerts: `ALERT_EMAIL` and an optional Slack incoming webhook in `SLACK_ALERTS_WEBHOOK_URL`. Own support identity: `CRISP_IDENTITY_SECRET` from the TriageFox Support website's settings.

## Google sign-in (optional)
1. https://console.cloud.google.com → create a project → *APIs & Services* → *OAuth consent screen* (External; app name TriageFox; your email).
2. *Credentials* → *Create credentials* → *OAuth client ID* → type **Web application**.
3. Authorised redirect URI: **`APP_URL/api/auth/callback/google`** (for local testing `http://localhost:3000/api/auth/callback/google`).
4. Copy the client id and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and restart. The "Continue with Google" button then appears on sign-in and sign-up; without both values it stays hidden.
Google vouches for the email address, so these users skip the confirmation email. The same sign-up rules apply (closed sign-ups, invitation-only self-host).

## OpenAI
Customers bring their own key under *AI key*; for the platform's own AI set `OPENAI_API_KEY` where the worker reads it (Phase 4). Models are configured with `AI_MODEL_DEFAULT`, `AI_MODEL_ESCALATION`, `AI_MODEL_EMBEDDING`.

### Creating the Dodo products with a script (instead of by hand)
With `DODO_API_KEY` and `DODO_ENV=test` in `.env` and the plans seeded (`pnpm db:seed`):
`pnpm db:dodo-products` shows what it would create (dry run); `pnpm db:dodo-products -- --apply` creates the subscription products (3 main plans × monthly/yearly × USD/INR), skips ones that already exist by name, saves the ids to `docs/private/dodo-products.test.json` and links them to the plans. Add `--all` for the own-key plans and `--publish` to make plans public. Live mode needs `--allow-live`.

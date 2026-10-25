# Setting up the provider apps

TriageFox talks to Crisp, Trello and Jira through apps registered under your own developer accounts. The hosted version uses the project owner's apps; self-hosters register their own (same steps). Credentials go in `.env`: see `.env.example`, and never paste them into chat or commit them.

`APP_URL` below is the public address of the web app (`http://localhost:3000` in development).

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
5. **Hooks** (Phase 3): the development webhook URL is `APP_URL/api/webhooks/crisp` (for local work, an ngrok static domain).
6. **Production**: "Ask a production token" and publish for review before customers can install (launch task).

## OpenAI
Customers bring their own key under *AI key*; for the platform's own AI set `OPENAI_API_KEY` where the worker reads it (Phase 4). Models are configured with `AI_MODEL_DEFAULT`, `AI_MODEL_ESCALATION`, `AI_MODEL_EMBEDDING`.

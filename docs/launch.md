# Launch guide

Everything between "the code works" and "customers can use it": running the hosted version, submitting to the marketplaces, the legal checks, and making the repository public. Work through it top to bottom. Items marked **you** need an account or a decision that only the owner can make.

## 1. Accounts and names (start these first: some take days)

- [x] **you** Buy **triagefox.com** (Cloudflare Registrar). The public contact addresses are `support@triagefox.com` and `security@triagefox.com` (`apps/web/src/lib/site.ts`, `SECURITY.md`, `CODE_OF_CONDUCT.md`).
- [x] **you** Receiving mail: Cloudflare → Email → **Email Routing**: verify your personal inbox as the destination, then forward `support@` and `security@` to it (Cloudflare adds the MX and SPF records itself).
- [x] **you** Dodo Payments: create the account, submit KYC for **live** mode (can take days), keep working in test mode meanwhile ([setup/providers.md](setup/providers.md) "Dodo Payments").
- [x] **you** Sending mail: a Resend account, add the domain (its records live on the `send.` subdomain and `resend._domainkey`, so they don't clash with Email Routing), plus a `_dmarc` TXT record starting at `p=none`. The app uses Resend's SMTP (`smtp.resend.com`, port 465, `SMTP_SECURE=true`, user `resend`, an API key as the password) with `MAIL_FROM="TriageFox <support@triagefox.com>"`. To answer support mail as support@ from your personal inbox, add it in Gmail → Settings → Accounts → *Send mail as* with the same SMTP details and a **separate** API key.
- [ ] **you** Sentry (free): one project for the web app and the worker, DSN in `SENTRY_DSN`.
- [x] **you** Cloudflare (free): add the domain, point it at the server, "Full (strict)" TLS.
- [x] **you** Hosting: an Oracle Cloud Always Free account, or any VPS with 2 vCPU / 4 GB+. On a free (not Pay As You Go) Oracle account use an ARM A1 server with **1 OCPU / 6 GB**: Oracle stops free servers whose CPU, network *and* memory all stay low for 7 days, and on 6 GB the app's normal memory use stays above that line. Create the network first with the *VCN with Internet Connectivity* wizard. If the console says "Out of capacity", `caffeinate -i ./deploy/oracle-a1-retry.sh` (needs `brew install oci-cli` and `oci setup config`) retries every minute until a server is free.
- [ ] **you** Google sign-in: Google Cloud → *APIs & Services* → *OAuth consent screen* (Audience) → **Publish app**. While it is "Testing", only the listed test users can use "Continue with Google". With only the basic scopes (email, profile, openid) no Google review is needed.
- [ ] **you** A free uptime monitor (UptimeRobot, Better Stack…) on `https://triagefox.com/api/health`, alerting your phone.

## 2. Run the hosted version

Same stack as [self-hosting.md](self-hosting.md), with `APP_MODE=hosted` in `deploy/.env`. Differences:

1. **Install:** follow the self-hosting guide on the server. Use the published images (`WEB_IMAGE`, `WORKER_IMAGE`, see "Releasing" below) so deploys are a `pull`, not a build.
2. **Hosted-only settings** in `deploy/.env`: `APP_MODE=hosted`, `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_ENV=live`, `PLATFORM_ADMIN_EMAILS`, `SUPPORT_CRISP_WEBSITE_ID`, `CRISP_IDENTITY_SECRET`, `ALERT_EMAIL`, `SLACK_ALERTS_WEBHOOK_URL`, your platform `OPENAI_API_KEY`, the Crisp production token, `SMTP_*`, `SENTRY_DSN`. The web container never receives the worker's private key (the compose file already enforces this).
3. **Seed plans** once: `docker compose … run --rm migrate` runs migrations; plans come from the private seed file (`pnpm db:seed` from a checkout that has `docs/private/plans.seed.json`) or are created in `/admin/plans`.
4. **Admin account:** sign up with the email in `PLATFORM_ADMIN_EMAILS`, turn on two-factor, then open `/admin`.
5. **Your own support:** connect the *TriageFox Support* Crisp website to your own workspace, switch its automation on, then *Admin → Support inbox → Which workspace is our own support?*

### Lock the server down
- [x] Firewall: allow only SSH (22) and 80/443. On Oracle, edit both the VCN security list **and** the instance firewall.
- [x] **Origin lock:** only Cloudflare should reach 80/443. `./deploy/oracle-cloudflare-only.sh` (dry run; add `--apply`) sets the Oracle security list to Cloudflare's published ranges and keeps every other rule. Run it again a few times a year in case Cloudflare's list changes, and update the same list in `deploy/Caddyfile` (`trusted_proxies`), which decides when the visitor address from Cloudflare is believed. DNS records must stay **proxied**: "DNS only" would make the site unreachable. Leave "Always Use HTTPS" **off**: Caddy already redirects to HTTPS, and its certificate renewal needs plain HTTP to reach it.
- [ ] In Cloudflare: a rate-limiting rule for `/api/auth/*` (the app has its own limits too). Leave **"Always Use HTTPS" off** (Caddy already redirects, and its certificate renewal needs plain HTTP) and **Bot Fight Mode off** (it can challenge the Crisp and Dodo webhooks, and the free plan cannot exempt them). Keep **Cache Level** at standard and never cache `/app`, `/admin` or `/api`.
- [x] SSH keys only; no root login; unattended security updates.
- [x] `deploy/.env` mode 600; `CRYPTO_PRIVATE_KEYS` and `BETTER_AUTH_SECRET` also in a password manager.

### Backups (the promise in the privacy policy depends on this)
- [x] Daily at 03:15 India time from cron, `age`-encrypted, uploaded to the private Oracle bucket `triagefox-backups` through a write-only link that expires **2029-12-31** (make a new one before then). The bucket deletes backups after 29 days. Settings are in `~/.triagefox-backup.env` on the server; the private key is in `~/.config/triagefox/backup-age-key.txt` on your Mac **and in your password manager**. See [self-hosting.md](self-hosting.md) "Backups".
- [ ] **Restore test** every few months: restore the newest backup on a spare machine ([self-hosting.md](self-hosting.md) "Backups") and open the app. Write down how long it took. (2026-11-17: downloaded from the bucket, decrypted on the Mac and loaded into a throwaway database in under a minute; repeat with real data before launch.)
- [ ] Docker logs already rotate by size (10 MB × 5 files per container); they hold no message text. Keep it that way: the privacy policy says logs are kept for at most 90 days.

### Releasing a new version
1. Make sure CI is green on `main`.
2. `git tag v1.0.0 && git push origin v1.0.0`. The **Release images** workflow builds web and worker for Intel and ARM and publishes `ghcr.io/kartik01a/triagefox-web` and `…-worker` (tags `v1.0.0` and `latest`). The first time, make the two packages **public** in GitHub → your profile → Packages → Package settings.
3. On the server: set `WEB_IMAGE` / `WORKER_IMAGE` / `TRIAGEFOX_PULL=always` in `deploy/.env` (or pass the two image names to `setup.sh` for a fresh install), then `docker compose -f deploy/docker-compose.yml pull && … up -d`. Migrations run first, automatically.
4. Check `/api/health`, the Activity page and the worker log.

## 3. Marketplaces and provider reviews

### Crisp Marketplace (so customers can install the plugin)
- [ ] Plugin page: name **TriageFox**, short description ("Turns customer chats into Jira and Trello tickets"), longer description, logo (square, from the fox mark), 3 to 5 screenshots (the activity log, a ticket in Jira, a card in Trello, the setup page), category *Productivity*/*Developer tools*, support email, **privacy policy URL** `https://triagefox.com/legal/privacy`, terms URL, website URL.
- [ ] Settings: the iFrame widget `https://triagefox.com/crisp/link`; the web hook `https://triagefox.com/api/webhooks/crisp` for `message:send`, `message:received`, `session:set_state`; the signing secret into `CRISP_HOOK_SECRET`.
- [ ] Scopes: request only what the code uses (read conversations and messages, read the website, read plugin subscription settings). Compare with `docs/integrations/crisp.md` before submitting; Crisp reviewers ask why each scope is needed.
- [ ] Ask for the **production token** and the **production hook** (the development token only works on websites you added as trusted), then put them in `CRISP_PLUGIN_ID/KEY`.
- [ ] Submit for review. Expect questions; the answers are in [security.md](security.md) and [integrations/crisp.md](integrations/crisp.md).

### Atlassian (Jira)
- [x] Developer console → your OAuth 2.0 app → **Distribution**: change from "Not shared" to **Sharing**. Needs the privacy policy URL, the app's terms, a vendor name and contact, and a security contact.
- [ ] Complete the *data security and privacy* self-assessment honestly: we store tokens encrypted, tickets we create, no chat transcripts; data stays in our hosting; deletion on request within 7 days.
- [ ] Scopes stay `read:jira-work`, `write:jira-work`, `read:jira-user` (+ `offline_access`). Callback `https://triagefox.com/api/connections/jira/callback`.

### Trello
- [x] Power-Up admin → your key → add `https://triagefox.com` as an **allowed origin**. Read Trello's current API terms for commercial use. No Marketplace listing is needed.

### Dodo (live)
- [x] Live products created for every plan, interval and currency; product ids entered in `/admin/plans` and the plans published.
- [x] Live webhook `https://triagefox.com/api/webhooks/billing`, `DODO_ENV=live`, live key and secret.
- [ ] One real purchase with your own card (or a single-use 1-day discount code created just for the test), check the Billing page, then cancel in the portal.
- [ ] Ask Dodo to confirm in writing: no-refund policy allowed; Amex handled; payout fees and FX; that INR fixed prices work.

## 4. Legal checks (you)

The privacy policy and terms were drafted for you (sole proprietor in India, Indian law, DPDP Act 2023 and GDPR sections). They are plain-language drafts, **not legal advice**: get them reviewed by an Indian lawyer or a startup-legal service before launch, and confirm:

- [ ] The names, the contact address and the promises: reply within 7 days (privacy contact), data requests within 30 days, workspace deletion within 7 days, breach notice within 72 hours, logs kept at most 90 days, AI answers cleared after 30 days. Only keep promises you will keep.
- [ ] The jurisdiction wording ("courts in India with jurisdiction over the operator's place of business"): a lawyer may want a specific city.
- [ ] The subprocessor list matches what you really use at launch (Oracle, Cloudflare, OpenAI, Dodo, Resend, Sentry, Crisp, Google). Remove any you don't use; add any you do.
- [ ] The statement that OpenAI does not train on API data: check OpenAI's current API data terms.
- [ ] GST: talk to a chartered accountant about registration and the LUT for exporting services once revenue starts (Dodo handles customer-side taxes).
- [ ] Workspace deletion is currently done by email request; a self-service "delete my workspace" button is a good next feature.

## 5. Make the repository public

Do this last, when the hosted version works end to end.

- [x] Hosted version deployed and tested with a real Crisp chat, Trello and Jira, and a test payment.
- [ ] `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --redact --no-banner` finds **no leaks in the full history**. If it ever finds a real secret, rotate it (even if it was later deleted), then decide whether to rewrite history before going public.
- [ ] No private material in pushed files: `docs/private/` and `marketing/` are git-ignored; skim `docs/` once as a stranger would.
- [ ] README: add the demo GIF (`docs/assets/demo.gif`, see the comment at the top of `README.md`), check the self-host section, set the repository's description and topics (`customer-support`, `jira`, `trello`, `crisp`, `ai`, `self-hosted`).
- [ ] `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CLA.md`, `CODE_OF_CONDUCT.md`, issue and pull-request templates are in place (they are).
- [ ] GitHub → Settings → **Code security**: turn on Dependabot alerts and security updates, **secret scanning and push protection**, private vulnerability reporting, and check CodeQL is running.
- [ ] Turn on Discussions (the issue template links to it).
- [ ] Publish the first release tag (section 2, "Releasing") so the Docker images exist before anyone reads the self-host guide.
- [ ] Switch the repository to **public**.
- [ ] Right after: GitHub → Settings → Rules → Rulesets → new branch ruleset for `main` (Enforcement **Active**): **Restrict deletions** and **Block force pushes**. Leave pull-request and status-check rules off while you push straight to `main` yourself. Free accounts can't enforce rulesets on private repositories, which is why this step comes after the switch to public.
- [ ] Merge or close the open Dependabot pull requests after testing them (major jumps such as the Node base image need the self-host smoke test).

## 6. Launch week

1. Day 0: public repo + landing page live; post on your accounts (X, Product Hunt "coming soon", dev.to).
2. Watch `/admin` (AI spend, support inbox), the alert email/Slack, and Sentry. Reply to every support chat the same day.
3. Day 3 to 7: a short walkthrough video and a "how it works" post; submit to Hacker News / Reddit communities that allow it.
4. After a week: read the activity logs of your first customers (with their permission) for AI mistakes, fix the prompt, re-run the evals.

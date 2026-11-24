# Self-hosting TriageFox

You can run TriageFox on your own server for free. It is the same code as the hosted version, with billing switched off and your own developer accounts and OpenAI key. Expect about an hour the first time, most of it spent registering the Crisp, Trello and Jira apps.

If you would rather not do that, the hosted version at triagefox.com does it all for you.

## What you need

- A Linux server (Ubuntu 22.04+ is fine) with **2 vCPU and 2 GB RAM or more**, Docker with the Compose plugin, `git` and `openssl`.
- A **domain name** pointing at the server (an `A` record), with ports **80 and 443** open. Caddy gets a free HTTPS certificate for it automatically.
- Accounts: **Crisp** (a free workspace works), **Trello and/or Jira Cloud**, **OpenAI** (API key), and an **email provider** with SMTP (Resend, Postmark, Mailgun, your own server). Email is needed for sign-up confirmation and invitations.

Just trying it on your laptop? Use `localhost` as the domain and the built-in test mailbox (see "Trial on one machine" below). Crisp cannot reach your laptop though, so real chats need a public address (a domain, or a tunnel such as ngrok).

## 1. Install

```bash
git clone https://github.com/kartik01a/TriageFox.git
cd TriageFox
./deploy/setup.sh
```

The script asks for your domain and how email will be sent, builds the images, and writes **`deploy/.env`** with every password and key it generated (readable only by you, never printed). It refuses to run if `deploy/.env` already exists, so it can't replace your secrets by accident.

**Back up `CRYPTO_PRIVATE_KEYS` now.** It is in `deploy/.env`. It is the only key that can open the Trello and Jira tokens stored in the database. If you lose it, nothing breaks except that everyone has to reconnect their tools. Keep a copy apart from your database backups.

## 2. Register your own apps

Open `deploy/.env` and fill in the values below. Each register-an-app step is described in detail in [setup/providers.md](setup/providers.md). Replace `APP_URL` with your address (for example `https://triage.example.com`).

| Tool | What to create | What to put in `deploy/.env` |
|---|---|---|
| **Crisp** | A plugin at marketplace.crisp.chat. Add your website under *trusted workspaces*. Token pair under *Tokens*. An iFrame widget pointing to `APP_URL/crisp/link`. A web hook to `APP_URL/api/webhooks/crisp` for `message:send`, `message:received`, `session:set_state` | `CRISP_PLUGIN_ID`, `CRISP_PLUGIN_KEY`, `CRISP_PLUGIN_UUID`, `CRISP_HOOK_SECRET` |
| **Trello** (optional) | A Power-Up API key at trello.com/power-ups/admin; add `APP_URL` as an allowed origin | `TRELLO_API_KEY` |
| **Jira Cloud** (optional) | An OAuth 2.0 (3LO) app at developer.atlassian.com with scopes `read:jira-work`, `write:jira-work`, `read:jira-user`; callback `APP_URL/api/connections/jira/callback` | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` |
| **Linear** (optional) | An OAuth application in Linear (Settings → API → OAuth applications); callback `APP_URL/api/connections/linear/callback`. Connecting needs a Linear workspace admin | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` |
| **OpenAI** | An API key | `OPENAI_API_KEY` (or leave empty and let each workspace enter its own under *AI key*) |
| **Email** | SMTP credentials | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` |

Connect at least Crisp and one of Trello, Jira or Linear; leave the rest blank to turn them off.

A Crisp development token only works on websites you have added as trusted workspaces, which is exactly what a self-hosted install for your own website needs.

## 3. Start it

```bash
docker compose -f deploy/docker-compose.yml up -d
```

The first start creates the database and applies the migrations (a one-time `migrate` container). Then open your address and **create the first account**: that person becomes the owner of the first workspace. After that, sign-up is **by invitation only** (Members → invite). To let anyone sign up, set `SELFHOST_OPEN_SIGNUP=true` in `deploy/.env` and restart.

Finish with the **Setup** page in the app. It walks through connecting Crisp, Trello or Jira, choosing the board or project, a dry run on your latest chats, and switching the automation on.

Check on things:

```bash
docker compose -f deploy/docker-compose.yml ps          # everything "running"/"healthy"
docker compose -f deploy/docker-compose.yml logs worker # shows which tools are configured, and what is missing
curl -s https://your-domain/api/health                  # {"ok":true}
```

The worker prints a clear line for anything missing at start-up (for example "Crisp is not configured (CRISP_PLUGIN_ID, ...)").

### Trial on one machine

```bash
DOMAIN=localhost SMTP=2 ./deploy/setup.sh
docker compose -f deploy/docker-compose.yml --profile trial up -d
```

Open `https://localhost` (accept the local certificate warning). Sign-up emails are caught by a test mailbox at http://127.0.0.1:8025. Don't use this profile for real use.

## Ready-made images (no build)

Tagged releases publish Intel and ARM images to GitHub's registry. To use them instead of building from source, run the setup with the two image names, or set them in `deploy/.env` later:

```bash
WEB_IMAGE=ghcr.io/kartik01a/triagefox-web:v1.0.0 \
WORKER_IMAGE=ghcr.io/kartik01a/triagefox-worker:v1.0.0 \
./deploy/setup.sh
```

`TRIAGEFOX_PULL=always` (set for you) makes `docker compose up -d` pull them. Then update with `docker compose -f deploy/docker-compose.yml pull && docker compose -f deploy/docker-compose.yml up -d`.

## When a connection stops working

If Trello, Jira or Crisp stops accepting TriageFox (access revoked, plugin removed), the owner gets one email (this needs your SMTP settings in `deploy/.env`), the connection shows "Reconnect needed", and tickets that could not be sent wait. Reconnect it on the Connections page, then press **Try all again** on the Automation page. Set `ALERT_EMAIL` (and optionally `SLACK_ALERTS_WEBHOOK_URL`) to also hear about jobs that keep failing and about a rejected OpenAI key.

## Updating

```bash
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

Migrations run automatically before the new version starts. Read the changelog first for anything that needs a manual step.

## Backups

```bash
./deploy/backup.sh                          # deploy/backups/triagefox-<date>.sql.gz
./deploy/restore.sh deploy/backups/<file>   # REPLACES current data
```

`backup.sh` reads these optional settings from its environment:

| Setting | What it does |
|---|---|
| `BACKUP_AGE_RECIPIENT` | Encrypts each backup with an [age](https://age-encryption.org) **public** key (`.age`). Recommended: make the key pair on your own computer (`age-keygen -o key.txt`), give the server only the `age1…` public key, keep `key.txt` in your password manager. A stolen server then cannot open old backups. Needs `apt install age`. |
| `BACKUP_PASSPHRASE` | Or encrypt with a passphrase (`.enc`). Simpler, but the passphrase then lives on the server. |
| `BACKUP_UPLOAD_URL` | Copies each backup **off the server** with an HTTP `PUT` to `<URL><file name>`. On Oracle: a bucket with versioning on, and a pre-authenticated request of type *Permit object writes* (the server can add files but cannot list, read or delete them). |
| `BACKUP_KEEP_DAYS` | Deletes local copies older than this (default 14). Uploaded copies are not touched: give the bucket a lifecycle rule (for example, delete after 29 days, and previous versions after 1). |

If a run fails and `SMTP_*` and `ALERT_EMAIL` are set in `deploy/.env`, it emails `ALERT_EMAIL`.

Keep the settings in a file only you can read (`chmod 600 ~/.triagefox-backup.env`) and run it daily from cron (`crontab -e`):

```
45 21 * * * set -a; . "$HOME/.triagefox-backup.env"; "$HOME/triagefox/deploy/backup.sh" >>"$HOME/backup.log" 2>&1
```

To restore an `.age` backup, copy it and your key file to the machine, then `BACKUP_AGE_IDENTITY=key.txt ./deploy/restore.sh <file>` (it checks the key opens the file before touching any data). The database holds your connections, tickets and activity, but never chat transcripts. Remember `CRYPTO_PRIVATE_KEYS` is **not** in the dump (see above).

Test a restore on a spare machine at least once. A backup you have never restored is a hope, not a backup.

## What is stored, and where

Postgres holds accounts, workspaces, connections (Trello/Jira tokens **sealed** with the worker's key), tickets we created, and an activity log. **Chat transcripts are never stored**: the worker reads them from Crisp when needed and keeps them in memory. Redis holds the job queue. Details: [security.md](security.md).

How the containers are separated:

| Container | Has | Network |
|---|---|---|
| `caddy` | nothing secret | the internet (80/443) |
| `web` | the **public** key, session secret, SMTP | Caddy + the private backend network + outbound |
| `worker` | the **private** key, provider secrets | the private backend network + outbound |
| `postgres`, `redis` | their own passwords | the private backend network only (no internet in or out) |

## Hardening checklist

- [ ] Firewall: allow only SSH, 80 and 443 (`ufw allow OpenSSH && ufw allow 80,443/tcp && ufw enable`).
- [ ] SSH: keys only, no password login, no root login.
- [ ] Automatic security updates for the operating system (`unattended-upgrades` on Ubuntu).
- [ ] `deploy/.env` is mode 600 and owned by the user who runs Docker. Never commit it.
- [ ] Daily `backup.sh`, encrypted (`BACKUP_AGE_RECIPIENT`) and copied off the server (`BACKUP_UPLOAD_URL`); one restore test done.
- [ ] `CRYPTO_PRIVATE_KEYS` and `BETTER_AUTH_SECRET` stored in a password manager.
- [ ] In the app: turn on two-factor for yourself, then *Security → Require two-factor for everyone*.
- [ ] Keep `SELFHOST_OPEN_SIGNUP=false` unless you really want public sign-ups.
- [ ] Update regularly (`git pull` and `up -d --build`).
- [ ] Do not publish the Mailpit port (the trial profile binds it to 127.0.0.1 only).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Docker says `variable is not set: run deploy/setup.sh first` | `deploy/.env` is missing or a generated value is empty. Run `./deploy/setup.sh` (or restore your `.env`). |
| Docker says `set SMTP_HOST in deploy/.env` | Email isn't configured. Fill in your SMTP settings, or use the trial profile. |
| The site shows a certificate error | The domain doesn't point at this server yet, or ports 80/443 are blocked. Caddy retries automatically; see `docker compose logs caddy`. |
| Sign-up works but no email arrives | SMTP settings are wrong (see `docker compose logs web`), or the mail went to spam. |
| Chats never turn into tickets | Check `docker compose logs worker` for "Crisp is not configured", then that the Crisp web hook URL is `APP_URL/api/webhooks/crisp` and `CRISP_HOOK_SECRET` matches. The Automation page must be switched on. |
| "Reconnect needed" on a tool | The token was revoked at Trello/Atlassian. Use *Connections → Reconnect*. |
| Everyone must reconnect their tools after a restore | `CRYPTO_PRIVATE_KEYS` in the new `deploy/.env` doesn't match the one that sealed the data. |
| Worker logs "OPENAI_API_KEY is not set" | Set it in `deploy/.env`, or each workspace adds its own key under *AI key*. |

## Hosted-only settings

`DODO_*`, `PLATFORM_ADMIN_EMAILS`, `SUPPORT_CRISP_WEBSITE_ID` and `CRISP_IDENTITY_SECRET` (the last block of `deploy/.env.example`) belong to the hosted version. A self-hosted install ignores them: there is no billing, trial, plan limit or admin area.

## Differences from the hosted version

No billing or plan limits; AI is paid for with your own OpenAI key; you operate the server, backups and updates; you register your own Crisp, Trello and Atlassian apps; there is no marketing site (the home page goes straight to sign-in).

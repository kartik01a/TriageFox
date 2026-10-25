# Security Policy

TriageFox handles other teams' Jira, Trello and Crisp access, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Email **security@triagefox.com** (until the domain is live, use GitHub's private "Report a vulnerability" button on this repository).

Include what you found, how to reproduce it, and the impact you expect. We aim to reply within 48 hours and to fix confirmed issues quickly. We'll credit you in the changelog if you'd like.

## Scope

In scope: this repository and the hosted service at triagefox.com. Out of scope: social engineering, denial-of-service, and vulnerabilities in third-party services (Crisp, Jira, Trello, OpenAI).

## How we protect data

See [docs/security.md](docs/security.md): sealed-box encryption of stored tokens (the web app cannot read them back), no stored chat transcripts, row-level security between workspaces, and a secret scanner on every commit.

#!/usr/bin/env node
// Blocks commits that contain secrets. Never prints the secret itself, only file and rule.
// Usage: node scripts/secret-scan.mjs --staged | --all
// Complements gitleaks (CI + optional local install); works with no extra tools.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const mode = process.argv.includes("--all") ? "all" : "staged";
const sh = (c) => execSync(c, { encoding: "utf8", maxBuffer: 1 << 28 });

const rules = [
  ["OpenAI key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["Atlassian API token", /ATATT[A-Za-z0-9_=-]{20,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/],
  [
    "Slack token / webhook",
    /xox[abprs]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
  ],
  ["Private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Stripe/Resend-style key", /(?:sk_live|rk_live|re)_[A-Za-z0-9]{20,}/],
];

const files =
  mode === "all"
    ? sh("git ls-files").split("\n").filter(Boolean)
    : sh("git diff --cached --name-only --diff-filter=ACM").split("\n").filter(Boolean);

// Values from the local .env must never appear in committed files, except public defaults
// that are also listed in .env.example.
const exampleText = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
const envValues = [];
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    const v = m?.[2]?.replace(/^["']|["']$/g, "").trim();
    // only sufficiently long, non-default values count as secrets
    if (
      m &&
      v &&
      v.length >= 16 &&
      !/^(https?|postgres|redis):/.test(v) &&
      !/localhost/.test(v) &&
      !exampleText.includes(v)
    )
      envValues.push([m[1], v]);
  }
}

const skip = /(^|\/)(pnpm-lock\.yaml|LICENSE|\.env\.example)$|\.(png|jpe?g|gif|ico|woff2?|pdf)$/;
const hits = [];
for (const f of files) {
  if (skip.test(f)) continue;
  let text;
  try {
    text = mode === "all" ? readFileSync(f, "utf8") : sh(`git show ":${f}"`);
  } catch {
    continue;
  }
  // A line containing "secret-scan:ignore" is excluded (for fake keys in tests and docs).
  text = text
    .split("\n")
    .filter((l) => !l.includes("secret-scan:ignore"))
    .join("\n");
  for (const [name, re] of rules) if (re.test(text)) hits.push(`${f}: looks like a ${name}`);
  for (const [k, v] of envValues)
    if (text.includes(v)) hits.push(`${f}: contains the value of ${k} from .env`);
}

if (hits.length) {
  console.error(
    "\n✖ Secret scan failed. Remove these before committing:\n  " + hits.join("\n  ") + "\n",
  );
  process.exit(1);
}
console.log(`✔ secret scan clean (${files.length} files, ${mode})`);

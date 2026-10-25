/**
 * Fills .env from .env.example without ever printing secret values:
 *  - copies missing variables that have a default in .env.example
 *  - generates BETTER_AUTH_SECRET and the sealed-box keypair when they are empty
 * Existing values are never overwritten.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPair } from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const examplePath = join(root, ".env.example");
const envPath = join(root, ".env");

function parse(text: string) {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1] !== undefined) out.set(m[1], (m[2] ?? "").replace(/\s+#.*$/, "").trim());
  }
  return out;
}

const example = parse(readFileSync(examplePath, "utf8"));
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const have = parse(current);
const added: string[] = [];
let append = "";
const set = (k: string, v: string) => {
  append += `${k}=${v}\n`;
  added.push(k);
  have.set(k, v);
};

for (const [k, v] of example) {
  if (!have.has(k) && v !== "") set(k, v);
}
const empty = (k: string) => !have.get(k);
if (empty("BETTER_AUTH_SECRET")) set("BETTER_AUTH_SECRET", randomBytes(48).toString("base64url"));
if (empty("CRYPTO_PUBLIC_KEYS") || empty("CRYPTO_PRIVATE_KEYS")) {
  const kp = await generateKeyPair();
  set("CRYPTO_CURRENT_VERSION", "1");
  set("CRYPTO_PUBLIC_KEYS", JSON.stringify({ 1: kp.publicKey }));
  set("CRYPTO_PRIVATE_KEYS", JSON.stringify({ 1: kp.privateKey }));
}

// Drop empty placeholders that we are about to replace, then append the new values.
let next = current
  .split("\n")
  .filter((l) => {
    const m = /^([A-Z][A-Z0-9_]*)=\s*$/.exec(l);
    return !(m?.[1] && added.includes(m[1]));
  })
  .join("\n");
if (next && !next.endsWith("\n")) next += "\n";
writeFileSync(envPath, next + append, { mode: 0o600 });
console.log(added.length ? `.env updated. Added: ${added.join(", ")}` : ".env already complete.");

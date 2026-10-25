import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

export function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it in .env (see .env.example).`);
    process.exit(1);
  }
  return v;
}

/** Save a payload for later fixtures. Raw captures stay git-ignored until anonymised. */
export function capture(name: string, data: unknown) {
  const file = join(here, "captured", `${name}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  saved -> spikes/captured/${name}.json`);
}

export async function http(url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, body };
}

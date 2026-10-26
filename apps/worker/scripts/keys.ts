/**
 * Prints freshly generated secrets as KEY=value lines. Used by deploy/setup.sh, which writes the
 * output straight into the .env file, so the values are never shown on screen. Existing secrets are
 * never touched here: the script only runs when .env has none.
 */
import { randomBytes } from "node:crypto";
import { generateKeyPair } from "@triagefox/crypto";

const kp = await generateKeyPair();
const lines = [
  `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
  "CRYPTO_CURRENT_VERSION=1",
  `CRYPTO_PUBLIC_KEYS=${JSON.stringify({ 1: kp.publicKey })}`,
  `CRYPTO_PRIVATE_KEYS=${JSON.stringify({ 1: kp.privateKey })}`,
];
process.stdout.write(`${lines.join("\n")}\n`);

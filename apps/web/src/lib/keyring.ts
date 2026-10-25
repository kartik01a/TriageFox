import "server-only";
import { keyringFromEnv, type PublicKeyring } from "@triagefox/crypto";
import { env } from "./env";

/** Public keys only: the web app can seal secrets but can never open them. */
export function publicKeyring(): PublicKeyring {
  const e = env();
  const ring = keyringFromEnv({
    CRYPTO_PUBLIC_KEYS: e.CRYPTO_PUBLIC_KEYS,
    CRYPTO_CURRENT_VERSION: e.CRYPTO_CURRENT_VERSION,
  });
  return ring;
}

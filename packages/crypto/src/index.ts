import sodium from "libsodium-wrappers";

/**
 * Sealed-box secret storage (docs/security.md §3, ADR 0010).
 *
 * - The web app holds ONLY public keys: it can seal (store) a secret but can never open it.
 * - Only the worker holds the private keys and can open secrets.
 * - Every sealed value contains its owner binding (org, record, purpose). Opening verifies it, so a
 *   ciphertext copied into another row or purpose is rejected.
 * - A key version prefix allows rotation: new secrets use the current version; old ones stay
 *   readable until resealed.
 */

export interface Binding {
  orgId: string;
  recordId: string;
  /** What the secret is, e.g. "connection.token", "ai.key", "thread.summary". */
  purpose: string;
}

export interface PublicKeyring {
  currentVersion: number;
  publicKeys: Record<string, string>;
}

export interface PrivateKeyring extends PublicKeyring {
  privateKeys: Record<string, string>;
}

const FORMAT = 1;

export class SealedSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedSecretError";
  }
}

async function ready() {
  await sodium.ready;
  return sodium;
}

export async function generateKeyPair() {
  const s = await ready();
  const kp = s.crypto_box_keypair();
  return {
    publicKey: s.to_base64(kp.publicKey, s.base64_variants.ORIGINAL),
    privateKey: s.to_base64(kp.privateKey, s.base64_variants.ORIGINAL),
  };
}

/** Parse the keyring from env values. Private keys are only passed in the worker. */
export function keyringFromEnv(env: {
  CRYPTO_PUBLIC_KEYS: string;
  CRYPTO_CURRENT_VERSION: number;
  CRYPTO_PRIVATE_KEYS?: string;
}): PublicKeyring | PrivateKeyring {
  const publicKeys = JSON.parse(env.CRYPTO_PUBLIC_KEYS) as Record<string, string>;
  const base = { currentVersion: env.CRYPTO_CURRENT_VERSION, publicKeys };
  if (!env.CRYPTO_PRIVATE_KEYS) return base;
  return { ...base, privateKeys: JSON.parse(env.CRYPTO_PRIVATE_KEYS) as Record<string, string> };
}

export async function sealSecret(
  plaintext: string,
  binding: Binding,
  keyring: PublicKeyring,
): Promise<string> {
  const s = await ready();
  const version = String(keyring.currentVersion);
  const pub = keyring.publicKeys[version];
  if (!pub) throw new SealedSecretError(`No public key for version ${version}`);
  const payload = JSON.stringify({
    f: FORMAT,
    org: binding.orgId,
    rec: binding.recordId,
    pur: binding.purpose,
    val: plaintext,
  });
  const sealed = s.crypto_box_seal(payload, s.from_base64(pub, s.base64_variants.ORIGINAL));
  return `v${version}:${s.to_base64(sealed, s.base64_variants.ORIGINAL)}`;
}

export async function openSecret(
  sealed: string,
  binding: Binding,
  keyring: PrivateKeyring,
): Promise<string> {
  const s = await ready();
  const match = /^v(\d+):(.+)$/.exec(sealed);
  if (!match) throw new SealedSecretError("Malformed sealed value");
  const [, version = "", body = ""] = match;
  const priv = keyring.privateKeys[version];
  const pub = keyring.publicKeys[version];
  if (!priv || !pub) throw new SealedSecretError(`No key for version ${version}`);

  let payload: { f: number; org: string; rec: string; pur: string; val: string };
  try {
    const bytes = s.crypto_box_seal_open(
      s.from_base64(body, s.base64_variants.ORIGINAL),
      s.from_base64(pub, s.base64_variants.ORIGINAL),
      s.from_base64(priv, s.base64_variants.ORIGINAL),
    );
    payload = JSON.parse(s.to_string(bytes));
  } catch {
    // Deliberately generic: do not reveal whether the key, the data or the format was wrong.
    throw new SealedSecretError("Unable to open sealed value");
  }
  if (
    payload.f !== FORMAT ||
    payload.org !== binding.orgId ||
    payload.rec !== binding.recordId ||
    payload.pur !== binding.purpose
  ) {
    throw new SealedSecretError("Sealed value does not belong to this record");
  }
  return payload.val;
}

/** True when a sealed value was written with an older key version and should be resealed. */
export function needsReseal(sealed: string, currentVersion: number): boolean {
  const m = /^v(\d+):/.exec(sealed);
  return !m || Number(m[1]) !== currentVersion;
}

export function sealedVersion(sealed: string): number | null {
  const m = /^v(\d+):/.exec(sealed);
  return m ? Number(m[1]) : null;
}

/** Show a secret as `sk-…1234` for the UI. The full value is never displayed again. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "••••";
  const prefix = secret.startsWith("sk-") ? "sk-" : "";
  return `${prefix}…${secret.slice(-4)}`;
}

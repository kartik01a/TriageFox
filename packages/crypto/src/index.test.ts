import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  maskSecret,
  needsReseal,
  openSecret,
  type PrivateKeyring,
  SealedSecretError,
  sealSecret,
} from "./index";

const binding = { orgId: "org_1", recordId: "conn_1", purpose: "connection.token" };

async function keyring(version = 1): Promise<PrivateKeyring> {
  const kp = await generateKeyPair();
  return {
    currentVersion: version,
    publicKeys: { [version]: kp.publicKey },
    privateKeys: { [version]: kp.privateKey },
  };
}

describe("sealed secrets", () => {
  it("round-trips a secret", async () => {
    const kr = await keyring();
    const sealed = await sealSecret("trello-token-123", binding, kr);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("trello-token-123");
    expect(await openSecret(sealed, binding, kr)).toBe("trello-token-123");
  });

  it("produces different ciphertext each time", async () => {
    const kr = await keyring();
    expect(await sealSecret("x", binding, kr)).not.toBe(await sealSecret("x", binding, kr));
  });

  it("a public-only keyring can seal but cannot open", async () => {
    const kr = await keyring();
    const sealed = await sealSecret("secret", binding, {
      currentVersion: 1,
      publicKeys: kr.publicKeys,
    });
    // the web app never has privateKeys, so the type system rejects opening
    // @ts-expect-error opening requires a private keyring
    const attempt = openSecret(sealed, binding, { currentVersion: 1, publicKeys: kr.publicKeys });
    await expect(attempt).rejects.toThrow();
  });

  it("rejects a ciphertext moved to another org, record or purpose", async () => {
    const kr = await keyring();
    const sealed = await sealSecret("secret", binding, kr);
    for (const other of [
      { ...binding, orgId: "org_2" },
      { ...binding, recordId: "conn_2" },
      { ...binding, purpose: "ai.key" },
    ]) {
      await expect(openSecret(sealed, other, kr)).rejects.toThrow(/does not belong/);
    }
  });

  it("rejects tampered or foreign-key data with a generic error", async () => {
    const kr = await keyring();
    const other = await keyring();
    const sealed = await sealSecret("secret", binding, kr);
    await expect(openSecret(sealed, binding, other)).rejects.toThrow(SealedSecretError);
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    await expect(openSecret(tampered, binding, kr)).rejects.toThrow(/Unable to open/);
    await expect(openSecret("garbage", binding, kr)).rejects.toThrow(/Malformed/);
  });

  it("supports key rotation: old values stay readable, new ones use the new version", async () => {
    const v1 = await keyring(1);
    const old = await sealSecret("secret", binding, v1);
    const kp2 = await generateKeyPair();
    const rotated: PrivateKeyring = {
      currentVersion: 2,
      publicKeys: { ...v1.publicKeys, 2: kp2.publicKey },
      privateKeys: { ...v1.privateKeys, 2: kp2.privateKey },
    };
    expect(await openSecret(old, binding, rotated)).toBe("secret");
    expect(needsReseal(old, rotated.currentVersion)).toBe(true);
    const fresh = await sealSecret("secret", binding, rotated);
    expect(fresh.startsWith("v2:")).toBe(true);
    expect(needsReseal(fresh, 2)).toBe(false);
  });
});

describe("maskSecret", () => {
  it("shows only the last four characters", () => {
    expect(maskSecret("sk-proj-abcdefghijklmnop1234")).toBe("sk-…1234"); // secret-scan:ignore fake key
    expect(maskSecret("abcd")).toBe("••••");
  });
});

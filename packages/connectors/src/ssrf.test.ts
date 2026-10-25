import { describe, expect, it } from "vitest";
import {
  CRISP_FILE_HOSTS,
  checkUrlShape,
  isPrivateIp,
  safeDownload,
  UnsafeUrlError,
} from "./index";

const publicDns = async () => ["52.1.2.3"];
const allowed = CRISP_FILE_HOSTS;

describe("isPrivateIp", () => {
  it("blocks loopback, private, link-local (cloud metadata), CGNAT, multicast and reserved ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("blocks the IPv6 equivalents, including IPv4-mapped addresses", () => {
    for (const ip of [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:10.0.0.1",
      "::ffff:169.254.169.254",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("allows ordinary public addresses", () => {
    for (const ip of [
      "8.8.8.8",
      "52.1.2.3",
      "172.32.0.1",
      "11.0.0.1",
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it("treats garbage as unsafe", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });
});

describe("checkUrlShape", () => {
  it("accepts an https URL on an allowed host", () => {
    expect(checkUrlShape("https://storage.crisp.chat/users/upload/x.png", allowed).hostname).toBe(
      "storage.crisp.chat",
    );
  });
  it("rejects everything else", () => {
    for (const bad of [
      "http://storage.crisp.chat/x.png", // not https
      "https://evil.example/x.png", // not allowed
      "https://storage.crisp.chat.evil.example/x.png", // look-alike host
      "https://evil.example/https://storage.crisp.chat/x.png",
      "https://user:pass@storage.crisp.chat/x.png", // credentials
      "https://storage.crisp.chat:8443/x.png", // odd port
      "https://169.254.169.254/latest/meta-data", // IP literal
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "file:///etc/passwd",
      "ftp://storage.crisp.chat/x",
      "javascript:alert(1)",
      "nonsense",
    ]) {
      expect(() => checkUrlShape(bad, allowed), bad).toThrow(UnsafeUrlError);
    }
  });
});

const body = (n: number) =>
  new Response(new Uint8Array(n).fill(1), { headers: { "content-type": "image/png" } });
const drain = async (s: ReadableStream<Uint8Array>) => {
  let total = 0;
  for await (const c of s as unknown as AsyncIterable<Uint8Array>) total += c.byteLength;
  return total;
};

describe("safeDownload", () => {
  it("downloads from an allowed host with a public address", async () => {
    const d = await safeDownload("https://storage.crisp.chat/a.png", {
      allowedHosts: allowed,
      resolve: publicDns,
      fetch: (async () => body(1000)) as typeof fetch,
    });
    expect(d.contentType).toBe("image/png");
    expect(await drain(d.stream)).toBe(1000);
  });

  it("refuses a host that resolves to an internal address (DNS pointing inward)", async () => {
    let fetched = false;
    const f = (async () => {
      fetched = true;
      return body(1);
    }) as typeof fetch;
    for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "::1"]) {
      await expect(
        safeDownload("https://storage.crisp.chat/a.png", {
          allowedHosts: allowed,
          resolve: async () => [ip],
          fetch: f,
        }),
      ).rejects.toThrow(/non-public/);
    }
    // one bad address among good ones is enough to refuse
    await expect(
      safeDownload("https://storage.crisp.chat/a.png", {
        allowedHosts: allowed,
        resolve: async () => ["52.1.1.1", "10.0.0.1"],
        fetch: f,
      }),
    ).rejects.toThrow(/non-public/);
    expect(fetched).toBe(false); // never even connected
  });

  it("follows redirects only within the allowlist and re-checks every hop", async () => {
    const toEvil = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      })) as typeof fetch;
    await expect(
      safeDownload("https://storage.crisp.chat/a.png", {
        allowedHosts: allowed,
        resolve: publicDns,
        fetch: toEvil,
      }),
    ).rejects.toThrow(/not allowed/);
    const toMetadata = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest" },
      })) as typeof fetch;
    await expect(
      safeDownload("https://storage.crisp.chat/a.png", {
        allowedHosts: allowed,
        resolve: publicDns,
        fetch: toMetadata,
      }),
    ).rejects.toThrow(UnsafeUrlError);
    let n = 0;
    const loop = (async () => {
      n++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://storage.crisp.chat/loop" },
      });
    }) as typeof fetch;
    await expect(
      safeDownload("https://storage.crisp.chat/a.png", {
        allowedHosts: allowed,
        resolve: publicDns,
        fetch: loop,
      }),
    ).rejects.toThrow(/redirects/);
    expect(n).toBe(4);
    const ok = (async (u: string | URL | Request) =>
      String(u).endsWith("/b.png")
        ? body(10)
        : new Response(null, { status: 302, headers: { location: "/b.png" } })) as typeof fetch;
    expect(
      await drain(
        (
          await safeDownload("https://storage.crisp.chat/a.png", {
            allowedHosts: allowed,
            resolve: publicDns,
            fetch: ok,
          })
        ).stream,
      ),
    ).toBe(10);
  });

  it("enforces the size limit, both when declared and when the server lies", async () => {
    const declared = (async () =>
      new Response(new Uint8Array(10), {
        headers: { "content-length": "999999999" },
      })) as typeof fetch;
    await expect(
      safeDownload("https://storage.crisp.chat/a.png", {
        allowedHosts: allowed,
        resolve: publicDns,
        fetch: declared,
        maxBytes: 1000,
      }),
    ).rejects.toThrow(/too large/);
    const lying = (async () => body(5000)) as typeof fetch; // no content-length header
    const d = await safeDownload("https://storage.crisp.chat/a.png", {
      allowedHosts: allowed,
      resolve: publicDns,
      fetch: lying,
      maxBytes: 1000,
    });
    await expect(drain(d.stream)).rejects.toThrow(/too large/);
  });

  it("fails cleanly on errors and unresolvable hosts", async () => {
    await expect(
      safeDownload("https://storage.crisp.chat/a.png", {
        allowedHosts: allowed,
        resolve: publicDns,
        fetch: (async () => new Response("no", { status: 404 })) as typeof fetch,
      }),
    ).rejects.toThrow(/404/);
    await expect(
      safeDownload("https://storage.crisp.chat/a.png", {
        allowedHosts: allowed,
        resolve: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/resolved/);
  });
});

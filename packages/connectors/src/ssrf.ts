import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Safe downloading of customer-supplied file URLs (docs/security.md §7).
 *
 * A conversation can contain any URL a customer chooses. Fetching it blindly would let them make our
 * server call internal addresses (cloud metadata, databases, localhost). So: https only, an exact host
 * allowlist, every resolved address must be public, redirects are only followed within the allowlist,
 * and size and time are capped.
 */

export const CRISP_FILE_HOSTS = ["storage.crisp.chat"];

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

const V4_PRIVATE: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = ipv4ToInt(ip);
    return V4_PRIVATE.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    });
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower); // IPv4-mapped
    if (mapped?.[1]) return isPrivateIp(mapped[1]);
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not an IP at all: treat as unsafe
}

export type Resolver = (hostname: string) => Promise<string[]>;
const defaultResolver: Resolver = async (h) =>
  (await lookup(h, { all: true })).map((a) => a.address);

export function checkUrlShape(raw: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https URLs are allowed");
  if (url.username || url.password)
    throw new UnsafeUrlError("URLs with credentials are not allowed");
  if (url.port && url.port !== "443") throw new UnsafeUrlError("Unexpected port");
  const host = url.hostname.toLowerCase();
  if (isIP(host)) throw new UnsafeUrlError("IP addresses are not allowed");
  if (!allowedHosts.map((h) => h.toLowerCase()).includes(host))
    throw new UnsafeUrlError("Host is not allowed");
  return url;
}

export interface SafeDownload {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  /** Declared size when the server sent one. */
  contentLength?: number;
}

export interface SafeDownloadOptions {
  allowedHosts: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  fetch?: typeof fetch;
  resolve?: Resolver;
}

/** Downloads a file with the protections above. The returned stream errors if it exceeds `maxBytes`. */
export async function safeDownload(
  rawUrl: string,
  opts: SafeDownloadOptions,
): Promise<SafeDownload> {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const fetchImpl = opts.fetch ?? fetch;
  const resolve = opts.resolve ?? defaultResolver;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);

  let current = rawUrl;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const url = checkUrlShape(current, opts.allowedHosts);
    const addresses = await resolve(url.hostname).catch(() => {
      throw new UnsafeUrlError("Host could not be resolved");
    });
    if (addresses.length === 0 || addresses.some(isPrivateIp))
      throw new UnsafeUrlError("Host resolves to a non-public address");

    const res = await fetchImpl(url, { redirect: "manual", signal, headers: { accept: "*/*" } });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new UnsafeUrlError("Redirect without a location");
      current = new URL(location, url).toString(); // validated again at the top of the loop
      continue;
    }
    if (!res.ok || !res.body) throw new UnsafeUrlError(`Download failed (${res.status})`);

    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body.cancel();
      throw new UnsafeUrlError("File is too large");
    }
    let seen = 0;
    const limited = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen += chunk.byteLength;
          if (seen > maxBytes) controller.error(new UnsafeUrlError("File is too large"));
          else controller.enqueue(chunk);
        },
      }),
    );
    return {
      stream: limited,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      contentLength: Number.isFinite(declared) ? declared : undefined,
    };
  }
  throw new UnsafeUrlError("Too many redirects");
}

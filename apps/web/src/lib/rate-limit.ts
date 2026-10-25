/**
 * Small in-memory sliding-window limiter for public endpoints (e.g. the waitlist form).
 * Cloudflare rules are the main line of defence in production (docs/security.md §9); this protects
 * a single instance and local development. Not shared between processes.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>();
  const now = opts.now ?? Date.now;
  return {
    /** Returns true when the request is allowed. */
    allow(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < opts.windowMs);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.every((x) => t - x >= opts.windowMs)) hits.delete(k);
      }
      return true;
    },
  };
}

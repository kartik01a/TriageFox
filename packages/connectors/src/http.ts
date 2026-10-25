export type FetchLike = typeof fetch;

export class ProviderError extends Error {
  constructor(
    readonly provider: "trello" | "jira" | "crisp" | "openai",
    /** Our classification, independent of the provider's wording. */
    readonly kind: "auth" | "not_found" | "rate_limited" | "invalid" | "unavailable",
    message: string,
    readonly status?: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function classify(status: number): ProviderError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "invalid";
}

/** JSON request with a timeout. Throws ProviderError for non-2xx so callers can react by kind. */
export async function requestJson<T>(
  provider: ProviderError["provider"],
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ProviderError(
      provider,
      "unavailable",
      `${provider} is unreachable: ${(err as Error).message}`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after"));
    throw new ProviderError(
      provider,
      classify(res.status),
      `${provider} responded ${res.status}`,
      res.status,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(
      provider,
      "invalid",
      `${provider} returned a non-JSON response`,
      res.status,
    );
  }
}

export async function api<T>(
  url: string,
  init?: RequestInit,
): Promise<T & { ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, init);
    return (await res.json()) as T & { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "Network error. Please try again." } as T & {
      ok: boolean;
      error?: string;
    };
  }
}

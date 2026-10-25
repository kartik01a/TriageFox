"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Trello returns the token in the URL fragment (`#token=...`), which browsers never send to servers.
 * We read it once, remove it from the address bar and history, and post it to our API to be sealed.
 */
export function TrelloCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError("Trello didn't return an access token. Did you click Deny?");
      return;
    }
    fetch("/api/connections/trello", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = (await res.json()) as { ok: boolean; error?: string; connectionId?: string };
        if (data.ok) router.replace(`/app/connections/${data.connectionId}?connected=trello`);
        else setError(data.error ?? "Could not connect Trello.");
      })
      .catch(() => setError("Network error. Please try again."));
  }, [router]);

  return error ? (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-danger" role="alert">
        {error}
      </p>
      <Link href="/app/connections" className="text-sm font-medium text-primary hover:underline">
        Back to connections
      </Link>
    </div>
  ) : (
    <p className="mt-2 text-sm text-muted-foreground" role="status">
      Securing your connection…
    </p>
  );
}

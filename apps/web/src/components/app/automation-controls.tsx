"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
}

export function EnableButton({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function flip() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/automation/${id}`, "PATCH", { enabled: !enabled });
    if (!r.ok) setError(r.error ?? "Could not change this.");
    setBusy(false);
    router.refresh();
  }
  return (
    <div className="space-y-2">
      <Button onClick={flip} disabled={busy} variant={enabled ? "outline" : "primary"} size="lg">
        {busy ? "One moment…" : enabled ? "Pause automation" : "Turn on automation"}
      </Button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function DestinationToggle({
  automationId,
  destinationId,
  enabled,
  label,
}: {
  automationId: string;
  destinationId: string;
  enabled: boolean;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Shows the new state at once; goes back if saving fails.
  const [on, setOn] = useState(enabled);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={on}
        disabled={busy}
        aria-label={`Send tickets to ${label}`}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          setBusy(true);
          const r = await call(
            `/api/automation/${automationId}/destinations/${destinationId}`,
            "PATCH",
            { enabled: next },
          );
          if (!r.ok) setOn(!next);
          setBusy(false);
          router.refresh();
        }}
      />
      Send tickets here
    </label>
  );
}

export function RetryButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={state !== "idle"}
      onClick={async () => {
        setState("busy");
        const r = await call(`/api/tickets/${ticketId}/retry`, "POST");
        setState(r.ok ? "sent" : "idle");
        router.refresh();
      }}
    >
      {state === "sent" ? "Retrying…" : "Try again"}
    </Button>
  );
}

/** Refreshes the page every few seconds while we wait for the customer to finish something elsewhere. */
export function AutoRefresh({ every = 4000, active }: { every?: number; active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}

export function CreateAutomationButton({ label = "Continue" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await call("/api/automation", "POST");
          if (!r.ok) setError(r.error ?? "Could not continue.");
          setBusy(false);
          router.refresh();
        }}
      >
        {busy ? "One moment…" : label}
      </Button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RetryAllButton({ count }: { count: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  return (
    <Button
      size="sm"
      disabled={state !== "idle"}
      onClick={async () => {
        setState("busy");
        const r = await call("/api/tickets/retry-all", "POST");
        setState(r.ok ? "sent" : "idle");
        router.refresh();
      }}
    >
      {state === "sent" ? "Sending again…" : `Try all ${count} again`}
    </Button>
  );
}

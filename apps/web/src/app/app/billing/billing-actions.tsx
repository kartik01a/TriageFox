"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json().catch(() => ({ ok: false, error: "Something went wrong." }))) as {
    ok: boolean;
    error?: string;
    url?: string;
    planName?: string;
  };
}

export function ChooseButton({
  planId,
  interval,
  currency,
  label,
  disabled,
  primary,
}: {
  planId: string;
  interval: "monthly" | "yearly";
  currency: string;
  label: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        variant={primary ? "primary" : "outline"}
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await post("/api/billing/checkout", { planId, interval, currency });
          if (r.ok && r.url) window.location.assign(r.url);
          else {
            setError(r.error ?? "Could not open checkout.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening checkout…" : label}
      </Button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function PortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await post("/api/billing/portal");
          if (r.ok && r.url) window.location.assign(r.url);
          else {
            setError(r.error ?? "Could not open the portal.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening…" : "Manage payment"}
      </Button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RedeemForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    const r = await post("/api/billing/redeem", { code: new FormData(form).get("code") });
    setBusy(false);
    if (r.ok) {
      form.reset();
      setMsg({ ok: true, text: `Done: you now have free access to ${r.planName}.` });
      setTimeout(() => window.location.reload(), 1200);
    } else setMsg({ ok: false, text: r.error ?? "That code didn't work." });
  }
  return (
    <form method="post" onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56 flex-1">
        <Label htmlFor="invite">Invite code</Label>
        <Input id="invite" name="code" autoComplete="off" required />
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        {busy ? "Checking…" : "Redeem"}
      </Button>
      {msg && (
        <p
          className={msg.ok ? "basis-full text-sm text-success" : "basis-full text-sm text-danger"}
          role="status"
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}

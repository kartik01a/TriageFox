"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

/**
 * Opens a payment page (checkout, portal) in a new tab. The tab is opened during the click itself, so
 * browsers don't block it as a pop-up, and pointed at the link once the server has made it.
 */
async function openInNewTab(make: () => Promise<{ ok: boolean; url?: string; error?: string }>) {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null; // the payment site gets no handle on this page
  const r = await make();
  if (r.ok && r.url) {
    if (tab) tab.location.href = r.url;
    else window.location.assign(r.url); // pop-ups fully blocked: same tab rather than nothing
  } else tab?.close();
  return r;
}

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
          const r = await openInNewTab(() =>
            post("/api/billing/checkout", { planId, interval, currency }),
          );
          setBusy(false);
          if (!r.ok) setError(r.error ?? "Could not open checkout.");
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

type Preview = {
  kind: "now" | "at_renewal";
  planName: string;
  interval: "monthly" | "yearly";
  chargeToday: string | null;
  effectiveAt: string | null;
};

const longDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "long" })
    : "your next billing date";

/**
 * Changing the plan of a paying workspace (ADR 0015): first asks the provider what it would cost today,
 * then confirms. Never opens a second checkout.
 */
export function ChangePlanButton({
  planId,
  interval,
  label,
  disabled,
  primary,
}: {
  planId: string;
  interval: "monthly" | "yearly";
  label: string;
  disabled?: boolean;
  primary?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    const r = (await post("/api/billing/change/preview", { planId, interval })) as Awaited<
      ReturnType<typeof post>
    > &
      Partial<Preview>;
    setBusy(false);
    if (r.ok && r.kind) setPreview(r as Preview);
    else setError(r.error ?? "Could not check this change.");
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await post("/api/billing/change", { planId, interval });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "The plan could not be changed.");
    setPreview(null);
    if (preview?.kind === "now") {
      setDone("Upgrading… your new plan shows here in a moment.");
      // The plan follows the payment provider's confirmation, which arrives within seconds.
      for (const wait of [3000, 8000, 15000]) setTimeout(() => router.refresh(), wait);
    } else {
      setDone(null);
      router.refresh();
    }
  }

  if (done)
    return (
      <p className="text-sm text-success" role="status">
        {done}
      </p>
    );

  if (preview)
    return (
      <div
        className="space-y-3 rounded-lg border border-border p-3 text-sm"
        role="dialog"
        aria-label="Confirm plan change"
      >
        {preview.kind === "now" ? (
          <p>
            You'll be charged <strong>{preview.chargeToday}</strong> today for the rest of this
            billing period. {preview.planName} and its limits start straight away.
          </p>
        ) : (
          <p>
            You'll move to <strong>{preview.planName}</strong> ({preview.interval}) on{" "}
            <strong>{longDate(preview.effectiveAt)}</strong>. Nothing is charged today, and you keep
            your current plan until then.
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={confirm} disabled={busy}>
            {busy ? "One moment…" : preview.kind === "now" ? "Pay and upgrade" : "Schedule change"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPreview(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <div className="space-y-2">
      <Button
        className="w-full"
        variant={primary ? "primary" : "outline"}
        disabled={busy || disabled}
        onClick={ask}
      >
        {busy ? "Checking…" : label}
      </Button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Undoes a plan change scheduled for the next billing date. */
export function KeepPlanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/billing/change", { method: "DELETE" });
          const r = (await res.json().catch(() => ({ ok: false }))) as {
            ok: boolean;
            error?: string;
          };
          setBusy(false);
          if (r.ok) router.refresh();
          else setError(r.error ?? "Could not undo the change.");
        }}
      >
        {busy ? "One moment…" : "Keep my current plan"}
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
          const r = await openInNewTab(() => post("/api/billing/portal"));
          setBusy(false);
          if (!r.ok) setError(r.error ?? "Could not open the portal.");
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

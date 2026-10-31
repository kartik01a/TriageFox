"use client";

import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { type FormEvent, useState } from "react";
import { useStepUpFetch } from "@/components/app/step-up";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ uri: string; codes: string[] } | null>(null);
  const [shownCodes, setShownCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({
      password: String(new FormData(e.currentTarget).get("password")),
    });
    setBusy(false);
    if (err || !data)
      return setError("That password isn't right. (Google sign-in? Set a password first.)");
    if (data.method !== "totp")
      return setError("Authenticator apps aren't available for this account.");
    setSetup({ uri: data.totpURI, codes: data.backupCodes });
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({
      code: String(new FormData(e.currentTarget).get("code")).trim(),
    });
    setBusy(false);
    if (err) return setError("That code isn't right. Check the time on your phone and try again.");
    setShownCodes(setup?.codes ?? []);
    setSetup(null);
    router.refresh();
  }

  async function disable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.disable({
      password: String(new FormData(e.currentTarget).get("password")),
    });
    setBusy(false);
    if (err) return setError("That password isn't right.");
    router.refresh();
  }

  if (shownCodes)
    return (
      <div className="space-y-3">
        <p className="font-medium text-success">Two-factor sign-in is on.</p>
        <p className="text-sm text-muted-foreground">
          Save these backup codes somewhere safe. Each works once if you lose your phone. They won't
          be shown again.
        </p>
        <pre className="rounded-lg bg-muted p-4 font-mono text-sm">{shownCodes.join("\n")}</pre>
        <Button variant="outline" onClick={() => setShownCodes(null)}>
          I've saved them
        </Button>
      </div>
    );

  if (setup)
    return (
      <form method="post" onSubmit={verify} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Scan this with an authenticator app (1Password, Google Authenticator, Authy), then enter
          the 6-digit code it shows.
        </p>
        <div className="inline-block rounded-lg bg-white p-3">
          <QRCodeSVG value={setup.uri} size={160} title="Two-factor setup code" />
        </div>
        <div className="max-w-xs">
          <Label htmlFor="totp">6-digit code</Label>
          <Input id="totp" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Turn on"}
        </Button>
      </form>
    );

  return (
    <form method="post" onSubmit={enabled ? disable : start} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {enabled
          ? "Two-factor sign-in is on for your account."
          : "Add a second step when you sign in, so a stolen password isn't enough."}
      </p>
      <div className="max-w-xs">
        <Label htmlFor="pw">Your password</Label>
        <Input id="pw" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant={enabled ? "outline" : "primary"} disabled={busy}>
        {enabled ? "Turn off two-factor" : "Set up two-factor"}
      </Button>
    </form>
  );
}

export function Require2faSwitch({ initial }: { initial: boolean }) {
  const router = useRouter();
  const stepUpFetch = useStepUpFetch();
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-primary"
          checked={on}
          onChange={async (e) => {
            const next = e.target.checked;
            setError(null);
            const res = await stepUpFetch("/api/security/require-2fa", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ enabled: next }),
            });
            const data = (await res.json().catch(() => ({ ok: false }))) as {
              ok: boolean;
              error?: string;
            };
            if (data.ok) {
              setOn(next);
              router.refresh();
            } else setError(data.error ?? "Could not change this.");
          }}
        />
        <span>
          <span className="block font-medium">Require two-factor sign-in for everyone</span>
          <span className="text-muted-foreground">
            Members without it are asked to set it up before they can use the workspace. You need it
            on your own account first.
          </span>
        </span>
      </label>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface SessionRow {
  token: string;
  userAgent: string;
  ip: string;
  createdAt: string;
}

export function SessionList({
  sessions,
  currentToken,
}: {
  sessions: SessionRow[];
  currentToken: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border">
        {sessions.map((s) => (
          <li
            key={s.token}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                {s.userAgent.slice(0, 80)}
                {s.token === currentToken && (
                  <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">
                    This device
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.ip && `${s.ip} · `}signed in {new Date(s.createdAt).toLocaleString()}
              </p>
            </div>
            {s.token !== currentToken && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await authClient.revokeSession({ token: s.token });
                  setBusy(false);
                  router.refresh();
                }}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await authClient.revokeOtherSessions();
            setBusy(false);
            router.refresh();
          }}
        >
          Sign out everywhere else
        </Button>
      )}
    </div>
  );
}

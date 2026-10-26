"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setBusy(true);
    setError(null);
    const { error: err } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    setBusy(false);
    if (err) {
      setError(
        err.status === 429 ? "Too many attempts. Please wait a minute." : "That code isn't right.",
      );
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="code">{backup ? "Backup code" : "6-digit code"}</Label>
        <Input
          id="code"
          name="code"
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          required
          autoFocus
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Checking…" : "Sign in"}
      </Button>
      <button
        type="button"
        className="w-full text-center text-sm text-primary hover:underline"
        onClick={() => {
          setBackup(!backup);
          setError(null);
        }}
      >
        {backup ? "Use my authenticator app" : "Use a backup code instead"}
      </button>
    </form>
  );
}

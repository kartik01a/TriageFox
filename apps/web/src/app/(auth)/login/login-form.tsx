"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    setBusy(true);
    setError(null);
    setUnverified(null);
    const { data, error } = await authClient.signIn.email({
      email,
      password: String(form.get("password")),
      callbackURL: next,
    });
    setBusy(false);
    if (error) {
      if (error.status === 403) setUnverified(email);
      else
        setError(
          error.status === 429
            ? "Too many attempts. Please wait a minute."
            : "Incorrect email or password.",
        );
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      router.push("/two-factor");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function resend() {
    if (!unverified) return;
    await authClient.sendVerificationEmail({ email: unverified, callbackURL: next });
    setResent(true);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="mb-1.5 text-sm text-primary hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {unverified && (
        <p className="rounded-lg bg-muted p-3 text-sm" role="alert">
          Please confirm your email first.{" "}
          {resent ? (
            <span className="text-success">We sent a new link.</span>
          ) : (
            <button
              type="button"
              onClick={resend}
              className="font-medium text-primary hover:underline"
            >
              Resend the confirmation email
            </button>
          )}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

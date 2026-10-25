"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <p className="mt-4 text-sm text-danger" role="alert">
        This reset link is invalid or has expired.{" "}
        <Link href="/forgot-password" className="font-medium underline">
          Request a new one
        </Link>
        .
      </p>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const newPassword = String(new FormData(e.currentTarget).get("password"));
    if (newPassword.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    setBusy(true);
    const { error } = await authClient.resetPassword({ newPassword, token: token ?? "" });
    setBusy(false);
    if (error) setError("This reset link is invalid or has expired.");
    else router.push("/login");
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Card>
      <h1 className="text-xl font-bold">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </Card>
  );
}

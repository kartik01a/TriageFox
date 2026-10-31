"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function slugify(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workspace";
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export function OnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name")).trim();
    if (name.length < 2) {
      setError("Please enter a workspace name.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await authClient.organization.create({ name, slug: slugify(name) });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Could not create the workspace.");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <Label htmlFor="name">Workspace name</Label>
        <Input id="name" name="name" placeholder="Acme Inc." maxLength={60} required />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}

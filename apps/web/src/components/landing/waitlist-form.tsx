"use client";

import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State = { status: "idle" | "loading" | "done" } | { status: "error"; message: string };

export function WaitlistForm({ source = "landing" }: { source?: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), website: form.get("website"), source }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setState(
        data.ok
          ? { status: "done" }
          : { status: "error", message: data.error ?? "Something went wrong." },
      );
    } catch {
      setState({ status: "error", message: "Network error. Please try again." });
    }
  }

  if (state.status === "done") {
    return (
      <p
        className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm font-medium text-success"
        role="status"
      >
        <Check className="size-4" aria-hidden="true" /> You're on the list. We'll email you when
        TriageFox opens.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="waitlist-email" className="sr-only">
          Email address
        </label>
        <Input
          id="waitlist-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
        />
        {/* Honeypot: hidden from people and assistive tech, bots tend to fill it. */}
        <div className="absolute -left-[9999px]" aria-hidden="true">
          <input name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <Button type="submit" disabled={state.status === "loading"} className="shrink-0">
          {state.status === "loading" ? "Joining…" : "Join the waitlist"}
        </Button>
      </div>
      {state.status === "error" && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}

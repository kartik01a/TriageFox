"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { SUPPORT_TOPICS } from "@/lib/support-topics";

export function SupportForm({
  name,
  email,
  page,
}: {
  name?: string;
  email?: string;
  page?: string;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch("/api/support", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const out = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy(false);
    if (res?.ok && out?.ok) setSentTo(String(body.email));
    else
      setError(
        res?.status === 429
          ? "You've sent several messages in a short time. Please try again in an hour, or email us."
          : (out?.error ?? "Something went wrong. Please email us instead."),
      );
  }

  if (sentTo)
    return (
      <div role="status" className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
        <p className="font-medium">Thanks, we've got your message.</p>
        <p className="mt-1 text-muted-foreground">We'll answer by email at {sentTo}.</p>
      </div>
    );

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="support-name">Your name</Label>
          <Input
            id="support-name"
            name="name"
            autoComplete="name"
            maxLength={100}
            defaultValue={name}
            required
          />
        </div>
        <div>
          <Label htmlFor="support-email">Email for our reply</Label>
          <Input
            id="support-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            defaultValue={email}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="support-topic">What is it about?</Label>
        <Select id="support-topic" name="topic" defaultValue="question">
          {Object.entries(SUPPORT_TOPICS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="support-message">Message</Label>
        <textarea
          id="support-message"
          name="message"
          rows={7}
          minLength={10}
          maxLength={5000}
          required
          placeholder="What happened, what you expected, and the workspace or board it's about."
          className={cn(
            "w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm placeholder:text-muted-foreground",
            "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          )}
        />
      </div>
      {page && <input type="hidden" name="page" value={page} />}
      {/* Left empty by people (it is hidden from them); bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="support-website">Website</label>
        <input id="support-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}

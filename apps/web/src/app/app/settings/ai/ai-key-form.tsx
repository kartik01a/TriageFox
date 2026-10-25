"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function AiKeyForm({
  hint,
  verifiedAt,
  canManage,
  models,
}: {
  hint: string | null;
  verifiedAt: string | null;
  canManage: boolean;
  models: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    setDone(false);
    const res = await fetch("/api/ai-key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: new FormData(form).get("key") }),
    }).catch(() => null);
    const data = res
      ? ((await res.json()) as { ok: boolean; error?: string })
      : { ok: false, error: "Network error. Please try again." };
    setBusy(false);
    if (!data.ok) return setError(data.error ?? "Could not save the key.");
    form.reset(); // the key must not linger in the page
    setDone(true);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("Remove your OpenAI key? Automations that use it will pause.")) return;
    setBusy(true);
    await fetch("/api/ai-key", { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      {hint ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Current key</p>
            <p className="font-mono text-lg">{hint}</p>
            {verifiedAt && (
              <p className="text-xs text-muted-foreground">
                Checked{" "}
                {new Date(verifiedAt).toLocaleString("en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            )}
          </div>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={busy}
              className="text-danger"
            >
              Remove key
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No key saved. TriageFox's own AI is used where your plan includes it.
        </p>
      )}
      {canManage ? (
        <form onSubmit={save} className="space-y-3" autoComplete="off">
          <div>
            <Label htmlFor="key">{hint ? "Replace key" : "OpenAI API key"}</Label>
            <Input
              id="key"
              name="key"
              type="password"
              placeholder="sk-…"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              We'll check it works with the models TriageFox uses ({models.join(", ")}) before
              saving.
            </p>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-sm text-success" role="status">
              Key verified and saved.
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? "Checking…" : hint ? "Verify and replace" : "Verify and save"}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only owners and admins can change the AI key.
        </p>
      )}
    </>
  );
}

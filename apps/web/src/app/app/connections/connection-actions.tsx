"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ConnectionActions({
  id,
  label,
  redirectAfterDelete = false,
}: {
  id: string;
  label: string;
  redirectAfterDelete?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"check" | "delete" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function check() {
    setBusy("check");
    setMsg(null);
    const res = await fetch(`/api/connections/${id}/check`, { method: "POST" });
    const data = (await res.json()) as {
      ok: boolean;
      status?: string;
      error?: string;
      detail?: string;
    };
    setBusy(null);
    setMsg(
      data.ok
        ? data.status === "active"
          ? "Connection is working."
          : (data.detail ?? "Reconnect needed.")
        : (data.error ?? "Check failed."),
    );
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Disconnect ${label}? Automations using it will stop until you reconnect.`))
      return;
    setBusy("delete");
    const res = await fetch(`/api/connections/${id}`, { method: "DELETE" });
    const data = (await res.json()) as { ok: boolean; error?: string };
    setBusy(null);
    if (!data.ok) return setMsg(data.error ?? "Could not disconnect.");
    router.push(redirectAfterDelete ? "/app/connections?disconnected=1" : "/app/connections");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={check} disabled={busy !== null}>
        {busy === "check" ? "Checking…" : "Check connection"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={remove}
        disabled={busy !== null}
        className="text-danger"
      >
        {busy === "delete" ? "Disconnecting…" : "Disconnect"}
      </Button>
      {msg && (
        <span className="text-sm text-muted-foreground" role="status">
          {msg}
        </span>
      )}
    </div>
  );
}

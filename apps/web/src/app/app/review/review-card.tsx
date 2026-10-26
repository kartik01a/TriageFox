"use client";

import { PRIORITIES, TICKET_TYPE_LABELS, TICKET_TYPES } from "@triagefox/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

interface Item {
  id: string;
  title: string;
  summary: string;
  type: string;
  priority: number;
  confidence: number;
  dueDate: string | null;
  createdAt: string;
}

export function ReviewCard({ item, canManage }: { item: Item; canManage: boolean }) {
  const router = useRouter();
  const [type, setType] = useState(item.type);
  const [priority, setPriority] = useState(item.priority);
  const [busy, setBusy] = useState<"create" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "create" | "dismiss") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/review/${item.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, type, priority }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-semibold">{item.title}</h2>
        <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{item.summary}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          The AI was {Math.round(item.confidence * 100)}% sure
          {item.dueDate ? ` · due ${item.dueDate}` : ""}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <label htmlFor={`type-${item.id}`} className="font-medium">
            Type
          </label>
          <Select
            id={`type-${item.id}`}
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={!canManage}
          >
            {TICKET_TYPES.map((t) => (
              <option key={t} value={t}>
                {TICKET_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor={`priority-${item.id}`} className="font-medium">
            Priority
          </label>
          <Select
            id={`priority-${item.id}`}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            disabled={!canManage}
          >
            {[...PRIORITIES].reverse().map((p) => (
              <option key={p} value={p}>
                P{p}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <div className="flex gap-3">
          <Button onClick={() => act("create")} disabled={busy !== null}>
            {busy === "create" ? "Creating…" : "Create ticket"}
          </Button>
          <Button variant="outline" onClick={() => act("dismiss")} disabled={busy !== null}>
            {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
          </Button>
        </div>
      )}
    </Card>
  );
}

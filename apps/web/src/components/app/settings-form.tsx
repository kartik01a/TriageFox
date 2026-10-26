"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TicketPreview } from "./ticket-preview";

export interface Settings {
  includeSourceLink: boolean;
  includeCustomerNames: boolean;
  minConfidence: number;
  quietWindowSec: number;
  timezone: string;
  language: string;
}

export function SettingsForm({
  automationId,
  initial,
  canManage,
}: {
  automationId: string;
  initial: Settings;
  canManage: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // A fresh automation has the placeholder time zone; start from the browser's real one.
  useEffect(() => {
    if (initial.timezone === "UTC") {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone) setS((cur) => (cur.timezone === "UTC" ? { ...cur, timezone: zone } : cur));
    }
  }, [initial.timezone]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/automation/${automationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { ...s, reviewed: true } }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      setMessage(
        data.ok
          ? { ok: true, text: "Saved." }
          : { ok: false, text: data.error ?? "Could not save." },
      );
      if (data.ok) router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not save. Please try again." });
    }
    setSaving(false);
  }

  const toggle = (
    key: "includeSourceLink" | "includeCustomerNames",
    label: string,
    hint: string,
  ) => (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-1 size-4 accent-primary"
        checked={s[key]}
        disabled={!canManage}
        onChange={(e) => setS({ ...s, [key]: e.target.checked })}
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        {toggle(
          "includeSourceLink",
          "Include a link to the Crisp conversation",
          "Handy for checking the AI's work. Off by default because some teams don't want ticket readers to see the chat.",
        )}
        {toggle(
          "includeCustomerNames",
          "Include customer names",
          "Off: tickets say “Reported by 3 customers”. On: they name the people.",
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <label htmlFor="tz" className="font-medium">
              Time zone
            </label>
            <Input
              id="tz"
              value={s.timezone}
              disabled={!canManage}
              onChange={(e) => setS({ ...s, timezone: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Used to understand “by Friday”.</p>
          </div>
          <div className="space-y-1 text-sm">
            <label htmlFor="lang" className="font-medium">
              Ticket language
            </label>
            <Input
              id="lang"
              value={s.language}
              disabled={!canManage}
              onChange={(e) => setS({ ...s, language: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Two letters, for example en or de.</p>
          </div>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="conf" className="font-medium">
            Ask me first when the AI is less than {Math.round(s.minConfidence * 100)}% sure
          </label>
          <input
            id="conf"
            type="range"
            min={30}
            max={95}
            step={5}
            className="w-full accent-primary"
            value={Math.round(s.minConfidence * 100)}
            disabled={!canManage}
            onChange={(e) => setS({ ...s, minConfidence: Number(e.target.value) / 100 })}
          />
          <p className="text-xs text-muted-foreground">
            Those tickets wait in Review instead of going straight to Trello or Jira.
          </p>
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="quiet" className="font-medium">
            Wait {Math.round(s.quietWindowSec / 60)} min of quiet before reading a chat
          </label>
          <input
            id="quiet"
            type="range"
            min={1}
            max={15}
            step={1}
            className="w-full accent-primary"
            value={Math.round(s.quietWindowSec / 60)}
            disabled={!canManage}
            onChange={(e) => setS({ ...s, quietWindowSec: Number(e.target.value) * 60 })}
          />
          <p className="text-xs text-muted-foreground">
            Groups quick messages into one decision. A resolved chat is read straight away.
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
            {message && (
              <span
                role={message.ok ? "status" : "alert"}
                className={message.ok ? "text-sm text-success" : "text-sm text-danger"}
              >
                {message.text}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">What a ticket will look like</p>
        <TicketPreview
          includeSourceLink={s.includeSourceLink}
          includeCustomerNames={s.includeCustomerNames}
        />
      </div>
    </div>
  );
}

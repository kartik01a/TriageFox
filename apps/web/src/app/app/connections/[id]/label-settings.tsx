"use client";

import {
  PRIORITIES,
  PRIORITY_NAMES,
  type Priority,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  type TicketType,
  TRELLO_LABEL_COLORS,
} from "@triagefox/shared";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { api } from "./api";

type Option = { id: string; name: string; color?: string | null };
type Choice = Record<string, string | null>;
const DEFAULT = "__default";
const NONE = "__none";
const NEW = "__new";

const toValue = (choice: Choice, key: string) =>
  !Object.hasOwn(choice, key) ? DEFAULT : choice[key] === null ? NONE : String(choice[key]);

/**
 * Which label a ticket gets for each priority level and type (ADR 0013). The AI keeps its fixed scale;
 * this only decides what appears on the card or issue. "Default" keeps TriageFox's own label.
 */
export function LabelSettings({ id, provider }: { id: string; provider: "trello" | "jira" }) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [priorities, setPriorities] = useState<Choice>({});
  const [types, setTypes] = useState<Choice>({});
  const [creating, setCreating] = useState<{ group: "p" | "t"; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ labels: (Option | string)[]; choice: { priorities?: Choice; types?: Choice } }>(
      `/api/connections/${id}/labels`,
    ).then((r) => {
      if (!r.ok) return setError(r.error ?? "Could not load the labels.");
      setOptions(r.labels.map((l) => (typeof l === "string" ? { id: l, name: l } : l)));
      setPriorities(r.choice.priorities ?? {});
      setTypes(r.choice.types ?? {});
    });
  }, [id]);

  function pick(group: "p" | "t", key: string, value: string) {
    setSaved(false);
    if (value === NEW) return setCreating({ group, key });
    const set = group === "p" ? setPriorities : setTypes;
    set((prev) => {
      const next = { ...prev };
      if (value === DEFAULT) delete next[key];
      else next[key] = value === NONE ? null : value;
      return next;
    });
  }

  async function create(name: string, color: string) {
    if (!creating) return;
    setError(null);
    let made: Option;
    if (provider === "trello") {
      const r = await api<{ label: Option }>(`/api/connections/${id}/labels`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      if (!r.ok) return setError(r.error ?? "Could not create the label.");
      made = r.label;
    } else {
      // Jira creates a label the first time it is used; it only needs a name without spaces.
      if (/\s/.test(name)) return setError("Jira labels can't contain spaces.");
      made = { id: name, name };
    }
    setOptions((prev) => [...(prev ?? []).filter((o) => o.id !== made.id), made]);
    const { group, key } = creating;
    setCreating(null);
    pick(group, key, made.id);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await api(`/api/connections/${id}/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(provider === "trello" ? { priorities, types } : { types }),
    });
    setBusy(false);
    if (r.ok) setSaved(true);
    else setError(r.error ?? "Could not save.");
  }

  if (!options)
    return <p className="text-sm text-muted-foreground">{error ?? "Loading the labels…"}</p>;

  const row = (group: "p" | "t", key: string, title: string, fallback: string) => {
    const choice = group === "p" ? priorities : types;
    const selectId = `label-${group}-${key}`;
    return (
      <div key={selectId} className="grid items-center gap-2 sm:grid-cols-[180px_1fr]">
        <Label htmlFor={selectId} className="mb-0">
          {title}
        </Label>
        <Select
          id={selectId}
          className="h-9"
          value={toValue(choice, key)}
          onChange={(e) => pick(group, key, e.target.value)}
        >
          <option value={DEFAULT}>Default: {fallback}</option>
          <option value={NONE}>No label</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name || `(no name, ${o.color ?? "no colour"})`}
            </option>
          ))}
          <option value={NEW}>+ New label…</option>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        TriageFox always rates priority from 1 (lowest) to 5 (critical) and picks a ticket type.
        Here you choose which of your own labels each one becomes. Several levels can share a label,
        for example Critical and High both as “High”.
      </p>
      {provider === "trello" && (
        <fieldset className="space-y-2">
          <legend className="mb-2 font-medium">Priority</legend>
          {[...PRIORITIES]
            .reverse()
            .map((p) =>
              row(
                "p",
                String(p),
                `${p} · ${PRIORITY_NAMES[p as Priority]}`,
                `P${p} ${PRIORITY_NAMES[p as Priority]}`,
              ),
            )}
        </fieldset>
      )}
      {provider === "jira" && (
        <p className="text-sm text-muted-foreground">
          Jira priority is set with the mapping above. Below are the labels added for each type.
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">Type</legend>
        {TICKET_TYPES.map((t) =>
          row(
            "t",
            t,
            TICKET_TYPE_LABELS[t as TicketType],
            provider === "trello" ? TICKET_TYPE_LABELS[t as TicketType] : t,
          ),
        )}
      </fieldset>

      {creating && (
        <NewLabelForm
          // A fresh form (and scroll) each time "New label" is chosen on another row.
          key={`${creating.group}-${creating.key}`}
          provider={provider}
          forWhat={
            creating.group === "p"
              ? `Priority ${creating.key} · ${PRIORITY_NAMES[Number(creating.key) as Priority]}`
              : TICKET_TYPE_LABELS[creating.key as TicketType]
          }
          onCancel={() => setCreating(null)}
          onCreate={create}
        />
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-success" role="status">
          Saved. New tickets will use these labels.
        </p>
      )}
      <Button onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save labels"}
      </Button>
    </div>
  );
}

function NewLabelForm({
  provider,
  forWhat,
  onCreate,
  onCancel,
}: {
  provider: "trello" | "jira";
  forWhat: string;
  onCreate: (name: string, color: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("sky");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // The form opens below both lists, often off screen: bring it into view and put the cursor in it,
  // so choosing "New label" visibly does something.
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    nameInput.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div ref={box} className="rounded-lg border border-border p-4">
      <fieldset className="space-y-3">
        <legend className="mb-3 text-sm font-medium">New label for {forWhat}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-label-name">Name</Label>
            <Input
              ref={nameInput}
              id="new-label-name"
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={provider === "jira" ? "e.g. customer-bug" : "e.g. High"}
            />
          </div>
          {provider === "trello" && (
            <div>
              <Label htmlFor="new-label-color">Colour</Label>
              <Select
                id="new-label-color"
                className="h-9"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              >
                {TRELLO_LABEL_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              await onCreate(name.trim(), color);
              setBusy(false);
            }}
          >
            {busy ? "Creating…" : provider === "trello" ? "Create on the board" : "Add"}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

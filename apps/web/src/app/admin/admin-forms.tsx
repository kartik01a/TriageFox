"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({ ok: false, error: "Bad response." }))) as {
    ok: boolean;
    error?: string;
    code?: string;
    [k: string]: unknown;
  };
}

/** Compact inputs for the admin area. */
const small = "h-9";

function Status({ msg, ok }: { msg: string | null; ok?: boolean }) {
  if (!msg) return null;
  return (
    <span role="status" className={cn("text-sm", ok ? "text-success" : "text-danger")}>
      {msg}
    </span>
  );
}

function Check({
  name,
  label,
  checked,
  onChange,
  defaultChecked,
}: {
  name?: string;
  label: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="size-4 accent-primary"
      />
      {label}
    </label>
  );
}

const humanise = (k: string) => {
  const t = k.replace(/([A-Z])/g, " $1").toLowerCase();
  return (t.charAt(0).toUpperCase() + t.slice(1))
    .replace(/\bai\b/g, "AI")
    .replace(/\busd\b/g, "USD");
};

/** A JSON text box with a Save button, for the advanced parts (prices, limits) and for new plans. */
export function JsonEditor({
  url,
  method,
  initial,
  label,
}: {
  url: string;
  method: "PUT" | "PATCH" | "POST";
  initial: unknown;
  label: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return setMsg({ text: "That is not valid JSON.", ok: false });
    }
    const r = await send(url, method, value);
    setMsg({
      text: r.ok ? (r.versioned ? "Saved as a new version." : "Saved.") : (r.error ?? "Not saved."),
      ok: r.ok,
    });
    if (r.ok) router.refresh();
  }
  return (
    <form method="post" onSubmit={save} className="space-y-2">
      <label className="block text-sm font-medium">
        {label}
        <textarea
          className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-5"
          rows={Math.min(16, text.split("\n").length + 1)}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Status msg={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </form>
  );
}

type Json = string | number | boolean | Json[] | { [k: string]: Json };

/** Renders any platform setting as plain fields: numbers, switches and comma-separated lists. */
export function SettingForm({ settingKey, initial }: { settingKey: string; initial: Json }) {
  const router = useRouter();
  const [value, setValue] = useState<Json>(initial);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function setAt(path: string[], next: Json) {
    if (path.length === 0) return setValue(next);
    setValue((cur) => {
      const copy = structuredClone(cur) as { [k: string]: Json };
      let node = copy;
      for (const p of path.slice(0, -1)) node = node[p] as { [k: string]: Json };
      node[path[path.length - 1] as string] = next;
      return copy;
    });
  }

  function field(path: string[], v: Json, label: string): ReactNode {
    const id = `${settingKey}-${path.join("-") || "value"}`;
    if (typeof v === "boolean")
      return <Check key={id} label={label} checked={v} onChange={(x) => setAt(path, x)} />;
    if (typeof v === "number")
      return (
        <div key={id}>
          <Label htmlFor={id}>{label}</Label>
          <Input
            id={id}
            type="number"
            step="any"
            className={cn(small, "max-w-40")}
            value={v}
            onChange={(e) => setAt(path, e.target.value === "" ? 0 : Number(e.target.value))}
          />
        </div>
      );
    if (Array.isArray(v))
      return (
        <div key={id}>
          <Label htmlFor={id}>{label} (comma separated)</Label>
          <Input
            id={id}
            className={small}
            defaultValue={v.join(", ")}
            onChange={(e) =>
              setAt(
                path,
                e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      );
    if (v && typeof v === "object")
      return (
        <div key={id} className="grid gap-4 sm:grid-cols-2">
          {Object.entries(v).map(([k, child]) => field([...path, k], child, humanise(k)))}
        </div>
      );
    return null;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = await send("/api/admin/settings", "PUT", { key: settingKey, value });
    setMsg({ text: r.ok ? "Saved." : (r.error ?? "Not saved."), ok: r.ok });
    if (r.ok) router.refresh();
  }

  return (
    <form method="post" onSubmit={save} className="space-y-4">
      {field([], value, humanise(settingKey))}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm">
          Save {humanise(settingKey).toLowerCase()}
        </Button>
        <Status msg={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </form>
  );
}

interface PlanEditorProps {
  id: string;
  name: string;
  supportLevel: string;
  isPopular: boolean;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  currencies: string[];
  providerPriceIds: Record<string, Record<string, { monthly?: string; yearly?: string }>>;
}

/** The everyday plan fields. Changing these never creates a new version. Prices and limits are under "Advanced". */
export function PlanEditor(p: PlanEditorProps) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const dodo: Record<string, { monthly?: string; yearly?: string }> = {};
    for (const c of p.currencies) {
      const monthly = String(f.get(`${c}-monthly`) ?? "").trim();
      const yearly = String(f.get(`${c}-yearly`) ?? "").trim();
      if (monthly || yearly)
        dodo[c] = { ...(monthly ? { monthly } : {}), ...(yearly ? { yearly } : {}) };
    }
    const r = await send(`/api/admin/plans/${p.id}`, "PATCH", {
      name: String(f.get("name")).trim(),
      supportLevel: f.get("supportLevel"),
      sortOrder: Number(f.get("sortOrder")),
      isPublic: f.get("isPublic") === "on",
      isPopular: f.get("isPopular") === "on",
      isActive: f.get("isActive") === "on",
      providerPriceIds: { ...p.providerPriceIds, dodo },
    });
    setMsg({ text: r.ok ? "Saved." : (r.error ?? "Not saved."), ok: r.ok });
    if (r.ok) router.refresh();
  }
  return (
    <form method="post" onSubmit={save} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <Label htmlFor={`name-${p.id}`}>Name</Label>
          <Input id={`name-${p.id}`} name="name" defaultValue={p.name} className={small} required />
        </div>
        <div>
          <Label htmlFor={`support-${p.id}`}>Support</Label>
          <Select
            id={`support-${p.id}`}
            name="supportLevel"
            defaultValue={p.supportLevel}
            className={small}
          >
            <option value="email">Email</option>
            <option value="priority">Priority</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`sort-${p.id}`}>Sort order</Label>
          <Input
            id={`sort-${p.id}`}
            name="sortOrder"
            type="number"
            defaultValue={p.sortOrder}
            className={small}
          />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Dodo product ids</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {p.currencies.flatMap((c) =>
            (["monthly", "yearly"] as const).map((i) => (
              <div key={`${c}-${i}`}>
                <Label htmlFor={`${p.id}-${c}-${i}`} className="text-xs text-muted-foreground">
                  {c} · {i}
                </Label>
                <Input
                  id={`${p.id}-${c}-${i}`}
                  name={`${c}-${i}`}
                  defaultValue={p.providerPriceIds.dodo?.[c]?.[i] ?? ""}
                  placeholder="pdt_…"
                  className={cn(small, "font-mono text-xs")}
                />
              </div>
            )),
          )}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Check
          name="isPublic"
          label="Public (shown on the pricing page)"
          defaultChecked={p.isPublic}
        />
        <Check name="isPopular" label="Most popular badge" defaultChecked={p.isPopular} />
        <Check name="isActive" label="Active (not archived)" defaultChecked={p.isActive} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm">
          Save plan
        </Button>
        <Status msg={msg?.text ?? null} ok={msg?.ok} />
      </div>
    </form>
  );
}

export function WorkspaceActions({
  id,
  plans,
}: {
  id: string;
  plans: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [action, setAction] = useState("extend-trial");
  const [msg, setMsg] = useState<string | null>(null);
  async function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { action };
    if (action === "extend-trial") body.days = Number(f.get("days"));
    if (action === "comp") {
      body.planId = f.get("planId");
      body.months = f.get("months") ? Number(f.get("months")) : null;
      body.reason = f.get("reason");
    }
    const r = await send(`/api/admin/workspaces/${id}`, "POST", body);
    setMsg(r.ok ? "Done." : (r.error ?? "Failed."));
    if (r.ok) router.refresh();
  }
  return (
    <form method="post" onSubmit={run} className="flex flex-wrap items-end gap-2">
      <Select
        value={action}
        onChange={(e) => setAction(e.target.value)}
        className={cn(small, "w-auto")}
        aria-label="Action"
      >
        <option value="extend-trial">Extend trial</option>
        <option value="comp">Give free access</option>
        <option value="revoke-comp">Revoke free access</option>
        <option value="pause">Pause</option>
        <option value="resume">Resume</option>
      </Select>
      {action === "extend-trial" && (
        <Input
          name="days"
          type="number"
          min={1}
          max={90}
          defaultValue={7}
          className={cn(small, "w-[80px]")}
          aria-label="Days"
        />
      )}
      {action === "comp" && (
        <>
          <Select name="planId" className={cn(small, "w-auto")} aria-label="Plan">
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input
            name="months"
            type="number"
            min={1}
            placeholder="months (empty = no end)"
            className={cn(small, "w-[170px]")}
          />
          <Input name="reason" required placeholder="reason" className={cn(small, "w-[160px]")} />
        </>
      )}
      <Button type="submit" size="sm">
        Apply
      </Button>
      {msg && <span role="status">{msg}</span>}
    </form>
  );
}

export function InviteCodeForm({ plans }: { plans: { id: string; name: string }[] }) {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await send("/api/admin/invite-codes", "POST", {
      email: f.get("email"),
      planId: f.get("planId"),
      months: Number(f.get("months")),
    });
    if (r.ok) {
      setCode(String(r.code));
      setMsg(null);
      router.refresh();
    } else setMsg(r.error ?? "Failed.");
  }
  return (
    <form method="post" onSubmit={create} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Input
          name="email"
          type="email"
          required
          placeholder="their email"
          className={cn(small, "w-[240px]")}
          aria-label="Email"
        />
        <Select name="planId" className={cn(small, "w-auto")} aria-label="Plan">
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input
          name="months"
          type="number"
          min={1}
          max={36}
          defaultValue={3}
          className={cn(small, "w-[80px]")}
          aria-label="Months"
        />
        <Button type="submit" size="sm">
          Create code
        </Button>
      </div>
      {msg && <p role="alert">{msg}</p>}
      {code && (
        <p role="status">
          Code (shown once, valid 7 days, only for that email):{" "}
          <code className="rounded bg-muted px-1">{code}</code>
        </p>
      )}
    </form>
  );
}

export function InboxItemActions({
  id,
  status,
  testimonial,
}: {
  id: string;
  status: string;
  testimonial: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  async function patch(body: unknown) {
    const r = await send(`/api/admin/inbox/${id}`, "PATCH", body);
    setMsg(r.ok ? null : (r.error ?? "Failed."));
    if (r.ok) router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        defaultValue={status}
        onChange={(e) => patch({ status: e.target.value })}
        className={cn(small, "w-auto")}
        aria-label="Status"
      >
        <option value="new">New</option>
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
      </Select>
      <Check
        label="Approved to quote"
        defaultChecked={testimonial}
        onChange={(v) => patch({ testimonialApproved: v })}
      />
      <form
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const note = String(f.get("note") ?? "").trim();
          if (note) void patch({ note });
          e.currentTarget.reset();
        }}
        className="flex gap-1"
      >
        <Input
          name="note"
          placeholder="Add a private note"
          className={cn(small, "w-[220px]")}
          aria-label="Note"
        />
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
      {msg && <span role="alert">{msg}</span>}
    </div>
  );
}

export function SupportAutomationForm() {
  const [msg, setMsg] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await send("/api/admin/support-automation", "POST", {
      orgId: String(f.get("orgId")).trim(),
      enabled: f.get("enabled") === "on",
    });
    setMsg(r.ok ? "Saved." : (r.error ?? "Failed."));
  }
  return (
    <form method="post" onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Input
        name="orgId"
        required
        placeholder="workspace id"
        className={cn(small, "w-[300px]")}
        aria-label="Workspace id"
      />
      <Check name="enabled" defaultChecked label="Use as our support automation" />
      <Button type="submit" size="sm">
        Save
      </Button>
      {msg && <span role="status">{msg}</span>}
    </form>
  );
}

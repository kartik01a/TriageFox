"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

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

const field = "w-full rounded border border-input bg-card px-2 py-1";

/** A JSON text box with a Save button: for settings and plan edits (plain on purpose). */
export function JsonEditor({
  url,
  method,
  initial,
  wrap,
  label,
}: {
  url: string;
  method: "PUT" | "PATCH" | "POST";
  initial: unknown;
  /** Wraps the parsed JSON into the request body. */
  wrap?: (value: unknown) => unknown;
  label: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return setMsg("That is not valid JSON.");
    }
    const r = await send(url, method, wrap ? wrap(value) : value);
    setMsg(r.ok ? (r.versioned ? "Saved as a new version." : "Saved.") : (r.error ?? "Not saved."));
    if (r.ok) router.refresh();
  }
  return (
    <form onSubmit={save} className="space-y-1">
      <label className="font-medium">
        {label}
        <textarea
          className={`${field} font-mono`}
          rows={Math.min(14, text.split("\n").length + 1)}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button type="submit" className="rounded border border-input px-3 py-1">
        Save
      </button>{" "}
      {msg && <span role="status">{msg}</span>}
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
    <form onSubmit={run} className="flex flex-wrap items-end gap-2">
      <select
        value={action}
        onChange={(e) => setAction(e.target.value)}
        className={field}
        style={{ width: "auto" }}
        aria-label="Action"
      >
        <option value="extend-trial">Extend trial</option>
        <option value="comp">Give free access</option>
        <option value="revoke-comp">Revoke free access</option>
        <option value="pause">Pause</option>
        <option value="resume">Resume</option>
      </select>
      {action === "extend-trial" && (
        <input
          name="days"
          type="number"
          min={1}
          max={90}
          defaultValue={7}
          className={field}
          style={{ width: 80 }}
          aria-label="Days"
        />
      )}
      {action === "comp" && (
        <>
          <select name="planId" className={field} style={{ width: "auto" }} aria-label="Plan">
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            name="months"
            type="number"
            min={1}
            placeholder="months (empty = no end)"
            className={field}
            style={{ width: 170 }}
          />
          <input
            name="reason"
            required
            placeholder="reason"
            className={field}
            style={{ width: 160 }}
          />
        </>
      )}
      <button type="submit" className="rounded border border-input px-3 py-1">
        Apply
      </button>
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
    <form onSubmit={create} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="their email"
          className={field}
          style={{ width: 240 }}
          aria-label="Email"
        />
        <select name="planId" className={field} style={{ width: "auto" }} aria-label="Plan">
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          name="months"
          type="number"
          min={1}
          max={36}
          defaultValue={3}
          className={field}
          style={{ width: 80 }}
          aria-label="Months"
        />
        <button type="submit" className="rounded border border-input px-3 py-1">
          Create code
        </button>
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
      <select
        defaultValue={status}
        onChange={(e) => patch({ status: e.target.value })}
        className={field}
        style={{ width: "auto" }}
        aria-label="Status"
      >
        <option value="new">New</option>
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
      </select>
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          defaultChecked={testimonial}
          onChange={(e) => patch({ testimonialApproved: e.target.checked })}
        />
        Approved to quote
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const note = String(f.get("note") ?? "").trim();
          if (note) void patch({ note });
          e.currentTarget.reset();
        }}
        className="flex gap-1"
      >
        <input
          name="note"
          placeholder="Add a private note"
          className={field}
          style={{ width: 220 }}
          aria-label="Note"
        />
        <button type="submit" className="rounded border border-input px-2">
          Add
        </button>
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
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <input
        name="orgId"
        required
        placeholder="workspace id"
        className={field}
        style={{ width: 300 }}
        aria-label="Workspace id"
      />
      <label className="flex items-center gap-1">
        <input name="enabled" type="checkbox" defaultChecked /> use as our support automation
      </label>
      <button type="submit" className="rounded border border-input px-3 py-1">
        Save
      </button>
      {msg && <span role="status">{msg}</span>}
    </form>
  );
}

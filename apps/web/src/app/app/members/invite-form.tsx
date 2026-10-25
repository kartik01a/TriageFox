"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function InviteForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMsg(null);
    const { error } = await authClient.organization.inviteMember({
      email: String(data.get("email")).trim().toLowerCase(),
      role: data.get("role") === "admin" ? "admin" : "member",
      organizationId,
    });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message ?? "Could not send the invitation." });
      return;
    }
    form.reset();
    setMsg({ ok: true, text: "Invitation sent." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            placeholder="teammate@company.com"
            required
          />
        </div>
        <div>
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="member"
            className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send invitation"}
        </Button>
      </div>
      {msg && (
        <p
          className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}
          role={msg.ok ? "status" : "alert"}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}

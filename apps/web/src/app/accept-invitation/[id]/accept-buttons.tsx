"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AcceptButtons({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    const { error } = await authClient.organization.acceptInvitation({ invitationId });
    setBusy(false);
    if (error) {
      setError(error.message ?? "Could not accept the invitation.");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  async function decline() {
    await authClient.organization.rejectInvitation({ invitationId });
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Button onClick={accept} disabled={busy} className="flex-1">
          {busy ? "Joining…" : "Accept invitation"}
        </Button>
        <Button variant="outline" onClick={decline} disabled={busy}>
          Decline
        </Button>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

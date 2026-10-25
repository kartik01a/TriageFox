"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function CancelInvitationButton({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient.organization.cancelInvitation({ invitationId });
        router.refresh();
      }}
    >
      Cancel
    </Button>
  );
}

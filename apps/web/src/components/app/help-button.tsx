"use client";

import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    $crisp?: unknown[][];
  }
}

/** Opens the support chat with the signed-in user's identity already attached (see CrispIdentity). */
export function HelpButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        window.$crisp = window.$crisp ?? [];
        window.$crisp.push(["set", "session:data", [[["page", location.pathname]]]]);
        window.$crisp.push(["do", "chat:open"]);
      }}
    >
      Help
    </Button>
  );
}

import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { requireWorkspace } from "@/lib/workspace";
import { TrelloCallback } from "./trello-callback";

export const metadata: Metadata = { title: "Connecting Trello" };

export default async function TrelloCallbackPage() {
  await requireWorkspace();
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-bold">Connecting Trello…</h1>
        <TrelloCallback />
      </Card>
    </div>
  );
}

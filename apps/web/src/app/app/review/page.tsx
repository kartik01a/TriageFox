import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { reviewQueue } from "@/lib/app-data";
import { requireWorkspace } from "@/lib/workspace";
import { ReviewCard } from "./review-card";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage() {
  const { workspace, canManage } = await requireWorkspace();
  const items = await reviewQueue(workspace.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Review</h1>
        <p className="mt-1 text-muted-foreground">
          When the AI isn't sure, it asks you first. Fix the type or priority if needed, then create
          the ticket or dismiss it.
        </p>
      </div>
      {!canManage && (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm">
          Only owners and admins can create or dismiss tickets.
        </p>
      )}
      {items.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          Nothing to review. Unsure cases will appear here.
        </Card>
      ) : (
        items.map((i) => (
          <ReviewCard
            key={i.id}
            canManage={canManage}
            item={{ ...i, createdAt: i.createdAt.toISOString() }}
          />
        ))
      )}
    </div>
  );
}

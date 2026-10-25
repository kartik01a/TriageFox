import { cn } from "@/lib/cn";

const styles: Record<string, string> = {
  active: "bg-success/15 text-success",
  pending: "bg-muted text-muted-foreground",
  error: "bg-danger/15 text-danger",
  revoked: "bg-danger/15 text-danger",
};
const labels: Record<string, string> = {
  active: "Connected",
  pending: "Connecting",
  error: "Problem",
  revoked: "Reconnect needed",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
        styles[status] ?? styles.pending,
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}

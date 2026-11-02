import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        // Our own arrow (globals.css `.tf-select`), kept clear of the rounded border.
        "tf-select h-11 w-full rounded-lg border border-input bg-card pr-10 pl-3 text-sm",
        "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

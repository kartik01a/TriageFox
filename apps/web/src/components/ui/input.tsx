import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

// ComponentProps (not InputHTMLAttributes) so a ref passes through to the input (React 19).
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: the control is associated by the caller via htmlFor
  return <label className={cn("mb-1.5 block text-sm font-medium", className)} {...props} />;
}

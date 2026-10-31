"use client";

import { useId, useState } from "react";

/** Drag to compare: the copy-paste chaos on the left, the clean generated ticket on the right. */
export function BeforeAfter() {
  const id = useId();
  const [pos, setPos] = useState(50);
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-(--radius-card) border border-border bg-card shadow-sm">
        {/* After: the clean ticket (full width underneath) */}
        <div className="p-6 sm:p-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-success">
            After: TriageFox
          </p>
          <div className="space-y-3">
            <p className="text-lg font-semibold">Checkout button unresponsive on Safari</p>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-blue-600 dark:text-blue-400">
                Bug
              </span>
              <span
                className="rounded-full px-2.5 py-0.5 text-white"
                style={{ background: "var(--p4)" }}
              >
                P4 · High
              </span>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">
                Reported by 3 customers
              </span>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Open the checkout page in Safari</li>
              <li>Click “Pay now”</li>
              <li>Nothing happens (expected: the payment form opens)</li>
            </ol>
            <p className="w-fit rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              🖼 screenshot.png attached
            </p>
          </div>
        </div>
        {/* Before: the mess, revealed from the left */}
        <div
          className="absolute inset-0 bg-card p-6 sm:p-8"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          aria-hidden={pos < 5}
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-danger">
            Before: copy and paste
          </p>
          <div className="space-y-2 font-mono text-xs text-muted-foreground">
            <p className="rounded bg-muted p-2">
              [10:42] Maria: checkout button does nothing on safari 😡
            </p>
            <p className="rounded bg-muted p-2">
              [10:43] Maria: [image1.png] (download, rename, attach…)
            </p>
            <p className="rounded bg-muted p-2">
              New issue → Type? Priority? Labels? Board? Title…
            </p>
            <p className="rounded bg-muted p-2">
              [10:51] John: same here!! (search: is this already a ticket?)
            </p>
            <p className="rounded bg-muted p-2">…and again tomorrow, for the next chat.</p>
          </div>
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
          style={{ left: `${pos}%` }}
          aria-hidden="true"
        />
      </div>
      <label htmlFor={id} className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="shrink-0">Drag to compare</span>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </label>
    </div>
  );
}

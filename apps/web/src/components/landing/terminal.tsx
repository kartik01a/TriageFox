"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const COMMAND = "git clone https://github.com/kartik01a/TriageFox.git && ./deploy/setup.sh";
const RESULT = ["✓ images built, secrets generated", "✓ TriageFox running on https://your-domain"];

/** A terminal that types the install command once it scrolls into view. */
export function TerminalDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState(reduce ? COMMAND.length : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const t = setInterval(() => setTyped((n) => (n >= COMMAND.length ? n : n + 2)), 28);
    return () => clearInterval(t);
  }, [inView, reduce]);
  const done = typed >= COMMAND.length;
  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-(--radius-card) border border-border bg-[#111114] text-left font-mono text-xs text-zinc-200 shadow-sm sm:text-sm"
    >
      <div className="flex gap-1.5 border-b border-white/10 px-4 py-2" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-red-500/80" />
        <span className="size-2.5 rounded-full bg-yellow-500/80" />
        <span className="size-2.5 rounded-full bg-green-500/80" />
      </div>
      <div className="min-h-32 space-y-1 p-4">
        <p className="break-all">
          <span className="text-primary">$</span> {COMMAND.slice(0, typed)}
          {!done && (
            <span
              className="ml-0.5 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-zinc-300"
              aria-hidden="true"
            />
          )}
        </p>
        {done &&
          RESULT.map((r) => (
            <p key={r} className="text-green-400">
              {r}
            </p>
          ))}
      </div>
    </div>
  );
}

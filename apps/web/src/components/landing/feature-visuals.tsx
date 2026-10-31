"use client";

import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";

const bubble = "rounded-xl border border-border bg-muted px-2.5 py-1 text-xs";
const PRIORITY = ["p1", "p2", "p3", "p4", "p5"] as const;

/** Two chat bubbles sorted into "Ticket" and "Answer in chat". */
function Sort() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const on = inView || !!reduce;
  return (
    <div ref={ref} className="space-y-2 text-xs">
      {[
        { text: "Checkout is broken on Safari", tag: "Ticket", tone: "bg-primary/15 text-primary" },
        {
          text: "How do I reset my password?",
          tag: "Answer in chat",
          tone: "bg-muted text-muted-foreground",
        },
      ].map((b, i) => (
        <div key={b.text} className="flex items-center justify-between gap-2">
          <span className={bubble}>{b.text}</span>
          <motion.span
            initial={reduce ? false : { opacity: 0, x: 12 }}
            animate={on ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: 0.5 + i * 0.5 }}
            className={`rounded-full px-2 py-0.5 font-semibold ${b.tone}`}
          >
            {b.tag}
          </motion.span>
        </div>
      ))}
    </div>
  );
}

/** A priority chip that steps from green to red. */
function Priority() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(2);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % PRIORITY.length), 1100);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {PRIORITY.map((p, idx) => (
        <span
          key={p}
          className="h-6 flex-1 rounded-md transition-all"
          style={{
            background: `var(--${p})`,
            opacity: idx === i ? 1 : 0.22,
            transform: idx === i ? "scaleY(1.2)" : "none",
          }}
        />
      ))}
      <span className="ml-1 w-8 text-xs font-semibold tabular-nums">P{i + 1}</span>
    </div>
  );
}

/** A screenshot thumbnail sliding into a ticket card. */
function Screenshot() {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-16 overflow-hidden rounded-lg border border-border bg-muted/50 p-2 text-xs">
      <p className="font-semibold">Checkout fails on Safari</p>
      <motion.div
        initial={reduce ? false : { x: 120, opacity: 0 }}
        whileInView={{ x: 0, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7, delay: 0.3 }}
        className="mt-1 inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-muted-foreground"
      >
        🖼 screenshot.png
      </motion.div>
    </div>
  );
}

/** A comment bubble appearing under an existing ticket. */
function Update() {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-1.5 text-xs">
      <div className="rounded-lg border border-border bg-muted/50 px-2 py-1.5 font-semibold">
        KAN-42 · Checkout fails on Safari
      </div>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.5 }}
        className="ml-4 rounded-lg bg-primary/10 px-2 py-1.5"
      >
        Customer added: also fails on iPad
      </motion.div>
    </div>
  );
}

/** "Reported by 1 customer" counting up to 5. */
function Duplicates() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const n = useMotionValue(reduce ? 5 : 1);
  const label = useTransform(
    n,
    (v) => `Reported by ${Math.round(v)} ${Math.round(v) === 1 ? "customer" : "customers"}`,
  );
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(n, 5, { duration: 2.2, ease: "easeOut" });
    return () => c.stop();
  }, [inView, reduce, n]);
  return (
    <div ref={ref} className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs">
      <p className="font-semibold">CSV export is empty</p>
      <motion.p className="mt-1 font-semibold text-primary tabular-nums">{label}</motion.p>
    </div>
  );
}

/** A date appears only when the customer actually gave one. */
function Dates() {
  const reduce = useReducedMotion();
  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className={bubble}>
          “need it <mark className="rounded bg-primary/25 px-0.5">by Friday</mark>”
        </span>
        <motion.span
          initial={reduce ? false : { opacity: 0, scale: 0.7 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.6 }}
          className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success"
        >
          Due Fri
        </motion.span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={bubble}>“please fix soon”</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">no date</span>
      </div>
    </div>
  );
}

const VISUALS = {
  sort: Sort,
  priority: Priority,
  screenshot: Screenshot,
  update: Update,
  duplicates: Duplicates,
  dates: Dates,
} as const;
export type VisualKind = keyof typeof VISUALS;

export function FeatureVisual({ kind }: { kind: VisualKind }) {
  const V = VISUALS[kind];
  return <V />;
}

"use client";

import { Check, ImageIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Hero animation (docs/ui-ux.md): a customer message is "read", then becomes a ticket whose fields
 * fill in one by one. Built from real elements (not a video) so it stays sharp and light.
 * Steps: 0 message in · 1 reading · 2 ticket fields · 3 created in Jira & Trello.
 */
const STEP_MS = [1700, 1400, 2800, 2600];

export function HeroDemo() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEP_MS.length), STEP_MS[step]);
    return () => clearTimeout(t);
  }, [step, reduce]);

  const s = reduce ? 3 : step;

  return (
    <div
      className="grid gap-4 md:grid-cols-[1fr_auto_1.1fr] md:items-center"
      role="img"
      aria-label="A customer chat message about a broken checkout button becomes a prioritised ticket in Jira and Trello"
    >
      {/* Chat */}
      <div className="relative overflow-hidden rounded-(--radius-card) border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium text-muted-foreground">Customer chat</p>
        <motion.div
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          className="ml-auto w-fit max-w-[92%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground"
        >
          Checkout button does nothing on Safari 😡
        </motion.div>
        <div className="mt-2 ml-auto flex w-fit items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" aria-hidden="true" /> screenshot.png
        </div>
        <AnimatePresence>
          {s === 1 && !reduce && (
            <motion.div
              key="scan"
              className="pointer-events-none absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-primary/25 to-transparent"
              initial={{ top: "-20%" }}
              animate={{ top: "100%" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: "easeInOut" }}
            />
          )}
        </AnimatePresence>
        <p className="mt-3 text-xs text-muted-foreground">
          {s === 1
            ? "Reading… is this a bug or a question?"
            : s >= 2
              ? "Needs a code change ✓"
              : " "}
        </p>
      </div>

      <div className="hidden text-2xl text-muted-foreground md:block" aria-hidden="true">
        →
      </div>

      {/* Ticket */}
      <div className="rounded-(--radius-card) border border-border bg-card p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium text-muted-foreground">Ticket</p>
        <AnimatePresence mode="wait">
          {s >= 2 ? (
            <motion.div
              key="ticket"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3"
            >
              <p className="text-sm font-semibold">Checkout button unresponsive on Safari</p>
              <div className="flex flex-wrap gap-2">
                <motion.span
                  initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.25 }}
                  className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400"
                >
                  Bug
                </motion.span>
                <motion.span
                  initial={reduce ? false : { x: -16, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                  style={{ background: "var(--p4)" }}
                >
                  P4 · High
                </motion.span>
              </div>
              <motion.ol
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
                className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground"
              >
                <li>Open the checkout page in Safari</li>
                <li>Click “Pay now”</li>
                <li>Nothing happens (expected: payment form)</li>
              </motion.ol>
              <motion.div
                initial={reduce ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.5 }}
                className="flex w-fit items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                <ImageIcon className="size-3.5" aria-hidden="true" /> screenshot.png attached
              </motion.div>
              {s === 3 && (
                <motion.p
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-1.5 text-xs font-medium text-success"
                >
                  <Check className="size-3.5" aria-hidden="true" /> Created in Jira &amp; Trello
                </motion.p>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="h-12 w-full rounded bg-muted" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

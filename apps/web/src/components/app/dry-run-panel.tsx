"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PriorityChip, TypeChip } from "./chips";

interface Result {
  when: number;
  snippet: string;
  conversationUrl: string;
  decision: "create" | "update" | "duplicate_of" | "no_action";
  category?: string;
  type?: string;
  priority?: number;
  title: string;
  bodyPreview: string;
  reason: string;
  confidence: number;
  needsReview: boolean;
}

const CATEGORY: Record<string, string> = {
  question: "a how-to question",
  billing: "a billing question",
  refund_request: "a refund request",
  account: "an account question",
  complaint: "a complaint with no engineering work",
  praise: "praise",
  greeting: "just a greeting",
  spam: "spam",
};

export function DryRunPanel({ automationId }: { automationId: string }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function run() {
    setState("running");
    setError(null);
    setOpen(null);
    try {
      const res = await fetch(`/api/automation/${automationId}/dry-run`, { method: "POST" });
      const data = (await res.json()) as { ok: boolean; results?: Result[]; error?: string };
      if (!data.ok) throw new Error(data.error);
      setResults(data.results ?? []);
      setState("done");
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
      setState("error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={run} disabled={state === "running"}>
          {state === "running" ? "Reading your chats…" : "Try it on my last 10 chats"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Nothing is created. You just see what TriageFox would do.
        </p>
      </div>
      {state === "running" && (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}
      {state === "error" && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {state === "done" &&
        (results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent chats with a customer message were found.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {results.map((r, i) => (
              <li key={`${r.when}-${i}`} className="text-sm">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
                  aria-expanded={open === i}
                  onClick={() => setOpen(open === i ? null : i)}
                >
                  {r.decision === "create" ? (
                    <>
                      <span className="font-semibold text-success">
                        Would {r.needsReview ? "ask you about" : "create"} a ticket
                      </span>
                      {r.type && <TypeChip type={r.type} />}
                      {r.priority && <PriorityChip priority={r.priority} />}
                    </>
                  ) : (
                    <span className="font-semibold text-muted-foreground">
                      Skip: {CATEGORY[r.category ?? ""] ?? "no ticket needed"}
                    </span>
                  )}
                  <span className="basis-full text-muted-foreground sm:basis-auto sm:flex-1">
                    “{r.snippet}”
                  </span>
                </button>
                {open === i && (
                  <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
                    <p>
                      <span className="text-muted-foreground">Why: </span>
                      {r.reason}
                    </p>
                    {r.bodyPreview && (
                      <>
                        <p className="font-semibold">{r.title}</p>
                        <pre className="whitespace-pre-wrap font-sans text-muted-foreground">
                          {r.bodyPreview}
                        </pre>
                      </>
                    )}
                    <a
                      href={r.conversationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      Open the Crisp conversation
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

"use client";

import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type Run = (url: string, init?: RequestInit) => Promise<Response>;
const Ctx = createContext<Run>((url, init) => fetch(url, init));

/** `fetch` that asks for the password again when the server says a sensitive action needs a fresh sign-in. */
export const useStepUpFetch = () => useContext(Ctx);

export function StepUpProvider({ email, children }: { email: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const waiting = useRef<((ok: boolean) => void) | null>(null);
  const [step, setStep] = useState<"password" | "code">("password");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        waiting.current = resolve;
        setStep("password");
        setError(null);
        dialog.current?.showModal();
      }),
    [],
  );
  const finish = (ok: boolean) => {
    dialog.current?.close();
    waiting.current?.(ok);
    waiting.current = null;
  };

  const run: Run = useCallback(
    async (url, init) => {
      const first = await fetch(url, init);
      if (first.status !== 403) return first;
      const body = (await first
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null;
      if (body?.code !== "step_up_required") return first;
      return (await ask()) ? fetch(url, init) : first;
    },
    [ask],
  );

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    if (step === "password") {
      const { data, error: err } = await authClient.signIn.email({
        email,
        password: String(form.get("password")),
      });
      setBusy(false);
      if (err) return setError("That password isn't right.");
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("code");
      return finish(true);
    }
    const { error: err } = await authClient.twoFactor.verifyTotp({
      code: String(form.get("code")),
    });
    setBusy(false);
    if (err) return setError("That code isn't right.");
    finish(true);
  }

  return (
    <Ctx.Provider value={run}>
      {children}
      <dialog
        ref={dialog}
        onCancel={() => finish(false)}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/40"
        aria-labelledby="stepup-title"
      >
        <form
          method="post"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(new FormData(e.currentTarget));
            e.currentTarget.reset();
          }}
        >
          <h2 id="stepup-title" className="text-lg font-semibold">
            Confirm it's you
          </h2>
          <p className="text-sm text-muted-foreground">
            This change is sensitive, so please confirm your{" "}
            {step === "password" ? "password" : "sign-in code"}. If you sign in with Google, sign
            out and back in instead.
          </p>
          {step === "password" ? (
            <div>
              <Label htmlFor="stepup-password">Password</Label>
              <Input
                id="stepup-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="stepup-code">6-digit code</Label>
              <Input
                id="stepup-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>
          )}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Checking…" : "Confirm"}
            </Button>
          </div>
        </form>
      </dialog>
    </Ctx.Provider>
  );
}

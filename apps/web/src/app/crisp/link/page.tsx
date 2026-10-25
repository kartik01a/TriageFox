import { CRISP_WEBSITE_ID } from "@triagefox/connectors";
import type { Metadata } from "next";
import { Wordmark } from "@/components/fox-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { currentIp } from "@/lib/ip";
import { createRateLimiter } from "@/lib/rate-limit";
import { rpc } from "@/lib/rpc";

export const metadata: Metadata = { title: "Connect Crisp", robots: { index: false } };

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

/**
 * Shown INSIDE Crisp (iframe widget). Crisp appends the website id and a per-website token; the
 * worker checks the token against Crisp's API, which proves this is a real, subscribed website.
 * Session cookies are not available in a cross-site iframe, so linking itself continues in a normal
 * tab via a one-time ticket (see /api/crisp/link-ticket).
 */
export default async function CrispLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ website_id?: string; token?: string }>;
}) {
  const { website_id: websiteId, token } = await searchParams;
  let state: "invalid" | "busy" | "error" | { name?: string } = "invalid";

  if (websiteId && token && CRISP_WEBSITE_ID.test(websiteId)) {
    if (!limiter.allow(await currentIp())) state = "busy";
    else {
      try {
        const res = await rpc().call("crisp.verifyWebsite", { websiteId, token });
        if (res.valid) state = { name: res.websiteName };
      } catch {
        state = "error";
      }
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <Wordmark />
      {typeof state === "object" ? (
        <>
          <p className="max-w-sm text-sm text-muted-foreground">
            Link <strong className="text-foreground">{state.name ?? "this Crisp website"}</strong>{" "}
            to your TriageFox workspace so customer chats can become tickets.
          </p>
          <form method="post" action="/api/crisp/link-ticket" target="_blank" rel="noopener">
            <input type="hidden" name="website_id" value={websiteId} />
            <input type="hidden" name="token" value={token} />
            <button type="submit" className={cn(buttonVariants({ size: "lg" }))}>
              Continue in TriageFox
            </button>
          </form>
          <p className="max-w-xs text-xs text-muted-foreground">
            Opens in a new tab. You'll confirm which workspace to link.
          </p>
        </>
      ) : (
        <p className="max-w-sm text-sm text-muted-foreground" role="alert">
          {state === "busy"
            ? "Too many attempts. Please wait a minute."
            : state === "error"
              ? "We couldn't check this with Crisp right now. Please reload in a moment."
              : "Open this page from inside your Crisp inbox (TriageFox plugin) to connect your website."}
        </p>
      )}
    </main>
  );
}

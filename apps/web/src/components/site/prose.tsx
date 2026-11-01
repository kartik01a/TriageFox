import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** Page frame + readable long-form typography for legal and guide pages. */
export async function ProsePage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {intro && <div className="mt-3 text-muted-foreground">{intro}</div>}
        <div
          className={[
            "mt-8 space-y-4 text-[15px] leading-7",
            "[&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
            "[&_h3]:mt-6 [&_h3]:font-semibold",
            "[&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6",
            "[&_a:not([data-button])]:text-primary [&_a:not([data-button])]:underline [&_strong]:font-semibold",
            "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:py-2 [&_th]:text-left [&_td]:border-b [&_td]:border-border/60 [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top",
          ].join(" ")}
        >
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

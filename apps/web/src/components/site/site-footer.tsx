import Link from "next/link";
import { Wordmark } from "@/components/fox-logo";
import { SITE } from "@/lib/site";

type FooterLink = { href: string; label: string; external?: boolean };
type Column = { title: string; links: FooterLink[] };

const product: Column = {
  title: "Product",
  links: [
    { href: "/#features", label: "Features" },
    { href: "/pricing", label: "Pricing" },
    { href: "/integrations", label: "Integrations" },
    { href: "/integrations/crisp-to-jira", label: "Crisp to Jira" },
    { href: "/integrations/crisp-to-trello", label: "Crisp to Trello" },
  ],
};

// Links into the repository, shown once it is public (SITE.repoPublic); until then they would 404.
const openSource: Column = {
  title: "Open source",
  links: [
    { href: SITE.repoUrl, label: "GitHub", external: true },
    {
      href: `${SITE.repoUrl}/blob/main/docs/self-hosting.md`,
      label: "Self-host guide",
      external: true,
    },
    {
      href: `${SITE.repoUrl}/blob/main/SECURITY.md`,
      label: "Report a vulnerability",
      external: true,
    },
  ],
};

const company: Column = {
  title: "Company",
  links: [
    { href: "/support", label: "Support" },
    { href: "/security", label: "Security" },
    { href: "/legal/privacy", label: "Privacy" },
    { href: "/legal/terms", label: "Terms" },
    { href: "/legal/subprocessors", label: "Subprocessors" },
    ...(SITE.repoPublic
      ? []
      : [
          { href: `mailto:${SITE.securityEmail}`, label: "Report a vulnerability", external: true },
        ]),
  ],
};

const columns = SITE.repoPublic ? [product, openSource, company] : [product, company];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div
        className={`mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 ${SITE.repoPublic ? "md:grid-cols-[1.4fr_repeat(3,1fr)]" : "md:grid-cols-[1.4fr_repeat(2,1fr)]"}`}
      >
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-xs text-sm text-muted-foreground">
            Open-source AI that turns customer chats into Jira and Trello tickets.
          </p>
        </div>
        {columns.map((c) => (
          <nav key={c.title} aria-label={c.title} className="space-y-2 text-sm">
            <p className="font-semibold">{c.title}</p>
            <ul className="space-y-1.5 text-muted-foreground">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a
                      href={l.href}
                      className="hover:text-foreground"
                      {...(l.href.startsWith("mailto:")
                        ? {}
                        : { target: "_blank", rel: "noopener noreferrer" })}
                    >
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="hover:text-foreground">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span>
            © {new Date().getFullYear()} {SITE.name} · Made in India 🇮🇳 by {SITE.operator}
          </span>
          <span>Open source under AGPL-3.0</span>
        </div>
      </div>
    </footer>
  );
}

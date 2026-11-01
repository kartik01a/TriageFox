import Link from "next/link";
import { ProsePage } from "@/components/site/prose";
import { buttonVariants } from "@/components/ui/button";

export interface GuideProps {
  slug: string;
  title: string;
  description: string;
  tool: "Jira" | "Trello";
  mapping: [string, string][];
  setup: string[];
  faq: [string, string][];
}

/** One search-friendly guide page: what the connection does, how the ticket is built, and how to set it up. */
export async function Guide({ slug, title, description, tool, mapping, setup, faq }: GuideProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([q, a]) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  return (
    <ProsePage title={title} intro={description}>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: our own constant FAQ text as JSON, with "<" escaped so it cannot close the tag
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <h2>What happens</h2>
      <p>
        Customers write to you in Crisp. TriageFox reads each conversation once it goes quiet (or is
        resolved), decides with AI whether it needs a code change, and creates a {tool}{" "}
        {tool === "Jira" ? "issue" : "card"} for real bugs and feature requests. Questions, billing
        chats and greetings get no ticket, and the activity log says why. When the customer adds
        detail, the same {tool === "Jira" ? "issue" : "card"} gets a comment. When another customer
        reports the same problem, it is merged into the first one.
      </p>
      <h2>How the ticket is built</h2>
      <table>
        <thead>
          <tr>
            <th>From the chat</th>
            <th>In {tool}</th>
          </tr>
        </thead>
        <tbody>
          {mapping.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Set it up</h2>
      <ol>
        {setup.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p>
        <Link href="/signup" data-button className={buttonVariants({ size: "md" })}>
          Start free trial
        </Link>
      </p>
      <h2>Questions</h2>
      {faq.map(([q, a]) => (
        <div key={q}>
          <h3>{q}</h3>
          <p>{a}</p>
        </div>
      ))}
      <p>
        Looking for the other one?{" "}
        <Link
          href={
            slug === "crisp-to-jira"
              ? "/integrations/crisp-to-trello"
              : "/integrations/crisp-to-jira"
          }
        >
          Crisp to {tool === "Jira" ? "Trello" : "Jira"}
        </Link>
        . Or <a href="/pricing">see pricing</a>.
      </p>
    </ProsePage>
  );
}

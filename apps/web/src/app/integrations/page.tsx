import type { Metadata } from "next";
import Link from "next/link";
import { ProsePage } from "@/components/site/prose";

export const metadata: Metadata = {
  title: "Integrations",
  description: "TriageFox connects Crisp to Jira Cloud and Trello, with more on the way.",
  alternates: { canonical: "/integrations" },
};

export default async function IntegrationsPage() {
  return (
    <ProsePage title="Integrations" intro="Where your customers chat, and where your team works.">
      <h2>Available now</h2>
      <ul>
        <li>
          <strong>Crisp</strong> (where customers chat): the source of conversations.
        </li>
        <li>
          <strong>Jira Cloud</strong>:{" "}
          <Link href="/integrations/crisp-to-jira">Crisp to Jira guide</Link>
        </li>
        <li>
          <strong>Trello</strong>:{" "}
          <Link href="/integrations/crisp-to-trello">Crisp to Trello guide</Link>
        </li>
      </ul>
      <h2>On the roadmap</h2>
      <p>
        Chatwoot, tawk.to, Linear, GitHub Issues and more, one at a time. The code is open source,
        so connectors are easy to contribute.
      </p>
      <p>
        <Link href="/signup">Start free trial</Link>
      </p>
    </ProsePage>
  );
}

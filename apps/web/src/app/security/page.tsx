import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How TriageFox protects your Crisp, Jira and Trello access and your customers' conversations.",
  alternates: { canonical: "/security" },
};

export default async function SecurityPage() {
  return (
    <ProsePage
      title="Your data, handled carefully"
      intro={
        <>
          TriageFox connects to your Crisp, Jira and Trello so it can turn chats into tickets. This
          is how we protect that access.
        </>
      }
    >
      <h2>What we store, and what we never store</h2>
      <p>
        <strong>We store:</strong> connection tokens for your tools (encrypted), the tickets we
        create, a plain-language activity log, short encrypted AI answers that disappear after 30
        days, and usage counts.
      </p>
      <p>
        <strong>We never store:</strong> your chat transcripts (we read them from Crisp when needed
        and keep them in memory only), your files and screenshots (they go straight from Crisp to
        Jira or Trello), or your card details (our payment provider handles those).
      </p>

      <h2>Encryption</h2>
      <p>
        Every token and API key is encrypted with its own context. The part of TriageFox that faces
        the internet can save your credentials but <strong>cannot read them back</strong>; only a
        separate background worker can, and only when it needs to create a ticket. Your OpenAI key
        is write-only: after you save it, nobody (including us) can see it again, only its last four
        characters.
      </p>

      <h2>Isolation and access</h2>
      <ul>
        <li>
          Each workspace's data is separated in the database, with row-level security enforced by
          Postgres itself, not just by our code.
        </li>
        <li>
          Sign-in supports two-factor authentication, and workspace owners can require it for
          everyone. Sensitive changes ask for your password again.
        </li>
        <li>
          Incoming webhooks must carry a valid signature and a fresh timestamp. Files from chats are
          only fetched from Crisp's own storage, never from arbitrary addresses.
        </li>
        <li>
          The AI has no tools: it can only answer in a strict format that we check, so a chat that
          says “ignore your instructions” cannot make it act.
        </li>
        <li>
          You decide what goes into tickets: conversation links and customer names are off by
          default.
        </li>
        <li>
          Platform admin access needs a listed email and two-factor sign-in, and every admin change
          is logged.
        </li>
      </ul>

      <h2>Open source</h2>
      <p>
        Every line of TriageFox is public on{" "}
        <a href={SITE.repoUrl} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        . You don't have to take our word for any of this, and you can run the whole thing yourself.
      </p>

      <h2>Your controls</h2>
      <p>
        Disconnect any tool at any time, remove your OpenAI key, see every decision in the activity
        log, and ask us to delete your workspace. Revoking TriageFox's access in Atlassian, Trello
        or Crisp also works immediately and we pause cleanly when it happens.
      </p>

      <h2>Who else touches data</h2>
      <p>
        See the <a href="/legal/subprocessors">subprocessors list</a>. We tell you before it
        changes.
      </p>

      <h2>Found a vulnerability?</h2>
      <p>
        Please email <a href={`mailto:${SITE.securityEmail}`}>{SITE.securityEmail}</a> (or use
        GitHub's private “Report a vulnerability” button on the repository). We reply within 48
        hours, and we will credit you if you like. See{" "}
        <a href={`${SITE.repoUrl}/blob/main/SECURITY.md`} target="_blank" rel="noopener noreferrer">
          SECURITY.md
        </a>
        .
      </p>
    </ProsePage>
  );
}

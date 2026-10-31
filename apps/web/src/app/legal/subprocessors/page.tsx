import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose";
import { LEGAL_UPDATED } from "@/lib/site";

export const metadata: Metadata = {
  title: "Subprocessors",
  description: "The companies that help TriageFox process data.",
  alternates: { canonical: "/legal/subprocessors" },
};

const rows = [
  [
    "Oracle Cloud Infrastructure",
    "Hosting of the application, database and queue",
    "Account, workspace and ticket data (encrypted secrets)",
  ],
  [
    "Cloudflare",
    "Network protection and delivery in front of the website",
    "Request metadata (IP address, headers)",
  ],
  [
    "OpenAI",
    "AI analysis of conversations (uses your key if you add one)",
    "Conversation text and screenshots, with emails, phone numbers and card numbers removed",
  ],
  [
    "Dodo Payments",
    "Payments, tax and invoicing as merchant of record",
    "Billing name, email and payment details (we never see card numbers)",
  ],
  [
    "Resend",
    "Sending sign-up, invitation and notification emails",
    "Recipient email address and the email content",
  ],
  ["Sentry", "Error monitoring", "Error details without message text, cookies or passwords"],
  ["Crisp", "Our own customer-support chat", "What you type to our support, and your email"],
  ["Google", "Optional “Sign in with Google”", "Name and email, if you choose Google sign-in"],
];

export default async function SubprocessorsPage() {
  return (
    <ProsePage
      title="Subprocessors"
      intro={
        <>
          Last updated {LEGAL_UPDATED}. We tell workspace owners by email before we add or replace
          one.
        </>
      }
    >
      <p>
        These companies process data on our behalf to provide the hosted TriageFox service.
        Self-hosted installs use none of them unless you set them up yourself.
      </p>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>What for</th>
            <th>Data involved</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b, c]) => (
            <tr key={a}>
              <td>
                <strong>{a}</strong>
              </td>
              <td>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Tools you connect yourself</h2>
      <p>
        Crisp (where your customers chat), Jira Cloud (Atlassian) and Trello (Atlassian) are your
        own accounts with their own terms and privacy policies. TriageFox acts on them only with the
        access you grant, which you can revoke in those tools at any time.
      </p>
    </ProsePage>
  );
}

import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose";
import { LEGAL_UPDATED, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What TriageFox collects, why, how long we keep it, and your rights.",
  alternates: { canonical: "/legal/privacy" },
};

export default async function PrivacyPage() {
  const mail = SITE.contactEmail;
  return (
    <ProsePage
      title="Privacy policy"
      intro={<>Last updated {LEGAL_UPDATED}. In plain words first, details after.</>}
    >
      <h2>The short version</h2>
      <ul>
        <li>
          We read your customers' chats only to decide whether they need a ticket, and we{" "}
          <strong>do not store the chat transcripts</strong>.
        </li>
        <li>
          Your Trello and Jira access tokens and your OpenAI key are stored{" "}
          <strong>encrypted</strong>.
        </li>
        <li>We don't sell data, and we don't show ads or use advertising trackers.</li>
        <li>You can ask us to delete your account and data at any time.</li>
      </ul>

      <h2>Who is responsible</h2>
      <p>
        {SITE.name} is run by <strong>{SITE.operator}</strong>, a sole proprietor in {SITE.country}{" "}
        (“we”). For the purposes of privacy law we are the{" "}
        <strong>data fiduciary / controller</strong> for your account and usage data. For the
        content of your customers' conversations that you connect to TriageFox, <strong>you</strong>{" "}
        are the data fiduciary / controller and we act as your <strong>processor</strong>, following
        your instructions (the automation you set up).
      </p>
      <p>
        Contact and grievance officer: {SITE.operator}, <a href={`mailto:${mail}`}>{mail}</a>. We
        reply within 7 days.
      </p>

      <h2>What we collect, and why</h2>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Why</th>
            <th>Kept</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Account: name, email, password (stored only as a one-way hash), optional Google
              sign-in id, two-factor secret
            </td>
            <td>To run your account and keep it secure</td>
            <td>Until you delete the account</td>
          </tr>
          <tr>
            <td>
              Workspace: its name, members and roles, settings, connection details (which Crisp
              website, Trello board or Jira project)
            </td>
            <td>To provide the service</td>
            <td>Until deletion</td>
          </tr>
          <tr>
            <td>Access tokens for Trello and Jira, and your OpenAI key if you add one</td>
            <td>To create tickets and to run the AI for you</td>
            <td>Encrypted; deleted when you disconnect or delete the account</td>
          </tr>
          <tr>
            <td>Tickets we create (title and body) and links to them</td>
            <td>To create, update and merge tickets, and show you what happened</td>
            <td>Until deletion</td>
          </tr>
          <tr>
            <td>
              Activity log: what the AI decided for each conversation, in plain words, without the
              chat text
            </td>
            <td>So you can see and check every decision</td>
            <td>Until deletion</td>
          </tr>
          <tr>
            <td>The AI's detailed answer for each conversation (may quote parts of a chat)</td>
            <td>So you can open “why” on a decision</td>
            <td>Encrypted; cleared after 30 days</td>
          </tr>
          <tr>
            <td>
              Hook records from Crisp (identifiers only: website, conversation and message ids)
            </td>
            <td>To know that something changed</td>
            <td>30 days</td>
          </tr>
          <tr>
            <td>Usage counters (conversations analysed, AI cost) and billing status</td>
            <td>To apply your plan's limits and to bill you</td>
            <td>While your account exists, then as tax law requires</td>
          </tr>
          <tr>
            <td>Technical logs and error reports (no message text, no cookies, no passwords)</td>
            <td>Security and fixing bugs</td>
            <td>Up to 90 days</td>
          </tr>
          <tr>
            <td>Messages you send to our own support chat</td>
            <td>To help you</td>
            <td>In our Crisp inbox, until resolved plus a reasonable period</td>
          </tr>
        </tbody>
      </table>

      <h2>Your customers' conversations</h2>
      <p>
        When a conversation in your Crisp inbox changes, we fetch it from Crisp, remove email
        addresses, phone numbers and card numbers, and send the text and up to four screenshots to{" "}
        <strong>OpenAI</strong> (with your key, or ours) so that it can decide what to do. Files
        that belong on a ticket are passed from Crisp straight to Trello or Jira. We keep the
        conversation in memory only while we work on it. We do not use your conversations to train
        models, and our agreement with OpenAI is for API use, where OpenAI does not train on API
        data by default. You are responsible for having the right to process your customers' data
        this way, and for telling your customers where your law requires it.
      </p>

      <h2>Cookies</h2>
      <p>
        We use only the cookies needed to keep you signed in and secure (a session cookie and a
        short-lived verification cookie). We do not use advertising or analytics cookies. Our
        support chat, powered by Crisp, sets its own cookies when it loads.
      </p>

      <h2>Who we share data with</h2>
      <p>
        Only the service providers needed to run TriageFox, listed on the{" "}
        <a href="/legal/subprocessors">subprocessors page</a>, and the tools you connect yourself
        (Crisp, Trello, Jira). We may disclose data if the law requires it.
      </p>

      <h2>Where data is processed</h2>
      <p>
        Our servers and some of our providers are outside your country, and our operator is in
        India. Where data is moved across borders we rely on contracts and the safeguards our
        providers offer. Tell us if you need more detail for your own compliance.
      </p>

      <h2>Your rights</h2>
      <p>
        Whatever country you are in, you can ask us to <strong>show you</strong> the data we hold
        about you, <strong>correct</strong> it,
        <strong> delete</strong> it, give you a <strong>copy</strong>, or <strong>stop</strong> a
        particular use. Under India's Digital Personal Data Protection Act, 2023 you can also
        withdraw consent and nominate someone to exercise your rights. If you are in the EU or UK,
        the GDPR gives you the same rights plus the right to complain to your data protection
        authority. Email <a href={`mailto:${mail}`}>{mail}</a>. We answer within 30 days. To delete
        a workspace, email us from the owner's address: we remove it and its data within 7 days,
        except what the law requires us to keep (such as payment records held by our payment
        provider).
      </p>

      <h2>Security</h2>
      <p>
        Credentials are encrypted so that the website can store but not read them, workspaces are
        isolated in the database, sign-in supports two-factor authentication, and the code is open
        source. Read the <a href="/security">security page</a>. If a breach affects your data we
        will tell you within 72 hours of confirming it, with clear steps.
      </p>

      <h2>Children</h2>
      <p>
        TriageFox is for businesses. It is not meant for anyone under 18, and we do not knowingly
        collect their data.
      </p>

      <h2>Changes</h2>
      <p>
        If we make a meaningful change we will email workspace owners before it takes effect. The
        date at the top shows the latest version.
      </p>
    </ProsePage>
  );
}

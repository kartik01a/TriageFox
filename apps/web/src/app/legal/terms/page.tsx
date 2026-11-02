import type { Metadata } from "next";
import { ProsePage } from "@/components/site/prose";
import { LEGAL_UPDATED, SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms for using the hosted TriageFox service.",
  alternates: { canonical: "/legal/terms" },
};

export default async function TermsPage() {
  const mail = SITE.contactEmail;
  return (
    <ProsePage
      title="Terms of service"
      intro={
        <>
          Last updated {LEGAL_UPDATED}. These terms cover the hosted TriageFox service at this
          website. The open-source code you can run yourself is covered by its AGPL-3.0 licence
          instead.
        </>
      }
    >
      <h2>1. Who we are, and these terms</h2>
      <p>
        The service is provided by <strong>{SITE.operator}</strong>, a sole proprietor in{" "}
        {SITE.country} (“we”). By creating an account or using the service you agree to these terms
        and to our <a href="/legal/privacy">privacy policy</a>. If you use TriageFox for an
        organisation, you confirm you may accept these terms for it.
      </p>

      <h2>2. The service</h2>
      <p>
        TriageFox reads conversations from your Crisp inbox, uses AI to decide whether they need a
        ticket, and creates and updates tickets in your Jira Cloud or Trello. Features, limits and
        prices can change; we will not reduce what you have paid for during a billing period.
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>
          You must give accurate details, keep your sign-in secure, and tell us if you suspect
          misuse. Turning on two-factor sign-in is strongly recommended.
        </li>
        <li>
          You are responsible for what happens under your account and for the people you invite to
          your workspace.
        </li>
        <li>You must be at least 18 and use the service for business purposes.</li>
      </ul>

      <h2>4. Your data and your customers' data</h2>
      <ul>
        <li>
          You own your data. You give us the right to process it only to provide the service to you.
        </li>
        <li>
          You confirm you have the right to connect your Crisp, Jira and Trello accounts, and to
          have your customers' conversations analysed by AI as described in the privacy policy,
          including telling your customers where the law requires it.
        </li>
        <li>You must not connect conversations you are not allowed to process.</li>
      </ul>

      <h2>5. AI results can be wrong</h2>
      <p>
        The AI can misjudge a conversation: it may create a ticket that isn't needed, miss one, or
        set the wrong type or priority. TriageFox shows you its reasons, lets you review uncertain
        tickets first and lets you dry-run on past chats. You are responsible for checking tickets
        before you rely on them for decisions. The service is not suitable as the only way of
        receiving urgent or safety-critical reports.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        Don't use the service to break the law or others' rights, to send us malware or abusive
        traffic, to try to get around limits or security, to attack other workspaces, or to resell
        it without our written consent. We may suspend access that does this, after warning you
        where we reasonably can.
      </p>

      <h2>7. Free trial, plans and payment</h2>
      <ul>
        <li>
          New workspaces get a free trial with limits shown in the app. No card is needed to start.
        </li>
        <li>
          Paid plans renew automatically each month or year until cancelled. Prices and limits are
          shown on the pricing page at the time you buy; a price change applies to you only when you
          move to a new plan version or after a notice period of at least 30 days.
        </li>
        <li>
          Payments are handled by our payment partner, <strong>Dodo Payments</strong>, which is the
          merchant of record and the seller to you. Its terms also apply to the payment. Taxes (such
          as GST or VAT) are added where required.
        </li>
        <li>
          If you reach your plan's conversation limit, or your trial or plan ends, new conversations
          are not turned into tickets until the next period, an upgrade, or (for limits) adding your
          own OpenAI key. Conversations from that gap are not processed later. We never charge for
          going over a limit.
        </li>
        <li>
          You can use your own OpenAI key. Then OpenAI bills you directly for AI use, under OpenAI's
          terms.
        </li>
      </ul>

      <h2>8. Cancelling and refunds</h2>
      <p>
        You can cancel any time in the payment portal on the Billing page. Cancelling stops the next
        renewal; you keep access until the end of the period you paid for.
        <strong> Payments are non-refundable</strong>, and the free trial is there so you can try
        before you buy. We make exceptions only for: (a) a duplicate or mistaken charge; (b) an
        outage on our side that made the service unusable for more than 72 hours in the billing
        period; and (c) cases where the law requires a refund. “I didn't use it”, “I forgot to
        cancel” and “I changed my mind” are not reasons for a refund. Ask by email within 30 days of
        the charge.
      </p>

      <h2>9. Availability and support</h2>
      <p>
        We work to keep the service running but do not promise it will be uninterrupted or
        error-free. Support is by email. Priority email support is included in plans that say so.
      </p>

      <h2>10. Open source</h2>
      <p>
        The TriageFox source code is available under the GNU Affero General Public License v3.0.
        These terms apply to the hosted service, not to your use of the code under that licence.
      </p>

      <h2>11. Ending the relationship</h2>
      <p>
        You can stop using TriageFox and ask us to delete your workspace at any time (see the
        privacy policy). We may end or suspend your access if you break these terms, don't pay, or
        if the law requires it. We will give notice where we reasonably can, and you can ask for an
        export of your tickets' details for 30 days afterwards.
      </p>

      <h2>12. Our responsibility</h2>
      <p>
        We provide the service “as is”. To the extent the law allows, we are not liable for indirect
        or consequential loss, lost profits or lost data, and our total liability for any claim is
        limited to the amount you paid us in the 12 months before the claim. Nothing here limits
        liability that cannot be limited by law.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update these terms. For a meaningful change we will email workspace owners at least
        30 days before it applies. Continuing to use the service after that means you accept it.
      </p>

      <h2>14. Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of India. The courts in India with jurisdiction over{" "}
        {SITE.operator}'s place of business can hear any dispute, subject to any mandatory
        consumer-protection rights you have where you live. We would like to hear from you first:{" "}
        <a href={`mailto:${mail}`}>{mail}</a>.
      </p>
    </ProsePage>
  );
}

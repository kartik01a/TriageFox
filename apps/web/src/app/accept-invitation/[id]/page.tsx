import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/fox-logo";
import { Card } from "@/components/ui/card";
import { getAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { AcceptButtons } from "./accept-buttons";

export const metadata: Metadata = { title: "Workspace invitation" };

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    // New or returning user: sign in / sign up, then come straight back here.
    redirect(`/login?next=${encodeURIComponent(`/accept-invitation/${id}`)}`);
  }

  // Throws or returns nothing when the invitation doesn't exist, expired, or is for another email.
  const invitation = await getAuth()
    .api.getInvitation({ headers: await headers(), query: { id } })
    .catch(() => null);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8" aria-label="TriageFox home">
        <Wordmark />
      </Link>
      <Card className="w-full max-w-md">
        {invitation && invitation.status === "pending" ? (
          <>
            <h1 className="text-xl font-bold">Join {invitation.organizationName}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {invitation.inviterEmail} invited you to join{" "}
              <strong>{invitation.organizationName}</strong> as <strong>{invitation.role}</strong>.
            </p>
            <div className="mt-6">
              <AcceptButtons invitationId={id} />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Invitation not available</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This invitation has expired, was cancelled, or was sent to a different email address
              than <strong>{session.user.email}</strong>. Ask your teammate to send a new one.
            </p>
            <Link
              href="/app"
              className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
            >
              Go to your workspace →
            </Link>
          </>
        )}
      </Card>
    </main>
  );
}

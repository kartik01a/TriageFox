import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleButton } from "@/components/google-button";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";
import { getSession } from "@/lib/session";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  const googleOn = !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
  return (
    <Card>
      <h1 className="text-xl font-bold">Create your TriageFox account</h1>
      <div className="mt-6 space-y-4">
        {googleOn && <GoogleButton next={next} label="Sign up with Google" />}
        <SignupForm next={next} />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </Card>
  );
}

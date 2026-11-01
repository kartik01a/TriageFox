import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleButton } from "@/components/google-button";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-redirect";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);
  const googleOn = !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
  return (
    <Card>
      <h1 className="text-xl font-bold">Sign in to TriageFox</h1>
      <div className="mt-6 space-y-4">
        {googleOn && <GoogleButton next={next} label="Continue with Google" />}
        <LoginForm next={next} />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="font-medium text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
    </Card>
  );
}

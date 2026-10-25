import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getAuth } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  const orgs = await getAuth().api.listOrganizations({ headers: await headers() });
  if (orgs.length > 0) redirect("/app");
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="text-xl font-bold">Create your workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A workspace is where your team connects tools and manages automations. You can invite
          teammates next.
        </p>
        <div className="mt-6">
          <OnboardingForm />
        </div>
      </Card>
    </div>
  );
}

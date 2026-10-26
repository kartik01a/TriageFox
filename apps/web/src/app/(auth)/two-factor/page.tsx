import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor sign-in" };

export default function TwoFactorPage() {
  return (
    <Card>
      <h1 className="text-xl font-bold">Two-factor sign-in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter the 6-digit code from your authenticator app.
      </p>
      <div className="mt-6">
        <TwoFactorForm />
      </div>
    </Card>
  );
}

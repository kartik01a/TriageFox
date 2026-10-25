import { modelConfig } from "@triagefox/ai";
import { eq, schema, withOrg } from "@triagefox/db";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/workspace";
import { AiKeyForm } from "./ai-key-form";

export const metadata: Metadata = { title: "AI key" };

export default async function AiSettingsPage() {
  const { workspace, canManage } = await requireWorkspace();
  const [row] = await withOrg(db(), workspace.id, (tx) =>
    tx
      .select({ hint: schema.aiSettings.keyHint, verifiedAt: schema.aiSettings.keyVerifiedAt })
      .from(schema.aiSettings)
      .where(eq(schema.aiSettings.orgId, workspace.id)),
  );
  const models = modelConfig(env());
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI key</h1>
        <p className="mt-1 text-muted-foreground">
          Bring your own OpenAI key and pay OpenAI directly for the AI that reads your chats.
          TriageFox picks the models; you only provide the key.
        </p>
      </div>
      <Card className="space-y-5">
        <AiKeyForm
          hint={row?.hint ?? null}
          verifiedAt={row?.verifiedAt ? row.verifiedAt.toISOString() : null}
          canManage={canManage}
          models={[models.default, models.escalation, models.embedding]}
        />
      </Card>
      <Card className="space-y-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How your key is protected</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            It is encrypted the moment you save it. The website can store it but can never read it
            back.
          </li>
          <li>
            After saving, nobody (including you and us) can view the full key again, only its last
            four characters.
          </li>
          <li>It's used only to analyse your conversations, and you can remove it at any time.</li>
        </ul>
      </Card>
    </div>
  );
}

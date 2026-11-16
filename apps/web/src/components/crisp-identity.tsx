import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import Script from "next/script";
import { env } from "@/lib/env";

/**
 * Tells the support chat who is signed in, with Crisp's identity verification: our server signs the email
 * (HMAC-SHA256 with CRISP_IDENTITY_SECRET), so the inbox can tell a genuine signed-in customer from someone who
 * merely typed an email address into the public widget. Rendered inside the app only.
 */
export async function CrispIdentity({
  email,
  name,
  workspaceId,
  workspaceName,
}: {
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
}) {
  const { CRISP_IDENTITY_SECRET: secret, SUPPORT_CRISP_WEBSITE_ID } = env();
  if (!secret || !SUPPORT_CRISP_WEBSITE_ID) return null;
  const signature = createHmac("sha256", secret).update(email).digest("hex");
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const data = { email, signature, name, workspace_id: workspaceId, workspace: workspaceName };
  return (
    <Script id="crisp-identity" nonce={nonce} strategy="afterInteractive">
      {`window.$crisp=window.$crisp||[];var d=${JSON.stringify(data)};$crisp.push(["set","user:email",[d.email,d.signature]]);$crisp.push(["set","user:nickname",[d.name]]);$crisp.push(["set","session:data",[[["workspace_id",d.workspace_id],["workspace",d.workspace],["page",location.pathname]]]]);`}
    </Script>
  );
}

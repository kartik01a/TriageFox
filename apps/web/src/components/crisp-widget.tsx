import { headers } from "next/headers";
import Script from "next/script";

/**
 * Support chat widget (docs/own-support.md). Rendered only when NEXT_PUBLIC_CRISP_WEBSITE_ID is set.
 * Uses the per-request CSP nonce from src/proxy.ts.
 */
export async function CrispWidget() {
  const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID;
  if (!websiteId || !/^[0-9a-f-]{36}$/i.test(websiteId)) return null;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <Script id="crisp-widget" nonce={nonce} strategy="afterInteractive">
      {`window.$crisp=[];window.CRISP_WEBSITE_ID=${JSON.stringify(websiteId)};(function(){var d=document;var s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;${nonce ? `s.nonce=${JSON.stringify(nonce)};` : ""}d.getElementsByTagName("head")[0].appendChild(s);})();`}
    </Script>
  );
}

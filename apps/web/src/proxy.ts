import { type NextRequest, NextResponse } from "next/server";

/**
 * Sets a Content-Security-Policy with a fresh nonce for every request (docs/security.md §7).
 * Crisp's chat widget (support chat) is allowed explicitly; everything else must be same-origin.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const crisp = {
    script: "https://client.crisp.chat",
    connect:
      "https://client.crisp.chat https://storage.crisp.chat wss://client.relay.crisp.chat wss://stream.relay.crisp.chat",
    img: "https://client.crisp.chat https://image.crisp.chat https://storage.crisp.chat",
    font: "https://client.crisp.chat",
    style: "https://client.crisp.chat",
    frame: "https://game.crisp.chat",
  };

  // Only the Crisp link page is shown inside Crisp's inbox (iframe widget); nothing else may be framed.
  const framable = request.nextUrl.pathname === "/crisp/link";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${crisp.script}${isDev ? " 'unsafe-eval'" : ""}`,
    // Crisp injects inline styles, so style-src cannot be nonce-only while the widget is enabled.
    `style-src 'self' 'unsafe-inline' ${crisp.style}`,
    `img-src 'self' blob: data: ${crisp.img}`,
    `font-src 'self' ${crisp.font}`,
    `connect-src 'self' ${crisp.connect}${isDev ? " ws://localhost:*" : ""}`,
    `frame-src ${crisp.frame}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    framable ? "frame-ancestors https://app.crisp.chat" : "frame-ancestors 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

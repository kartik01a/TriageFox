import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Local development: the single .env lives at the repo root. In production the environment is
// provided by the container, so nothing is loaded.
const rootEnv = join(import.meta.dirname, "..", "..", ".env");
if (process.env.NODE_ENV !== "production" && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Self-contained server for the Docker image; the file tracer needs the repo root to find workspace packages.
  output: "standalone",
  outputFileTracingRoot: join(import.meta.dirname, "..", ".."),
  transpilePackages: ["@triagefox/shared", "@triagefox/crypto", "@triagefox/db"],
  serverExternalPackages: ["postgres", "libsodium-wrappers", "nodemailer"],
  poweredByHeader: false,
  // Static security headers. The Content-Security-Policy (needs a per-request nonce) is set in
  // src/proxy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;

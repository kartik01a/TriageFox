import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const e = env();
  // A self-hosted install is private by default: nothing for search engines.
  if (e.APP_MODE !== "hosted") return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api", "/crisp"] },
    sitemap: `${e.APP_URL}/sitemap.xml`,
  };
}

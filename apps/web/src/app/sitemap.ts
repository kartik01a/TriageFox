import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const e = env();
  if (e.APP_MODE !== "hosted") return [];
  const paths = [
    "/",
    "/pricing",
    "/integrations",
    "/integrations/crisp-to-jira",
    "/integrations/crisp-to-trello",
    "/security",
    "/support",
    "/legal/privacy",
    "/legal/terms",
    "/legal/subprocessors",
  ];
  return paths.map((p) => ({
    url: `${e.APP_URL}${p}`,
    changeFrequency: p === "/" ? "weekly" : "monthly",
    priority: p === "/" ? 1 : 0.6,
  }));
}

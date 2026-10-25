import { timingSafeEqual } from "node:crypto";
import { type FetchLike, ProviderError, requestJson } from "./http";

const API = "https://api.crisp.chat/v1";

export interface CrispPluginOptions {
  /** Token identifier + key from Marketplace → plugin → Tokens (HTTP basic auth). */
  identifier: string;
  key: string;
  /** The plugin's own id (UUID shown at the top of the plugin page). */
  pluginId: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export class CrispPluginClient {
  private readonly base: string;
  private readonly fetch: FetchLike;
  constructor(private readonly opts: CrispPluginOptions) {
    this.base = opts.baseUrl ?? API;
    this.fetch = opts.fetch ?? fetch;
  }

  private get<T>(path: string) {
    return requestJson<T>("crisp", this.fetch, `${this.base}${path}`, {
      headers: {
        authorization: `Basic ${Buffer.from(`${this.opts.identifier}:${this.opts.key}`).toString("base64")}`,
        "X-Crisp-Tier": "plugin",
      },
    });
  }

  /** The per-website token Crisp appends to our iframe page URL. Also proves the plugin is installed. */
  async getSubscriptionToken(websiteId: string): Promise<string> {
    const res = await this.get<{ data: { token?: string } }>(
      `/plugins/subscription/${encodeURIComponent(websiteId)}/${encodeURIComponent(this.opts.pluginId)}/settings`,
    );
    const token = res.data?.token;
    if (!token)
      throw new ProviderError("crisp", "not_found", "No subscription token for this website");
    return token;
  }

  async getWebsiteName(websiteId: string): Promise<string | undefined> {
    const res = await this.get<{ data: { name?: string; domain?: string } }>(
      `/website/${encodeURIComponent(websiteId)}`,
    );
    return res.data?.name ?? res.data?.domain;
  }

  /**
   * True only when `token` is the one Crisp issued for this website. Anyone can invent a website id,
   * but only Crisp (and operators of that website, through the iframe) know its token.
   */
  async verifyWebsiteToken(websiteId: string, token: string): Promise<boolean> {
    try {
      const expected = Buffer.from(await this.getSubscriptionToken(websiteId));
      const given = Buffer.from(token);
      return expected.length === given.length && timingSafeEqual(expected, given);
    } catch (err) {
      if (err instanceof ProviderError && (err.kind === "not_found" || err.kind === "auth"))
        return false;
      throw err;
    }
  }
}

export const CRISP_WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

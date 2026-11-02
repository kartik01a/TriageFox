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

  /** One page (20 conversations) of recently active conversations. Empty page = no more. */
  async listConversations(websiteId: string, page: number): Promise<CrispConversationRef[]> {
    const res = await this.get<{
      data?: { session_id: string; updated_at?: number; state?: string }[];
    }>(`/website/${encodeURIComponent(websiteId)}/conversations/${page}`);
    return (res.data ?? []).map((c) => ({
      sessionId: c.session_id,
      updatedAt: c.updated_at ?? 0,
      state: c.state === "resolved" ? "resolved" : "open",
    }));
  }

  /** The full conversation: details plus every message page, oldest first. Held in memory only. */
  async fetchConversation(websiteId: string, sessionId: string): Promise<CrispConversation> {
    const site = encodeURIComponent(websiteId);
    const session = encodeURIComponent(sessionId);
    const conv = await this.get<{
      data: {
        state?: string;
        updated_at?: number;
        meta?: { nickname?: string; email?: string; verified?: boolean };
        verifications?: { key?: string; verified?: boolean }[];
      };
    }>(`/website/${site}/conversation/${session}`);

    const byFingerprint = new Map<string, CrispMessage>();
    let before: number | undefined;
    for (let page = 0; page < MAX_MESSAGE_PAGES && byFingerprint.size < MAX_MESSAGES; page++) {
      const q = before ? `?timestamp_before=${before}` : "";
      const res = await this.get<{ data?: RawMessage[] }>(
        `/website/${site}/conversation/${session}/messages${q}`,
      );
      const raw = res.data ?? [];
      if (raw.length === 0) break;
      for (const r of raw) {
        const m = normalizeCrispMessage(r);
        if (m) byFingerprint.set(m.fingerprint, m);
      }
      const oldest = Math.min(...raw.map((r) => r.timestamp ?? Number.POSITIVE_INFINITY));
      if (!Number.isFinite(oldest) || oldest === before) break; // no progress: stop instead of looping
      before = oldest;
    }

    const messages = [...byFingerprint.values()].sort(
      (a, b) => a.timestamp - b.timestamp || a.fingerprint.localeCompare(b.fingerprint),
    );
    return {
      sessionId,
      websiteId,
      state: conv.data?.state === "resolved" ? "resolved" : "open",
      updatedAt: conv.data?.updated_at ?? 0,
      customer: {
        nickname: conv.data?.meta?.nickname || undefined,
        email: conv.data?.meta?.email || undefined,
        // Only a signed identity (our server signed the email, see docs/own-support.md) counts as verified.
        verified:
          conv.data?.meta?.verified === true ||
          conv.data?.verifications?.some((v) => v.key === "email" && v.verified === true)
            ? true
            : undefined,
      },
      messages,
    };
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

// ---- Conversations ------------------------------------------------------------------------------
// Fetched on demand and held in memory only: transcripts are never stored (docs/security.md §4).

export interface CrispMessage {
  /** Unique within the conversation; our cursor for "what have we processed". */
  fingerprint: string;
  /** Milliseconds. */
  timestamp: number;
  role: "customer" | "operator" | "note";
  kind: "text" | "file";
  text?: string;
  file?: { name: string; url: string; mime: string };
}

export interface CrispConversation {
  sessionId: string;
  websiteId: string;
  state: "open" | "resolved";
  /** Milliseconds. */
  updatedAt: number;
  customer: { nickname?: string; email?: string; verified?: boolean };
  /** Oldest first. System events are dropped. */
  messages: CrispMessage[];
}

export interface CrispConversationRef {
  sessionId: string;
  updatedAt: number;
  state: "open" | "resolved";
}

interface RawMessage {
  fingerprint?: number | string;
  timestamp?: number;
  type?: string;
  from?: string;
  content?: unknown;
}

const MESSAGE_FILE_TYPES = new Set(["file", "picture", "animation", "audio", "video"]);
const MAX_MESSAGES = 2000;
const MAX_MESSAGE_PAGES = 100;

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Voice notes and pictures often arrive without a name; give them a readable one with an extension. */
function defaultFileName(type: string, mime: string, timestamp: number) {
  const ext = EXTENSIONS[mime.split(";")[0]?.trim() ?? ""];
  const stamp = new Date(timestamp).toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const base = type === "audio" ? "voice-message" : type === "picture" ? "image" : "file";
  return ext ? `${base}-${stamp}.${ext}` : `${base}-${stamp}`;
}

export function normalizeCrispMessage(m: RawMessage): CrispMessage | null {
  if (m.fingerprint == null || typeof m.timestamp !== "number" || !m.type) return null;
  const base = { fingerprint: String(m.fingerprint), timestamp: m.timestamp };
  const role =
    m.type === "note"
      ? "note"
      : m.from === "user"
        ? "customer"
        : m.from === "operator"
          ? "operator"
          : null;
  if (!role) return null;
  if (m.type === "text" || m.type === "note") {
    return typeof m.content === "string" ? { ...base, role, kind: "text", text: m.content } : null;
  }
  if (MESSAGE_FILE_TYPES.has(m.type)) {
    const c = m.content as { name?: string; url?: string; type?: string } | undefined;
    if (!c || typeof c.url !== "string") return null;
    const mime = c.type ?? "application/octet-stream";
    return {
      ...base,
      role,
      kind: "file",
      file: { name: c.name || defaultFileName(m.type, mime, m.timestamp), url: c.url, mime },
    };
  }
  return null; // events, carousels, pickers ...
}

export const CRISP_WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

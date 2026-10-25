// Q: REST routes/scopes/pagination, file URL behaviour, deep link, quotas.
// Needs CRISP_PLUGIN_ID/KEY (development token) and CRISP_WEBSITE_ID. Chat on the Dev website first.
import { need, capture, http } from "../lib.js";

const id = need("CRISP_PLUGIN_ID"), key = need("CRISP_PLUGIN_KEY"), site = need("CRISP_WEBSITE_ID");
const headers = {
  authorization: "Basic " + Buffer.from(`${id}:${key}`).toString("base64"),
  "X-Crisp-Tier": "plugin", "content-type": "application/json",
};
const base = "https://api.crisp.chat/v1";
const get = async (label: string, path: string) => {
  const r = await http(base + path, { headers });
  console.log(`${label}: ${r.status}`,
    "ratelimit:", r.headers.get("x-ratelimit-remaining") ?? r.headers.get("ratelimit-remaining") ?? "n/a");
  return r;
};

const w = await get("website", `/website/${site}`);
capture("crisp-website", w.body);

// reconcile candidate: recent conversations (page 1)
const list = await get("conversations list (page 1)", `/website/${site}/conversations/1`);
capture("crisp-conversations-list", list.body);
const first = ((list.body as any)?.data ?? [])[0];
const session = process.env.CRISP_SESSION_ID ?? first?.session_id;
if (!session) { console.log("no conversations yet: chat on the Dev website, rerun."); process.exit(0); }

const conv = await get("conversation", `/website/${site}/conversation/${session}`);
capture("crisp-conversation", conv.body);
const meta = await get("conversation meta", `/website/${site}/conversation/${session}/meta`);
capture("crisp-conversation-meta", meta.body);

// messages: does pagination use timestamp_before? how many per page?
const msgs = await get("messages", `/website/${site}/conversation/${session}/messages`);
capture("crisp-messages", msgs.body);
const data = ((msgs.body as any)?.data ?? []) as any[];
console.log("  messages:", data.length, "types:", [...new Set(data.map((m) => `${m.type}/${m.from}`))].join(", "));
if (data.length) {
  const oldest = Math.min(...data.map((m) => m.timestamp));
  const page2 = await get("messages page 2 (timestamp_before)", `/website/${site}/conversation/${session}/messages?timestamp_before=${oldest}`);
  console.log("  page 2 messages:", ((page2.body as any)?.data ?? []).length);
}

// files: can the URL be fetched without our credentials? does it expire?
for (const m of data.filter((m) => m.type === "file" || m.type === "animation" || m.type === "audio")) {
  const url = m.content?.url;
  if (!url) continue;
  const noAuth = await fetch(url, { method: "HEAD", redirect: "manual" });
  console.log(`file ${m.content.name}: HEAD without auth -> ${noAuth.status}`, noAuth.headers.get("content-type"),
    noAuth.headers.get("content-length"), "host:", new URL(url).host);
}
console.log("deep link to verify by clicking:", `https://app.crisp.chat/website/${site}/inbox/${session}/`);

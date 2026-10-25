// Q: 3LO flow + refresh, createmeta, ADF description, attachment limit, `updated` reliability.
// Run 1: no tokens -> starts a local callback server, prints the authorize URL.
// Run 2+: uses spikes/.tokens.json.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { need, capture, http } from "../lib.js";

const here = dirname(fileURLToPath(import.meta.url));
const tokenFile = join(here, "..", ".tokens.json");
const clientId = need("ATLASSIAN_CLIENT_ID"), clientSecret = need("ATLASSIAN_CLIENT_SECRET");
const redirect = "http://localhost:3000/callback";
const scope = "read:jira-work write:jira-work read:jira-user offline_access";

async function token(body: Record<string, string>) {
  const r = await http("https://auth.atlassian.com/oauth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...body }),
  });
  if (r.status !== 200) { console.error("token error", r.status, r.body); process.exit(1); }
  return r.body as { access_token: string; refresh_token?: string; expires_in: number };
}

async function authorize() {
  const state = randomBytes(16).toString("hex");
  const url = "https://auth.atlassian.com/authorize?" + new URLSearchParams({
    audience: "api.atlassian.com", client_id: clientId, scope, redirect_uri: redirect, state, response_type: "code", prompt: "consent",
  });
  console.log("Open this and approve:\n\n" + url + "\n");
  const code = await new Promise<string>((resolve) => {
    const s = createServer((req, res) => {
      const u = new URL(req.url!, "http://localhost:3000");
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      if (u.searchParams.get("state") !== state) { res.writeHead(400).end("bad state"); return; }
      res.end("Done, you can close this tab."); s.close(); resolve(u.searchParams.get("code")!);
    }).listen(3000);
  });
  const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirect });
  writeFileSync(tokenFile, JSON.stringify({ ...t, obtained: Date.now() }));
  return t;
}

let tok = existsSync(tokenFile) ? JSON.parse(readFileSync(tokenFile, "utf8")) : await authorize();
// refresh test (rotating refresh tokens: save the new one)
if (tok.refresh_token) {
  const n = await token({ grant_type: "refresh_token", refresh_token: tok.refresh_token });
  console.log("refresh ok; new refresh token issued:", !!n.refresh_token, "expires_in", n.expires_in);
  tok = { ...n, refresh_token: n.refresh_token ?? tok.refresh_token };
  writeFileSync(tokenFile, JSON.stringify(tok));
}
const auth = { authorization: `Bearer ${tok.access_token}`, accept: "application/json", "content-type": "application/json" };

const sites = await http("https://api.atlassian.com/oauth/token/accessible-resources", { headers: auth });
const site = (sites.body as any[])[0];
console.log("site:", site?.name, site?.id);
const base = `https://api.atlassian.com/ex/jira/${site.id}/rest/api/3`;
const project = process.env.JIRA_PROJECT_KEY;
if (!project) {
  const pr = await http(`${base}/project/search`, { headers: auth });
  console.log("projects:", ((pr.body as any).values ?? []).map((p: any) => p.key).join(", "));
  console.log("Set JIRA_PROJECT_KEY and rerun."); process.exit(0);
}

const priorities = await http(`${base}/priority`, { headers: auth });
console.log("priorities:", (priorities.body as any[]).map((p) => `${p.id}:${p.name}`).join(", "));
const meta = await http(`${base}/issue/createmeta/${project}/issuetypes`, { headers: auth });
capture("jira-createmeta-issuetypes", meta.body);
const types = (meta.body as any).issueTypes ?? (meta.body as any).values ?? [];
console.log("issue types:", types.map((t: any) => `${t.id}:${t.name}`).join(", "));
const bugType = types.find((t: any) => /bug/i.test(t.name)) ?? types[0];
const fields = await http(`${base}/issue/createmeta/${project}/issuetypes/${bugType.id}`, { headers: auth });
capture("jira-createmeta-fields", fields.body);
const fl = ((fields.body as any).fields ?? (fields.body as any).values ?? []);
const list = Array.isArray(fl) ? fl : Object.values(fl);
console.log("required fields:", list.filter((f: any) => f.required).map((f: any) => f.fieldId ?? f.key).join(", "));

const adf = { type: "doc", version: 1, content: [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Summary" }] },
  { type: "paragraph", content: [{ type: "text", text: "Spike issue. Checkout button does nothing on Safari." }] },
  { type: "orderedList", content: ["Open checkout", "Click Pay"].map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })) },
] };
const created = await http(`${base}/issue`, { method: "POST", headers: auth, body: JSON.stringify({ fields: {
  project: { key: project }, issuetype: { id: bugType.id }, summary: "[spike] Checkout button does nothing on Safari",
  description: adf, labels: ["from-chat"], duedate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
} }) });
console.log("create issue:", created.status, JSON.stringify(created.body).slice(0, 200));
capture("jira-issue-created", created.body);
const key = (created.body as any).key; if (!key) process.exit(0);

// priority may not be on the create screen: set it separately and see
const prio = await http(`${base}/issue/${key}`, { method: "PUT", headers: auth, body: JSON.stringify({ fields: { priority: { id: (priorities.body as any[])[1]?.id } } }) });
console.log("set priority via edit:", prio.status);

for (const mb of [1, 10, 11]) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(mb * 1024 * 1024)]), `spike-${mb}mb.bin`);
  const r = await http(`${base}/issue/${key}/attachments`, { method: "POST", headers: { authorization: auth.authorization, "X-Atlassian-Token": "no-check" }, body: form });
  console.log(`attachment ${mb}MB:`, r.status);
}
const t1 = ((await http(`${base}/issue/${key}?fields=updated`, { headers: auth })).body as any).fields.updated;
await http(`${base}/issue/${key}/comment`, { method: "POST", headers: auth, body: JSON.stringify({ body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "spike comment" }] }] } }) });
const t2 = ((await http(`${base}/issue/${key}?fields=updated`, { headers: auth })).body as any).fields.updated;
console.log(`updated before comment ${t1}, after ${t2} (changed? ${t1 !== t2}) -> if a comment doesn't change it, \`updated\` tracks field edits only`);
console.log("cleanup: delete", key, "by hand when done");

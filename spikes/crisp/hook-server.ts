// Q: do plugin hooks fire on a free workspace; what do payloads look like; does our signature check work?
// Run: pnpm crisp:hook, then in another terminal: cloudflared tunnel --url http://localhost:3000
// Put https://<tunnel>/crisp in the plugin's hook URL. Then chat on the TriageFox Dev website
// (text, a screenshot, a file, a private note, resolve the conversation).

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { capture, need } from "../lib.js";

const secret = need("CRISP_HOOK_SECRET");
let n = 0; // counter

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/crisp") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const ts = String(req.headers["x-crisp-request-timestamp"] ?? "");
    const sig = String(req.headers["x-crisp-signature"] ?? "");
    // documented: HMAC-SHA256 over "[" + timestamp + ";" + body + "]"
    const expected = createHmac("sha256", secret).update(`[${ts};${raw}]`).digest("hex");
    const ok =
      sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    const body = JSON.parse(raw || "{}");
    console.log(
      `#${++n} ${body.event}  signature ${ok ? "OK" : "MISMATCH"}  ts-age ${Math.round(Date.now() / 1000 - Number(ts))}s`,
    );
    console.log(
      "  delivery attempt:",
      req.headers["x-delivery-attempt-count"],
      "/",
      req.headers["x-delivery-attempt-limit"],
    );
    console.log("  data keys:", Object.keys(body.data ?? {}).join(", "));
    capture(`crisp-hook-${String(n).padStart(3, "0")}-${String(body.event).replace(/\W/g, "_")}`, {
      headers: req.headers,
      signatureOk: ok,
      body,
    });
    res.writeHead(200).end("ok");
  });
}).listen(3000, () => console.log("hook server on :3000  (POST /crisp)"));

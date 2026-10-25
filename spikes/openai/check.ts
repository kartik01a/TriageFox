// Q: do our key and the planned models work (text, image input, strict JSON, embeddings)?
import { http, need } from "../lib.js";

const key = need("OPENAI_API_KEY");
const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const MODELS = ["gpt-6-luna", "gpt-6.1-sol"];
// 1x1 red PNG
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const list = await http("https://api.openai.com/v1/models", { headers: auth });
const ids = ((list.body as any)?.data ?? []).map((m: any) => m.id);
console.log("models endpoint:", list.status);
for (const m of MODELS) console.log(`  ${m} visible to this key:`, ids.includes(m));

for (const model of MODELS) {
  const r = await http("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What colour is this image? Answer in JSON." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "c",
          strict: true,
          schema: {
            type: "object",
            properties: { colour: { type: "string" } },
            required: ["colour"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const b = r.body as any;
  console.log(
    `${model}: status ${r.status}`,
    r.status === 200 ? b.choices?.[0]?.message?.content : JSON.stringify(b).slice(0, 300),
  );
  if (r.status === 200) console.log("  usage:", JSON.stringify(b.usage));
}

const e = await http("https://api.openai.com/v1/embeddings", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ model: "text-embedding-3-small", input: "checkout button does nothing" }),
});
console.log("embeddings:", e.status, (e.body as any)?.data?.[0]?.embedding?.length, "dims");

/**
 * Small Markdown -> Atlassian Document Format converter for the subset our tickets use:
 * headings (#..###), paragraphs, ordered/bullet lists, horizontal rules, **bold**, `code`, [text](url).
 * It only ever builds text nodes, so customer or AI text can never inject markup.
 */
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function inline(text: string): AdfNode[] {
  const out: AdfNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ type: "text", text: m[1], marks: [{ type: "strong" }] });
    else if (m[2] !== undefined) out.push({ type: "text", text: m[2], marks: [{ type: "code" }] });
    else
      out.push({
        type: "text",
        text: m[3] ?? "",
        marks: [{ type: "link", attrs: { href: m[4] } }],
      });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((n) => n.text !== "");
}

const paragraph = (text: string): AdfNode => ({ type: "paragraph", content: inline(text) });

export function markdownToAdf(markdown: string): { version: 1; type: "doc"; content: AdfNode[] } {
  const content: AdfNode[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1]?.length ?? 1 },
        content: inline(heading[2] ?? ""),
      });
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      content.push({ type: "rule" });
      i++;
      continue;
    }
    const listKind = /^\s*\d+[.)]\s+/.test(line)
      ? "orderedList"
      : /^\s*[-*]\s+/.test(line)
        ? "bulletList"
        : null;
    if (listKind) {
      const re = listKind === "orderedList" ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: AdfNode[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i] ?? "");
        if (!m) break;
        items.push({ type: "listItem", content: [paragraph(m[1] ?? "")] });
        i++;
      }
      content.push({ type: listKind, content: items });
      continue;
    }
    // Paragraph: consecutive plain lines, kept as separate lines with hard breaks.
    const parts: AdfNode[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(#{1,3}\s|---+\s*$|\s*\d+[.)]\s|\s*[-*]\s)/.test(lines[i] ?? "")
    ) {
      if (parts.length > 0) parts.push({ type: "hardBreak" });
      parts.push(...inline(lines[i] ?? ""));
      i++;
    }
    content.push({ type: "paragraph", content: parts });
  }
  return {
    version: 1,
    type: "doc",
    content: content.length ? content : [{ type: "paragraph", content: [] }],
  };
}

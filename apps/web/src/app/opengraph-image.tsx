import { ImageResponse } from "next/og";
import { FOX_DATA_URI } from "@/components/fox-logo";

export const alt = "TriageFox: customer chats in, perfect tickets out";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card shown when a TriageFox link is shared (Slack, X, LinkedIn…). */
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#111014",
        color: "#fafafa",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* biome-ignore lint/performance/noImgElement: the share-image renderer needs a plain img */}
        <img src={FOX_DATA_URI} alt="TriageFox fox logo" width={96} height={96} />
        <span style={{ fontSize: 56, fontWeight: 800 }}>TriageFox</span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 48,
          fontSize: 84,
          fontWeight: 700,
          lineHeight: 1.05,
        }}
      >
        <span>Customer chats in.</span>
        <span style={{ color: "#f97316" }}>Perfect tickets out.</span>
      </div>
      <div style={{ marginTop: 36, fontSize: 32, color: "#a1a1aa" }}>
        Open source · Crisp → Jira &amp; Trello
      </div>
    </div>,
    size,
  );
}

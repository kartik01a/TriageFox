import { ImageResponse } from "next/og";

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
        <svg role="img" aria-label="TriageFox fox logo" width="84" height="84" viewBox="0 0 32 32">
          <path d="M3 4l9 6h8l9-6-2 13-9 11h-4L5 17 3 4z" fill="#f97316" />
          <path d="M12 10h8l-4 8-4-8z" fill="#fff" opacity="0.92" />
          <circle cx="12.5" cy="15" r="1.2" fill="#111114" />
          <circle cx="19.5" cy="15" r="1.2" fill="#111114" />
        </svg>
        <span style={{ fontSize: 56, fontWeight: 700 }}>TriageFox</span>
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

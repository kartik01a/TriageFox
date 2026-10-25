import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { CrispWidget } from "@/components/crisp-widget";
import "./globals.css";

// Every page is rendered per request: the nonce-based CSP (src/proxy.ts) needs a fresh nonce in the
// HTML, which static pages cannot have. It also means `next build` never needs runtime secrets.
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "TriageFox: customer chats in, perfect tickets out",
    template: "%s · TriageFox",
  },
  description:
    "Open-source AI that turns customer chats into Jira and Trello tickets, with priority, steps to reproduce and screenshots.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <CrispWidget />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { CrispWidget } from "@/components/crisp-widget";
import "./globals.css";

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
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        <CrispWidget />
      </body>
    </html>
  );
}

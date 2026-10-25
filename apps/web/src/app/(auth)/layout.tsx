import Link from "next/link";
import { Wordmark } from "@/components/fox-logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <Link href="/" className="mb-8" aria-label="TriageFox home">
        <Wordmark />
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

/** Simple geometric fox head: the TriageFox mark. */
export function FoxMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M3 4l9 6h8l9-6-2 13-9 11h-4L5 17 3 4z" fill="var(--primary)" />
      <path d="M12 10h8l-4 8-4-8z" fill="#fff" opacity=".92" />
      <circle cx="12.5" cy="15" r="1.2" fill="#111114" />
      <circle cx="19.5" cy="15" r="1.2" fill="#111114" />
      <path d="M16 24.6l-1.8-2.2h3.6L16 24.6z" fill="#111114" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
      <FoxMark />
      TriageFox
    </span>
  );
}

/** Only allow same-site relative paths as post-login destinations (prevents open redirects). */
export function safeNext(value: string | null | undefined, fallback = "/app"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return fallback;
  return value;
}

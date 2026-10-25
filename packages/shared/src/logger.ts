import pino from "pino";

/**
 * Field names that must never reach logs (docs/security.md §11).
 * Chat content is also never logged: callers must not pass message bodies at all.
 */
const SENSITIVE = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "secret",
  "password",
  "privateKey",
  "sealed",
  "content",
];

export const redactPaths = SENSITIVE.flatMap((k) => [
  k,
  `*.${k}`,
  `*.*.${k}`,
  `headers.${k}`,
  `req.headers.${k}`,
]);

export function createLogger(name: string, destination?: pino.DestinationStream) {
  return pino(
    {
      name,
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
      redact: { paths: redactPaths, censor: "[redacted]" },
    },
    destination,
  );
}

export type Logger = ReturnType<typeof createLogger>;

import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const base = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MODE: z.enum(["hosted", "selfhost"]).default("hosted"),
  APP_URL: z.url().default("http://localhost:3000"),
  /** Runtime connection: restricted role, row-level security applies. */
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
};

const cryptoPublic = {
  /** JSON object: key version -> base64 public key. The web app only ever has public keys. */
  CRYPTO_PUBLIC_KEYS: z.string().min(2),
  CRYPTO_CURRENT_VERSION: z.coerce.number().int().positive(),
};

export const webEnvSchema = z.object({
  ...base,
  ...cryptoPublic,
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool,
  MAIL_FROM: z.string().default("TriageFox <hello@triagefox.local>"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_CRISP_WEBSITE_ID: z.string().optional(),
});

export const workerEnvSchema = z.object({
  ...base,
  ...cryptoPublic,
  /** JSON object: key version -> base64 private key. Worker ONLY. Never set on the web app. */
  CRYPTO_PRIVATE_KEYS: z.string().min(2),
  SENTRY_DSN: z.string().optional(),
});

export const migrateEnvSchema = z.object({
  /** Owner connection used only for migrations (bypasses RLS). */
  DATABASE_MIGRATION_URL: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Parse and fail fast with a message that names every missing or invalid variable. */
export function parseEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}\nSee .env.example.`);
  }
  return result.data as z.infer<T>;
}

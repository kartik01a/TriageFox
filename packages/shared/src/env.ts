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

const ai = {
  /** Server-side model choice. Customers can bring their own key but never pick models. */
  AI_MODEL_DEFAULT: z.string().default("gpt-6-luna"),
  AI_MODEL_ESCALATION: z.string().default("gpt-6.1-sol"),
  AI_MODEL_EMBEDDING: z.string().default("text-embedding-3-small"),
  AI_MODEL_TRANSCRIBE: z.string().default("gpt-transcribe"),
};

const cryptoPublic = {
  /** JSON object: key version -> base64 public key. The web app only ever has public keys. */
  CRYPTO_PUBLIC_KEYS: z.string().min(2),
  CRYPTO_CURRENT_VERSION: z.coerce.number().int().positive(),
};

export const webEnvSchema = z.object({
  ...base,
  ...cryptoPublic,
  ...ai,
  /** Public identifiers only. Secrets for these providers live in the worker (docs/security.md §3). */
  TRELLO_API_KEY: z.string().optional(),
  ATLASSIAN_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_ID: z.string().optional(),
  /** Crisp plugin hook signing secret: lets the hook route verify that a delivery really came from Crisp. */
  CRISP_HOOK_SECRET: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Hosted billing (Dodo Payments). All optional: without them the billing page says billing is not set up. */
  DODO_API_KEY: z.string().optional(),
  DODO_WEBHOOK_SECRET: z.string().optional(),
  DODO_ENV: z.enum(["test", "live"]).default("test"),
  /** Comma-separated emails allowed into /admin (and only with two-factor sign-in). */
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  /** Crisp identity-verification secret of the support website, to sign the signed-in user's email. */
  CRISP_IDENTITY_SECRET: z.string().optional(),
  /** Self-host only: keep sign-up open after the first account exists. Default: invitation only. */
  SELFHOST_OPEN_SIGNUP: bool,
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool,
  MAIL_FROM: z.string().default("TriageFox <hello@triagefox.local>"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  /**
   * Crisp website id of the TriageFox Support website (the help chat). Read at run time on the server, so the
   * published image works for any install; a NEXT_PUBLIC_ variable would be frozen into the build instead.
   */
  SUPPORT_CRISP_WEBSITE_ID: z.string().optional(),
});

export const workerEnvSchema = z.object({
  ...base,
  ...cryptoPublic,
  ...ai,
  /** The worker sends usage warnings, renewal reminders and support alerts. */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool,
  MAIL_FROM: z.string().default("TriageFox <hello@triagefox.local>"),
  /** Urgent support alerts go here (email) and to the Slack incoming webhook (a secret). */
  ALERT_EMAIL: z.string().optional(),
  SLACK_ALERTS_WEBHOOK_URL: z.string().optional(),
  /** Platform OpenAI key: used when a workspace has not added its own (hosted) or in self-host installs. */
  OPENAI_API_KEY: z.string().optional(),
  /** Guardrails (docs/ai-triage.md "Cost guardrails"). */
  AI_MAX_RUNS_PER_THREAD_PER_MONTH: z.coerce.number().int().positive().default(10),
  /** Spend ceiling per workspace per day on the platform key; own keys are not capped by us. */
  AI_PLATFORM_DAILY_USD_PER_ORG: z.coerce.number().positive().default(1),
  TRELLO_API_KEY: z.string().optional(),
  ATLASSIAN_CLIENT_ID: z.string().optional(),
  ATLASSIAN_CLIENT_SECRET: z.string().optional(),
  /** Linear OAuth app (ADR 0016). The secret is worker only. */
  LINEAR_CLIENT_ID: z.string().optional(),
  LINEAR_CLIENT_SECRET: z.string().optional(),
  /** Crisp plugin: token identifier + key (Marketplace → Tokens) and the plugin's own UUID. */
  CRISP_PLUGIN_ID: z.string().optional(),
  CRISP_PLUGIN_KEY: z.string().optional(),
  CRISP_PLUGIN_UUID: z.string().optional(),
  /** How far back the reconcile job looks for conversations whose hook may have been dropped. */
  RECONCILE_LOOKBACK_MIN: z.coerce.number().int().positive().default(180),
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

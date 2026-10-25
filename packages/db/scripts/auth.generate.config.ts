// Used only to generate src/schema/auth.ts with the Better Auth CLI. Keep the plugins in sync with
// apps/web/src/lib/auth.ts.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  plugins: [organization(), twoFactor()],
});

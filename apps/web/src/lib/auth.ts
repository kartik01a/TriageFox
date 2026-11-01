import "server-only";
import { startTrial } from "@triagefox/billing";
import { and, eq, gt, schema, sql } from "@triagefox/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";
import { recordAudit } from "./audit";
import { db } from "./db";
import { env } from "./env";
import { logger } from "./logger";
import { emailLayout, sendMail } from "./mailer";
import { selfhostSignupOpen } from "./signup-rules";

/** Platform setting `signupEnabled` (ADR 0009). Defaults to open when the row is missing. */
async function signupsOpen() {
  if (env().APP_MODE === "selfhost") {
    // The first account sets the installation up; after that people join by invitation unless the operator opens it.
    const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.user);
    return selfhostSignupOpen({ users: row?.n ?? 0, openSignup: env().SELFHOST_OPEN_SIGNUP });
  }
  const [row] = await db()
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.key, "signupEnabled"));
  return row ? row.value !== false : true;
}

async function hasPendingInvitation(email: string) {
  const [row] = await db()
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.email, email.toLowerCase()),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return !!row;
}

function createAuth() {
  const e = env();
  const isProd = e.NODE_ENV === "production";
  return betterAuth({
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: "pg", schema }),
    appName: "TriageFox",

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        const { html, text } = emailLayout({
          heading: "Reset your password",
          body: "We received a request to reset your TriageFox password. This link is valid for one hour.",
          cta: { label: "Choose a new password", url },
        });
        await sendMail({ to: user.email, subject: "Reset your TriageFox password", html, text });
      },
    },

    // "Continue with Google" appears only when the operator has set both Google values (docs/setup/providers.md).
    // Google vouches for the email address, so these users skip the confirmation email.
    socialProviders:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET } }
        : {},

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const { html, text } = emailLayout({
          heading: "Confirm your email",
          body: `Hi ${user.name || "there"}, confirm your email address to finish creating your TriageFox account.`,
          cta: { label: "Confirm email", url },
        });
        await sendMail({ to: user.email, subject: "Confirm your TriageFox email", html, text });
      },
    },

    databaseHooks: {
      session: {
        create: {
          // Start every session in the user's first workspace so /app has something to show.
          before: async (session) => {
            const [m] = await db()
              .select({ orgId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1);
            return { data: { ...session, activeOrganizationId: m?.orgId ?? null } };
          },
        },
      },
      user: {
        create: {
          before: async (user) => {
            if (!(await signupsOpen()) && !(await hasPendingInvitation(user.email))) {
              throw new APIError("FORBIDDEN", { message: "Sign-ups are currently closed." });
            }
            return { data: { ...user, email: user.email.toLowerCase() } };
          },
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      // Sensitive built-in actions (such as turning two-factor off) need a sign-in from the last 15 minutes.
      freshAge: 60 * 15,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    // Brute-force protection on top of Cloudflare's rules (docs/security.md §5).
    rateLimit: {
      // Only the automated browser tests switch this off (they create many accounts in a minute); never in production.
      enabled: isProd || process.env.E2E_DISABLE_AUTH_RATE_LIMIT !== "true",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },

    advanced: {
      useSecureCookies: isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: isProd },
    },

    plugins: [
      organization({
        invitationExpiresIn: 60 * 60 * 24 * 7,
        organizationHooks: {
          afterCreateOrganization: async ({ organization, user }) => {
            // Hosted: every new workspace starts its free trial (self-hosted installs have no billing).
            if (e.APP_MODE === "hosted")
              await startTrial(db(), organization.id).catch((err) =>
                logger.error({ err: (err as Error).message }, "could not start the trial"),
              );
            await recordAudit({
              orgId: organization.id,
              actorUserId: user.id,
              action: "workspace.created",
              target: organization.id,
            });
          },
          afterCreateInvitation: async ({ invitation, inviter }) => {
            await recordAudit({
              orgId: invitation.organizationId,
              actorUserId: inviter.id,
              action: "member.invited",
              target: invitation.id,
              metadata: { role: invitation.role },
            });
          },
          afterAcceptInvitation: async ({ invitation, user }) => {
            await recordAudit({
              orgId: invitation.organizationId,
              actorUserId: user.id,
              action: "invitation.accepted",
              target: invitation.id,
            });
          },
        },
        sendInvitationEmail: async (data) => {
          const url = `${e.APP_URL}/accept-invitation/${data.id}`;
          const { html, text } = emailLayout({
            heading: `Join ${data.organization.name} on TriageFox`,
            body: `${data.inviter.user.name} invited you to the ${data.organization.name} workspace as ${data.role}. This invitation expires in 7 days.`,
            cta: { label: "Accept invitation", url },
          });
          await sendMail({
            to: data.email,
            subject: `${data.inviter.user.name} invited you to ${data.organization.name} on TriageFox`,
            html,
            text,
          });
          logger.info({ invitationId: data.id }, "invitation email sent");
        },
      }),
      twoFactor({ issuer: "TriageFox" }),
      nextCookies(), // keep last
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Created on first use, so `next build` needs no runtime secrets. */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];

import { z } from "zod";

/**
 * Platform settings that live in the database (ADR 0009), edited through the admin routes.
 * These are only the fallbacks used when a key has never been saved.
 */
export const platformSettingsSchemas = {
  trial: z.object({
    days: z.number().int().min(1).max(90),
    conversationCap: z.number().int().min(1).max(100_000),
    cardRequired: z.boolean(),
    unlimitedWithOwnKey: z.boolean(),
  }),
  budgets: z.object({
    /** Platform-wide AI spend allowed for trial workspaces per month; beyond it new trials need their own key. */
    trialAiUsdMonthly: z.number().min(0),
    platformAiUsdMonthly: z.number().min(0),
  }),
  grace: z.object({ pastDueDays: z.number().int().min(0).max(60) }),
  reminders: z.object({
    monthlyDays: z.number().int().min(1).max(30),
    yearlyDays: z.number().int().min(1).max(60),
  }),
  support: z.object({
    /** Categories the platform's own support automation turns into inbox items. */
    capture: z.array(z.string()),
    /** Categories that raise an urgent email + Slack alert. */
    urgent: z.array(z.string()),
    /** Bugs at or above this priority are urgent too. */
    urgentMinPriority: z.number().int().min(1).max(5),
  }),
  signupEnabled: z.boolean(),
} as const;

export type PlatformSettingKey = keyof typeof platformSettingsSchemas;
export type PlatformSettings = {
  [K in PlatformSettingKey]: z.infer<(typeof platformSettingsSchemas)[K]>;
};

export const defaultPlatformSettings: PlatformSettings = {
  trial: { days: 7, conversationCap: 50, cardRequired: false, unlimitedWithOwnKey: true },
  budgets: { trialAiUsdMonthly: 10, platformAiUsdMonthly: 200 },
  grace: { pastDueDays: 7 },
  reminders: { monthlyDays: 3, yearlyDays: 7 },
  support: {
    capture: ["bug", "feature", "billing", "refund_request", "account", "complaint", "praise"],
    urgent: ["billing", "refund_request", "account"],
    urgentMinPriority: 4,
  },
  signupEnabled: true,
};

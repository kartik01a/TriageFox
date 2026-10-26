import { getSettings, type PlatformSettingKey } from "@triagefox/billing";
import { db } from "@/lib/db";
import { JsonEditor } from "../admin-forms";

const HELP: Record<PlatformSettingKey, string> = {
  trial: "Trial: days, conversation cap, card required, unlimited with own key.",
  budgets: "AI budgets in USD per month: for all trials together, and the platform as a whole.",
  grace: "Days a failed payment keeps working before conversations pause.",
  reminders: "Days before a monthly / yearly renewal that the reminder email is sent.",
  support:
    "Support automation: categories captured, categories that raise an urgent alert, and the bug priority that does too.",
  signupEnabled: "true or false: whether new people can sign up.",
};

export default async function SettingsPage() {
  const settings = await getSettings(db());
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Changes apply immediately and are recorded in the audit log.
      </p>
      {(Object.keys(HELP) as PlatformSettingKey[]).map((key) => (
        <section key={key} className="space-y-1">
          <h2 className="font-semibold">{key}</h2>
          <p className="text-muted-foreground">{HELP[key]}</p>
          <JsonEditor
            url="/api/admin/settings"
            method="PUT"
            initial={settings[key]}
            wrap={(value) => ({ key, value })}
            label={`Value of ${key}`}
          />
        </section>
      ))}
    </div>
  );
}

import { getSettings, type PlatformSettingKey } from "@triagefox/billing";
import { db } from "@/lib/db";
import { SettingForm } from "../admin-forms";
import { PageHeader, Panel } from "../admin-ui";

const SECTIONS: Record<PlatformSettingKey, { title: string; help: string }> = {
  signupEnabled: {
    title: "Sign-ups",
    help: "Switch off to stop new people from creating accounts.",
  },
  trial: {
    title: "Free trial",
    help: "How long a new workspace can try TriageFox, and how many conversations it gets.",
  },
  budgets: {
    title: "AI budgets (USD per month)",
    help: "A ceiling for all trials together and for the platform as a whole. Beyond it, trials need their own OpenAI key.",
  },
  grace: {
    title: "Failed payments",
    help: "Days a failed payment keeps working before new conversations pause.",
  },
  reminders: {
    title: "Renewal reminders",
    help: "How many days before a monthly or yearly renewal the reminder email goes out.",
  },
  support: {
    title: "Our own support automation",
    help: "Which kinds of customer messages become inbox items, which raise an urgent alert, and the bug priority that does too.",
  },
};

export default async function SettingsPage() {
  const settings = await getSettings(db());
  return (
    <>
      <PageHeader title="Settings">
        Changes apply immediately and are recorded in the audit log.
      </PageHeader>
      {(Object.keys(SECTIONS) as PlatformSettingKey[]).map((key) => (
        <Panel key={key} title={SECTIONS[key].title}>
          <p className="-mt-1 text-muted-foreground">{SECTIONS[key].help}</p>
          <SettingForm settingKey={key} initial={settings[key]} />
        </Panel>
      ))}
    </>
  );
}

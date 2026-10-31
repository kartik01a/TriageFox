import { describe, expect, it } from "vitest";
import { createNotifier, revokedNotice } from "./notify";

const log = { info() {}, warn() {}, error() {} };
const config = {
  APP_URL: "https://app.example",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  MAIL_FROM: "x@y.z",
  ALERT_EMAIL: "ops@example.test",
} as never;

/** The smallest Redis stand-in the notifier uses: SET key value EX n NX. */
const fakeRedis = () => {
  const seen = new Set<string>();
  return { set: async (k: string) => (seen.has(k) ? null : (seen.add(k), "OK")) } as never;
};

describe("alerts", () => {
  it("sends an alert with a dedupe key once, and different keys separately", async () => {
    const sent: string[] = [];
    const n = createNotifier({
      db: {} as never,
      config,
      log,
      redis: fakeRedis(),
      send: async (m) => void sent.push(m.subject),
    });
    await n.alert({ subject: "A", text: "x", dedupeKey: "k1" });
    await n.alert({ subject: "A", text: "x", dedupeKey: "k1" });
    await n.alert({ subject: "B", text: "x", dedupeKey: "k2" });
    await n.alert({ subject: "C", text: "no key, always sent" });
    await n.alert({ subject: "C", text: "no key, always sent" });
    expect(sent).toEqual(["A", "B", "C", "C"]);
  });

  it("posts to Slack when a webhook is configured, and a Slack failure never throws", async () => {
    const calls: string[] = [];
    const ok = createNotifier({
      db: {} as never,
      config: {
        ...(config as object),
        SLACK_ALERTS_WEBHOOK_URL: "https://hooks.slack.example/T/B/x",
      } as never,
      log,
      send: async () => {},
      fetch: (async (url: string, init: RequestInit) => (
        calls.push(`${url} ${init.body}`), new Response("ok")
      )) as unknown as typeof fetch,
    });
    await ok.alert({ subject: "Down", text: "details" });
    expect(calls[0]).toContain("hooks.slack.example");
    expect(calls[0]).toContain("Down");
    const broken = createNotifier({
      db: {} as never,
      config: {
        ...(config as object),
        SLACK_ALERTS_WEBHOOK_URL: "https://hooks.slack.example/x",
      } as never,
      log,
      send: async () => {},
      fetch: (async () => {
        throw new Error("network");
      }) as unknown as typeof fetch,
    });
    await expect(broken.alert({ subject: "Down", text: "d" })).resolves.toBeUndefined();
  });
});

describe("revoked notice", () => {
  it("tells the owner what happened and what to do, in plain words", () => {
    const t = revokedNotice("trello");
    expect(t.subject).toBe("Trello needs to be reconnected");
    expect(t.body).toMatch(/nothing is lost/);
    expect(t.body).toMatch(/Try all again/);
    expect(revokedNotice("crisp").body).toMatch(/plugin/);
  });
});

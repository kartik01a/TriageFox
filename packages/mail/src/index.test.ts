import { describe, expect, it } from "vitest";
import { createMailer, emailLayout } from "./index";

describe("emailLayout", () => {
  it("escapes everything it is given, so names and messages can never inject markup", () => {
    const { html, text } = emailLayout({
      heading: "<script>alert(1)</script>",
      body: 'Hi "friend" & <b>co</b>',
      cta: { label: "Open", url: "https://app.example/x?a=1&b=<2>" },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>co</b>");
    expect(html).toContain("&#60;script&#62;");
    expect(html).toContain("https://app.example/x?a=1&#38;b=&#60;2&#62;");
    expect(text).toContain("Open: https://app.example/x");
  });

  it("works without a button", () => {
    const { html, text } = emailLayout({ heading: "Heads up", body: "Line one\nLine two" });
    expect(html).not.toContain("<a href");
    expect(text).toContain("Heads up");
    expect(text).not.toContain("undefined");
  });
});

describe("createMailer", () => {
  it("reports a delivery failure without the message body, then rethrows", async () => {
    const seen: { subject: string; message: string }[] = [];
    // Nothing listens on this port, so sending fails; the callback must get the subject, never the body.
    const mailer = createMailer(
      { host: "127.0.0.1", port: 1, secure: false, from: "a@b.c" },
      (err, subject) => seen.push({ subject, message: err.message }),
    );
    await expect(
      mailer.send({
        to: "x@y.z",
        subject: "Reset",
        text: "secret-link-123",
        html: "<p>secret-link-123</p>",
      }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.subject).toBe("Reset");
    expect(JSON.stringify(seen)).not.toContain("secret-link-123");
  });
});

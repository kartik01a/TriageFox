import { describe, expect, it } from "vitest";
import { supportEmail, supportMessage } from "./support";

const good = {
  name: "Asha",
  email: " Asha@Example.com ",
  topic: "problem",
  message: "Tickets stopped appearing in Jira since this morning.",
};

describe("support form input", () => {
  it("accepts a normal message and tidies the email", () => {
    const m = supportMessage.parse(good);
    expect(m.email).toBe("asha@example.com");
    expect(m.website).toBeUndefined();
  });

  it("refuses line breaks in one-line fields, so nothing can be added to email headers", () => {
    expect(supportMessage.safeParse({ ...good, name: "Asha\nBcc: x@y.z" }).success).toBe(false);
    expect(supportMessage.safeParse({ ...good, email: "a@b.c\nBcc: x@y.z" }).success).toBe(false);
    expect(supportMessage.safeParse({ ...good, page: "/app\r\nX: y" }).success).toBe(false);
  });

  it("refuses an unknown topic, a bad email, an empty name and a message too short or too long", () => {
    expect(supportMessage.safeParse({ ...good, topic: "hack" }).success).toBe(false);
    expect(supportMessage.safeParse({ ...good, email: "not-an-email" }).success).toBe(false);
    expect(supportMessage.safeParse({ ...good, name: "   " }).success).toBe(false);
    expect(supportMessage.safeParse({ ...good, message: "hi" }).success).toBe(false);
    expect(supportMessage.safeParse({ ...good, message: "x".repeat(5001) }).success).toBe(false);
  });

  it("keeps the hidden bot field, so the route can drop those messages", () => {
    expect(supportMessage.parse({ ...good, website: "http://spam" }).website).toBe("http://spam");
  });
});

describe("support email", () => {
  const m = supportMessage.parse({ ...good, page: "/app/connections" });

  it("replies to the sender, and the subject holds only our own topic label", () => {
    const e = supportEmail({ ...m, message: "Subject: urgent!!! click here" });
    expect(e.replyTo).toBe("asha@example.com");
    expect(e.subject).toBe("Support: Something isn't working");
  });

  it("says when the sender was not signed in, so account and billing requests are checked first", () => {
    expect(supportEmail(m).text).toContain("Not signed in: the email address is unverified");
  });

  it("adds the signed-in account from the server, and flags a different reply address", () => {
    const e = supportEmail(m, {
      userId: "u1",
      accountEmail: "owner@company.com",
      workspaceId: "w1",
    });
    expect(e.text).toContain("Signed in as: owner@company.com (user u1, workspace w1)");
    expect(e.text).toContain("reply address differs");
    expect(e.text).toContain("About: /app/connections");
  });

  it("escapes the message in the HTML version", () => {
    const e = supportEmail({ ...m, message: "<img src=x onerror=alert(1)> broken page" });
    expect(e.html).not.toContain("<img src=x");
    expect(e.text).toContain("<img src=x onerror=alert(1)>");
  });
});

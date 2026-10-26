import { describe, expect, it } from "vitest";
import { dateInTimezone, resolveDueDate } from "./dates";

// Monday 26 October 2026, 10:00 UTC.
const MON = Date.UTC(2026, 9, 26, 10, 0, 0);
const msg = (text: string, at = MON, role: "customer" | "operator" | "note" = "customer") => ({
  role,
  at,
  text,
});
const due = (quote: string | null, text = quote ?? "", tz = "UTC", at = MON) =>
  resolveDueDate({ quote, messages: [msg(`please fix this ${text}`, at)], timezone: tz });
const date = (quote: string, text?: string, tz?: string, at?: number) => {
  const r = due(quote, text, tz, at);
  return r.ok ? r.date : r.reason;
};

describe("resolveDueDate: explicit deadlines", () => {
  it.each([
    ["by Friday", "2026-10-30"],
    ["by tomorrow", "2026-10-27"],
    ["in 3 days", "2026-10-29"],
    ["next Tuesday", "2026-11-03"],
    ["before Nov 5", "2026-11-05"],
    ["by 31 December", "2026-12-31"],
    ["on 2026-11-12", "2026-11-12"],
    ["end of the month", "2026-10-31"],
    ["by end of day", "2026-10-26"],
    ["EOD", "2026-10-26"],
    ["end of the week", "2026-10-30"],
    ["by the 15th", "2026-11-15"],
    ["on the 3rd", "2026-11-03"],
    ["in two weeks", "2026-11-09"],
  ])("%s → %s", (quote, expected) => {
    expect(date(quote)).toBe(expected);
  });

  it("works in other languages", () => {
    expect(date("para el viernes")).toBe("2026-10-30");
    expect(date("bis Freitag")).toBe("2026-10-30");
    expect(date("avant vendredi")).toBe("2026-10-30");
    expect(date("até sexta-feira")).toBe("2026-10-30");
  });

  it("uses the time the customer wrote the message, not now", () => {
    const earlier = Date.UTC(2026, 9, 19, 10, 0, 0); // the previous Monday
    expect(date("by Friday", undefined, "UTC", earlier)).toBe("2026-10-23");
  });

  it("works in the workspace timezone around midnight", () => {
    const lateUtc = Date.UTC(2026, 9, 26, 23, 30, 0); // 23:30 UTC is already 05:00 on the 27th in India
    expect(dateInTimezone(new Date(lateUtc), "Asia/Kolkata")).toBe("2026-10-27");
    expect(date("tomorrow", undefined, "Asia/Kolkata", lateUtc)).toBe("2026-10-28");
    expect(date("tomorrow", undefined, "UTC", lateUtc)).toBe("2026-10-27");
    const earlyUtc = Date.UTC(2026, 9, 26, 1, 0, 0); // still the 25th evening in New York
    expect(date("end of day", undefined, "America/New_York", earlyUtc)).toBe("2026-10-25");
  });

  it("finds the quote when the customer wrote more around it", () => {
    expect(
      date("by Friday", "this is blocking our launch, we need it by Friday at the latest, thanks"),
    ).toBe("2026-10-30");
  });
});

describe("resolveDueDate: no invented dates", () => {
  it("no quote → no date", () => {
    expect(date("")).toBe("no_quote");
    expect(due(null)).toEqual({ ok: false, reason: "no_quote" });
    expect(resolveDueDate({ quote: undefined, messages: [msg("hi")], timezone: "UTC" })).toEqual({
      ok: false,
      reason: "no_quote",
    });
  });

  it("a quote the customer never wrote is rejected (a hallucination)", () => {
    const r = resolveDueDate({
      quote: "by Friday",
      messages: [msg("the export button is broken")],
      timezone: "UTC",
    });
    expect(r).toEqual({ ok: false, reason: "not_in_customer_text" });
  });

  it("only the customer's own words count, not support's", () => {
    const r = resolveDueDate({
      quote: "by Friday",
      messages: [
        msg("it's broken"),
        msg("we'll fix it by Friday", MON, "operator"),
        msg("internal: deadline by Friday", MON, "note"),
      ],
      timezone: "UTC",
    });
    expect(r).toEqual({ ok: false, reason: "not_in_customer_text" });
  });

  it.each([
    "ASAP",
    "as soon as possible",
    "soon",
    "urgent",
    "urgently",
    "immediately",
    "right now",
    "whenever",
    "this week",
    "next week",
    "next month",
    "the sooner the better",
  ])("vague phrase %j → no date", (quote) => {
    expect(date(quote)).toBe("vague");
  });

  it("an unparseable phrase → no date", () => {
    expect(date("when the stars align")).toBe("unparseable");
    expect(date("before the thing")).toBe("unparseable");
  });

  it("a date already in the past → no date", () => {
    expect(date("on 2026-10-01")).toBe("in_the_past");
    expect(date("by 3 October")).not.toBe("2026-10-03"); // forward-dated to next year → too far, never the past
  });

  it("an absurdly distant date → no date", () => {
    expect(date("on 2031-01-01")).toBe("too_far");
  });

  it("matching ignores case, quote styles and extra spaces", () => {
    const r = resolveDueDate({
      quote: "BY   friday",
      messages: [msg("we need it ‘by friday’ please")],
      timezone: "UTC",
    });
    expect(r.ok).toBe(true);
  });

  it("uses the latest customer message that contains the quote", () => {
    const early = Date.UTC(2026, 9, 12, 10, 0, 0);
    const r = resolveDueDate({
      quote: "by Friday",
      messages: [msg("need it by Friday", early), msg("still need it by Friday", MON)],
      timezone: "UTC",
    });
    expect(r).toMatchObject({ ok: true, date: "2026-10-30" });
  });
});

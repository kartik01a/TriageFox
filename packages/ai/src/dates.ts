import * as chrono from "chrono-node";

/**
 * Due dates are never invented by the AI. The model may only return the customer's exact words
 * (`dueDateQuote`); this module checks those words really appear in something the customer wrote, and
 * turns them into a calendar date in the workspace's timezone. No quote, a made-up quote, a vague
 * phrase ("ASAP", "soon", "next week") or a date in the past all give NO due date.
 */

export interface DatedMessage {
  role: "customer" | "operator" | "note";
  at: number; // ms
  text?: string;
}

export type DueDateResult =
  | { ok: true; date: string; messageAt: number }
  | {
      ok: false;
      reason:
        | "no_quote"
        | "not_in_customer_text"
        | "vague"
        | "unparseable"
        | "in_the_past"
        | "too_far";
    };

const VAGUE =
  /^(?:as soon as (?:possible|you can)|asap|a\.s\.a\.p\.?|soon|urgent(?:ly)?|immediately|right (?:away|now)|now|whenever|later|eventually|at some point|sometime|this (?:week|month|year|quarter)|next (?:week|month|year|quarter)|the sooner the better|pronto|dès que possible|so schnell wie möglich|sobald wie möglich)\W*$/i;

const strip = (s: string) =>
  s
    .replace(/[​-‍﻿]/g, "")
    .replace(/[“”„‟"'`‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** Calendar date (YYYY-MM-DD) of an instant in the given IANA timezone. */
export function dateInTimezone(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function lastDayOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 = Sunday

/** Phrases chrono does not understand. Returns a YYYY-MM-DD in the workspace timezone, or null. */
function custom(quote: string, today: string): string | null {
  const q = quote.toLowerCase();
  if (/\b(?:end of (?:the )?month|eom)\b/.test(q)) return lastDayOfMonth(today);
  if (/\b(?:end of (?:the )?(?:day|business)|eod|cob|close of business)\b/.test(q)) return today;
  if (/\bend of (?:this |the )?week\b/.test(q)) {
    const toFriday = (5 - weekday(today) + 7) % 7;
    return addDays(today, toFriday);
  }
  // "by the 15th", "on the 3rd": the next time that day of the month comes around.
  const ordinal =
    /\b(?:by|before|on|until|till|for)?\s*(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/.exec(
      q,
    );
  if (ordinal && !/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(q)) {
    const day = Number(ordinal[1]);
    if (day >= 1 && day <= 31) {
      const [y, m, d] = today.split("-").map(Number) as [number, number, number];
      for (let add = 0; add < 3; add++) {
        const cand = new Date(Date.UTC(y, m - 1 + add, day));
        if (
          cand.getUTCDate() === day &&
          cand.toISOString().slice(0, 10) >= (add === 0 && day < d ? "9999" : today)
        )
          return cand.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

const PARSERS = [chrono.en, chrono.es, chrono.de, chrono.fr, chrono.pt];

export function resolveDueDate(opts: {
  quote: string | null | undefined;
  messages: DatedMessage[];
  timezone: string;
}): DueDateResult {
  const quote = opts.quote ? strip(opts.quote) : "";
  if (quote.length < 2) return { ok: false, reason: "no_quote" };
  if (quote.length > 160) return { ok: false, reason: "unparseable" };

  // The words must come from the customer: find the latest customer message containing them verbatim.
  const needle = quote.toLowerCase();
  const source = [...opts.messages]
    .filter((m) => m.role === "customer" && m.text)
    .sort((a, b) => b.at - a.at)
    .find((m) =>
      strip(m.text ?? "")
        .toLowerCase()
        .includes(needle),
    );
  if (!source) return { ok: false, reason: "not_in_customer_text" };
  if (VAGUE.test(quote)) return { ok: false, reason: "vague" };

  const instant = new Date(source.at);
  const today = dateInTimezone(instant, opts.timezone);
  let date = custom(quote, today);
  if (!date) {
    for (const parser of PARSERS) {
      const hit = parser.parse(
        quote,
        { instant, timezone: opts.timezone },
        { forwardDate: true },
      )[0];
      if (hit) {
        date = dateInTimezone((hit.end ?? hit.start).date(), opts.timezone);
        break;
      }
    }
  }
  if (!date) return { ok: false, reason: VAGUE.test(quote) ? "vague" : "unparseable" };
  if (date < today) return { ok: false, reason: "in_the_past" };
  if (date > addDays(today, 400)) return { ok: false, reason: "too_far" };
  return { ok: true, date, messageAt: source.at };
}

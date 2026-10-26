/**
 * Best-effort removal of personal data and secrets from text, applied BEFORE anything is sent to the
 * AI provider and again to what comes back (docs/security.md §4, docs/ai-triage.md).
 * It errs on the side of redacting: a ticket never needs a card number or someone's password.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, // API keys (OpenAI, Stripe style)
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];

// "my password is hunter2", "api_key: abc123", "token=xyz": keep the label, drop the value.
const LABELLED_SECRET =
  /(\b(?:password|passwd|pwd|passcode|secret|token|api[_ -]?key)\b\s*(?:is|=|:)\s*)(?!\[)([^\s,;]+)/gi;

// Card numbers: 13-19 digits (optionally grouped by spaces or dashes) that pass the Luhn check.
const CARD = /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g;

// Phone numbers: international (+...), grouped with separators, or a contiguous Indian mobile number.
const PHONE_GROUPED =
  /(?<![\w.])(?:\+\d[\d\s().-]{7,17}\d|\(?\d{2,5}\)?[\s.-]\d{2,5}[\s.-]\d{2,5}(?:[\s.-]\d{1,5})?)(?!\w|\.\d)/g;
const PHONE_INDIAN = /(?<![\d.])[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export interface Redacted {
  text: string;
  /** How many things were replaced (never what they were). */
  count: number;
}

export function redact(input: string): Redacted {
  let count = 0;
  const swap = (re: RegExp, to: string | ((m: string, ...g: string[]) => string), text: string) =>
    text.replace(re, (...args) => {
      const m = args[0] as string;
      const replacement = typeof to === "string" ? to : to(m, ...(args.slice(1, -2) as string[]));
      if (replacement !== m) count++;
      return replacement;
    });

  let t = input;
  for (const re of SECRET_PATTERNS) t = swap(re, "[secret]", t);
  t = swap(LABELLED_SECRET, (_m, label) => `${label}[secret]`, t);
  t = swap(EMAIL, "[email]", t);
  t = swap(
    CARD,
    (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? "[card]" : m;
    },
    t,
  );
  t = swap(
    PHONE_GROUPED,
    (m) => {
      const digits = m.replace(/\D/g, "").length;
      // Dates (2026-10-26), versions and short codes have too few digits; very long runs are IDs.
      if (digits < 9 || digits > 15 || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(m.trim())) return m;
      return "[phone]";
    },
    t,
  );
  t = swap(PHONE_INDIAN, "[phone]", t);
  return { text: t, count };
}

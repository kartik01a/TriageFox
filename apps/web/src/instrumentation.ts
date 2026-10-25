import * as Sentry from "@sentry/nextjs";

/** Error reporting is off unless SENTRY_DSN is set. Request bodies, cookies and headers are removed. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    beforeSend(event) {
      if (event.request) {
        event.request.data = undefined;
        event.request.cookies = undefined;
        event.request.headers = undefined;
      }
      return event;
    },
  });
}

export const onRequestError = Sentry.captureRequestError;

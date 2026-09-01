import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

/**
 * Error reporting on the server, off unless a DSN is configured.
 *
 * The route handlers only ever hold ciphertext, so there is far less to leak
 * here than in the browser — but the scrubber is applied anyway, because a URL
 * reaching a log is a URL reaching a log, and the rule is easier to keep when
 * it has no exceptions.
 */
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
}

export const onRequestError = Sentry.captureRequestError;

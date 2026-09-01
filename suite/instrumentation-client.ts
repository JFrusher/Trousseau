import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry/scrub";

/**
 * Error reporting in the browser, off unless a DSN is configured.
 *
 * Configured deliberately narrowly, because a default install would contradict
 * the promise the front page makes. No session replay — that records the
 * screen, and the screen is the guest list. No PII. No performance tracing, so
 * nothing is sent for a page that did not break.
 *
 * `beforeSend` is the part that must not be removed: see `lib/sentry/scrub.ts`.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // A report is sent only when something breaks.
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    // Breadcrumbs are kept for navigation and clicks, which say where an error
    // happened. Console breadcrumbs are not: the tools log document contents
    // while working, and that is the wedding.
    beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

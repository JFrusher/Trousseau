"use client";

import { useEffect } from "react";

/**
 * A render or data error inside the application.
 *
 * The copy matters more than usual here. The wedding lives in this browser, so
 * "your work is still on this device" is literally true, and a generic
 * "something went wrong" would read as data loss to someone who has just spent
 * an evening seating a room. Reload is offered as well as retry, because a
 * boundary reset re-renders the same state and hits the same error whenever the
 * cause is the document rather than the render.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry, when it is configured, picks this up through the same handler as
    // any other unhandled error. Kept as a console error so an unconfigured
    // deployment still leaves something to read.
    console.error("[Trousseau]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-16 text-center">
      <p className="text-sm tracking-[0.14em] text-rose uppercase">Something broke</p>
      <h1 className="mt-4 text-3xl">This part of the app stopped</h1>
      <p className="mt-4 text-slate">
        Your wedding is still saved on this device. Nothing has been lost, and nothing has been
        sent anywhere.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded border border-charcoal px-5 py-2.5 hover:bg-stone"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-11 items-center rounded border border-transparent bg-charcoal px-5 py-2.5 text-parchment hover:opacity-90"
        >
          Reload the page
        </button>
      </div>
      {error.digest ? (
        // The only handle on a production error, where the message is stripped.
        <p className="mt-6 text-xs text-slate">Reference: {error.digest}</p>
      ) : null}
    </main>
  );
}

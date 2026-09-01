"use client";

import { useEffect } from "react";

/**
 * Catches what React's boundaries cannot.
 *
 * An error thrown inside a promise that nobody awaited never reaches an error
 * boundary — it goes straight to the browser's default handler, which in
 * production is silence. Most of the risky work in this app is exactly that
 * shape: autosaves, font loading, PDF rendering, and every sync call.
 *
 * Deliberately does not call `preventDefault()`. Swallowing the event would
 * hide these from the browser console and from Sentry, which is the opposite of
 * the point — this exists to make them visible, not to make them quiet.
 *
 * Mounted in the root layout rather than beside the store, so `/seat` is
 * covered too. That page is the one with visitors who did not choose this
 * software and cannot be asked to reproduce anything.
 */
export function ReportUnhandled() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error("[Trousseau] unhandled rejection:", event.reason);
    };
    const onError = (event: ErrorEvent) => {
      console.error("[Trousseau] uncaught error:", event.error ?? event.message);
    };

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Shown when a sign-in link arrived but did not produce a session.
 *
 * On the front page as well as the account page, because a link whose redirect
 * fell back to the project's Site URL lands here rather than there — and being
 * returned to a page that simply says "sign in" after clicking a sign-in link
 * is the least helpful thing the app could do.
 */
export function SignInFailed() {
  const [failed, setFailed] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setFailed(new URLSearchParams(window.location.search).get("signin") === "failed");
    setOrigin(window.location.origin);
  }, []);

  if (!failed) return null;

  return (
    <div className="mb-5 rounded border border-rose/40 bg-rose/10 px-3 py-2 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-charcoal">
        <AlertTriangle size={15} className="shrink-0 text-rose" />
        That link did not sign you in.
      </p>
      <p className="mt-1 text-slate">
        A sign-in link has to be opened in the same browser that asked for it, and has to return
        you to the same address you started on. You are on <strong>{origin}</strong> — if you were
        planning somewhere else, go back there: your wedding is stored per address and is still
        sitting there untouched.
      </p>
    </div>
  );
}

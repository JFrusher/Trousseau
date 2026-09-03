"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User } from "lucide-react";
import { browserClient } from "@/lib/accounts/browserClient";

/**
 * "Sign in", or the signed-in email, in the header on every page.
 *
 * Renders nothing on a deployment with no accounts configured — the account
 * feature is entirely opt-in, and a header link to a page that would just say
 * "not set up here" is worse than no link at all.
 */
export function AccountStatus() {
  const client = browserClient();
  // undefined: not checked yet. null: checked, signed out.
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!client) {
      setEmail(null);
      return;
    }
    let cancelled = false;
    client.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [client]);

  if (!client || email === undefined) return null;

  return (
    <Link
      href={email ? "/account" : "/login"}
      className="inline-flex shrink-0 items-center gap-1.5 rounded border border-charcoal/15 px-2.5 py-1.5 text-sm text-slate transition hover:border-gold hover:text-charcoal"
    >
      <User size={15} />
      <span className="hidden sm:inline">{email ?? "Sign in"}</span>
    </Link>
  );
}

"use client";

import { useState } from "react";
import { browserClient } from "@/lib/accounts/browserClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = browserClient();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!client) {
      setError("Accounts are not set up on this deployment.");
      return;
    }
    // The link has to come back through `/auth/callback`, which exchanges its
    // code for a real session; without a redirect target there is nowhere for
    // that exchange to happen and signing in never takes effect.
    const { error: sendError } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setSent(true);
  }

  if (!client) {
    return <p>Accounts are not set up on this deployment. Everything still works without one.</p>;
  }

  if (sent) {
    return <p>Check {email} for a sign-in link.</p>;
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Send me a sign-in link</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

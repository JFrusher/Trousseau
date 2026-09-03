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
    const { error: sendError } = await client.auth.signInWithOtp({ email });
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

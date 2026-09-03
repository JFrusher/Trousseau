"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/accounts/browserClient";

interface AccountState {
  signedIn: boolean;
  weddingId: string | null;
}

export default function AccountPage() {
  const [state, setState] = useState<AccountState | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const client = browserClient();

  useEffect(() => {
    if (!client) {
      setState({ signedIn: false, weddingId: null });
      return;
    }
    client.auth.getUser().then(({ data }) => {
      setState({ signedIn: Boolean(data.user), weddingId: null });
    });
  }, [client]);

  async function createWedding() {
    const response = await fetch("/api/accounts/wedding", { method: "POST" });
    const body = (await response.json()) as { weddingId?: string; error?: string };
    if (!response.ok) {
      setNotice(body.error ?? "Could not create a wedding.");
      return;
    }
    setState((prev) => (prev ? { ...prev, weddingId: body.weddingId ?? null } : prev));
    setNotice("Wedding created.");
  }

  async function invitePartner(event: React.FormEvent) {
    event.preventDefault();
    if (!state?.weddingId) return;
    const response = await fetch("/api/accounts/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const body = (await response.json()) as { error?: string };
    setNotice(response.ok ? `Invite sent to ${inviteEmail}.` : (body.error ?? "Could not send the invite."));
  }

  if (!client) {
    return <p>Accounts are not set up on this deployment. Everything still works without one.</p>;
  }
  if (!state) return <p>Loading…</p>;
  if (!state.signedIn) return <p>Sign in to manage your wedding account.</p>;

  return (
    <div>
      {!state.weddingId && <button onClick={createWedding}>Create your wedding</button>}
      {state.weddingId && (
        <form onSubmit={invitePartner}>
          <label htmlFor="partner-email">Invite your partner</label>
          <input
            id="partner-email"
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <button type="submit">Send invite</button>
        </form>
      )}
      {notice && <p>{notice}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/accounts/browserClient";

interface AccountState {
  signedIn: boolean;
  weddingId: string | null;
}

/**
 * A failed request doesn't always carry JSON — an unhandled server error comes
 * back as HTML, and `response.json()` on that rejects. Swallowing it here
 * keeps every caller's `await` on the happy path, with `null` standing for
 * "nothing useful came back".
 */
async function readJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
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
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setState({ signedIn: false, weddingId: null });
        return;
      }
      // Ask which wedding this account already belongs to, rather than
      // assuming none: without this, a returning member is offered "create
      // your wedding" on every reload and can never reach the invite form.
      const response = await fetch("/api/accounts/wedding");
      const body = await readJson<{ weddingId?: string | null }>(response);
      setState({ signedIn: true, weddingId: (response.ok && body?.weddingId) || null });
    }).catch(() => {
      // Never leave the page on "Loading…" because a request threw.
      setState({ signedIn: true, weddingId: null });
      setNotice("Could not load your wedding. Please try again.");
    });
  }, [client]);

  async function createWedding() {
    const response = await fetch("/api/accounts/wedding", { method: "POST" });
    const body = await readJson<{ weddingId?: string; error?: string }>(response);
    if (!response.ok) {
      setNotice(body?.error ?? "Could not create a wedding.");
      return;
    }
    setState((prev) => (prev ? { ...prev, weddingId: body?.weddingId ?? null } : prev));
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
    const body = await readJson<{ error?: string }>(response);
    setNotice(response.ok ? `Invite sent to ${inviteEmail}.` : (body?.error ?? "Could not send the invite."));
  }

  async function signOut() {
    await client?.auth.signOut();
    window.location.href = "/login";
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account? Your wedding data goes with it. This cannot be undone.")) {
      return;
    }
    const response = await fetch("/api/accounts/delete", { method: "POST" });
    const body = await readJson<{ error?: string }>(response);
    if (!response.ok) {
      setNotice(body?.error ?? "Could not delete your account.");
      return;
    }
    await client?.auth.signOut();
    window.location.href = "/login";
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
      <button onClick={signOut}>Sign out</button>
      <button onClick={deleteAccount}>Delete my account</button>
    </div>
  );
}

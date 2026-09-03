"use client";

import { useEffect, useState } from "react";
import { LogOut, Trash2, UserPlus } from "lucide-react";
import { browserClient } from "@/lib/accounts/browserClient";
import { Button, TextField } from "@/components/ui/controls";

interface AccountState {
  signedIn: boolean;
  weddingId: string | null;
}

interface Notice {
  text: string;
  tone: "ok" | "error";
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const client = browserClient();

  useEffect(() => {
    if (!client) {
      setState({ signedIn: false, weddingId: null });
      return;
    }
    client
      .auth.getUser()
      .then(async ({ data }) => {
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
      })
      .catch(() => {
        // Never leave the page on "Loading…" because a request threw.
        setState({ signedIn: true, weddingId: null });
        setNotice({ text: "Could not load your wedding. Please try again.", tone: "error" });
      });
  }, [client]);

  async function createWedding() {
    const response = await fetch("/api/accounts/wedding", { method: "POST" });
    const body = await readJson<{ weddingId?: string; error?: string }>(response);
    if (!response.ok) {
      setNotice({ text: body?.error ?? "Could not create a wedding.", tone: "error" });
      return;
    }
    setState((prev) => (prev ? { ...prev, weddingId: body?.weddingId ?? null } : prev));
    setNotice({ text: "Wedding created.", tone: "ok" });
  }

  async function invitePartner() {
    if (!state?.weddingId) return;
    const response = await fetch("/api/accounts/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    const body = await readJson<{ error?: string }>(response);
    if (!response.ok) {
      setNotice({ text: body?.error ?? "Could not send the invite.", tone: "error" });
      return;
    }
    setNotice({ text: `Invite sent to ${inviteEmail}.`, tone: "ok" });
    setInviteEmail("");
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
      setNotice({ text: body?.error ?? "Could not delete your account.", tone: "error" });
      return;
    }
    await client?.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12 sm:py-16">
      <p className="text-sm tracking-[0.14em] text-slate uppercase">Trousseau</p>
      <h1 className="mt-3 font-display text-3xl text-charcoal">Your account</h1>

      {!client ? (
        <p className="mt-6 text-slate">
          Accounts are not set up on this deployment. Everything still works without one.
        </p>
      ) : !state ? (
        <p className="mt-6 text-slate">Loading…</p>
      ) : !state.signedIn ? (
        <p className="mt-6 text-slate">Sign in to manage your wedding account.</p>
      ) : (
        <div className="mt-6 space-y-8">
          {notice && (
            <p
              className={`rounded border px-3 py-2 text-sm text-charcoal ${
                notice.tone === "ok" ? "border-sage/50 bg-sage/10" : "border-rose/40 bg-rose/10"
              }`}
            >
              {notice.text}
            </p>
          )}

          {!state.weddingId ? (
            <section className="space-y-3">
              <p className="text-sm text-slate">
                You haven&rsquo;t created a wedding yet — this is where you and your partner will share one.
              </p>
              <Button onClick={() => void createWedding()} tone="primary" icon={UserPlus}>
                Create your wedding
              </Button>
            </section>
          ) : (
            <section className="space-y-3 border-t border-charcoal/10 pt-6 first:border-t-0 first:pt-0">
              <h2 className="text-xs tracking-widest text-slate uppercase">Invite your partner</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void invitePartner();
                }}
                className="space-y-3"
              >
                <TextField
                  label="Their email"
                  type="email"
                  value={inviteEmail}
                  onChange={setInviteEmail}
                  placeholder="partner@example.com"
                />
                <Button onClick={() => void invitePartner()} tone="primary" icon={UserPlus} disabled={!inviteEmail}>
                  Send invite
                </Button>
              </form>
            </section>
          )}

          <section className="flex flex-wrap gap-2 border-t border-charcoal/10 pt-6">
            <Button onClick={() => void signOut()} icon={LogOut}>
              Sign out
            </Button>
            <Button onClick={() => void deleteAccount()} tone="danger" icon={Trash2}>
              Delete my account
            </Button>
          </section>
        </div>
      )}
    </main>
  );
}

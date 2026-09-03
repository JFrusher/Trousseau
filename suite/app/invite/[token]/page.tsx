"use client";

import { use, useEffect, useState } from "react";
import { browserClient } from "@/lib/accounts/browserClient";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [status, setStatus] = useState<"checking" | "signed-out" | "accepting" | "done" | "error">(
    "checking",
  );
  const [message, setMessage] = useState<string | null>(null);
  const client = browserClient();

  useEffect(() => {
    if (!client) {
      setStatus("error");
      setMessage("Accounts are not set up on this deployment.");
      return;
    }
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setStatus("signed-out");
        return;
      }
      setStatus("accepting");
      const response = await fetch(`/api/accounts/invite/${token}`, { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (response.ok) {
        setStatus("done");
      } else {
        setStatus("error");
        setMessage(body.error ?? "That invite could not be accepted.");
      }
    });
  }, [client, token]);

  if (status === "checking" || status === "accepting") return <p>One moment…</p>;
  if (status === "signed-out") {
    return <p>Sign in with the email this invite was sent to, then come back to this link.</p>;
  }
  if (status === "done") return <p>You're in — welcome to the wedding.</p>;
  return <p role="alert">{message}</p>;
}

import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { createInviteHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";
import { check, inviteEmailSchema } from "@/lib/accounts/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });
const unauthenticated = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });

export async function POST(request: Request) {
  if (!accountsConfigured()) return unconfigured();
  const user = await currentUser();
  if (!user) return unauthenticated();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That was not JSON." }, { status: 400 });
  }

  const input = check(inviteEmailSchema, body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const client = await serverClient();
  if (!client) return unconfigured();

  const store = accountsStore(client);
  const membership = await store.memberOf(user.id);
  if (!membership) {
    return NextResponse.json({ error: "You don't have a wedding yet." }, { status: 404 });
  }

  const reply = await createInviteHandler(store, membership.weddingId, user.id, input.value.email);
  if (reply.status !== 200) return NextResponse.json(reply.body, { status: reply.status });

  const { token } = reply.body as { token: string };
  const { error: sendError } = await client.auth.signInWithOtp({
    email: input.value.email,
    options: { emailRedirectTo: `${new URL(request.url).origin}/invite/${token}` },
  });
  if (sendError) {
    return NextResponse.json(
      { error: `The invite was created but the email failed to send: ${sendError.message}` },
      { status: 502 },
    );
  }

  return NextResponse.json(reply.body, { status: 200 });
}

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

/** See the note in `../wedding/route.ts`: an uncaught throw here becomes an HTML 500 the UI can't parse. */
const failed = (error: unknown) => {
  console.error("[accounts] POST /api/accounts/invite", error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
};

export async function POST(request: Request) {
  try {
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
    // Through `/auth/callback`, not straight to `/invite/[token]`: the magic
    // link carries a PKCE code that has to be exchanged for a session
    // server-side before any page can act as the invitee. `next` brings them
    // back to the invite once that's done.
    const origin = new URL(request.url).origin;
    const next = encodeURIComponent(`/invite/${token}`);
    const { error: sendError } = await client.auth.signInWithOtp({
      email: input.value.email,
      options: { emailRedirectTo: `${origin}/auth/callback?next=${next}` },
    });
    if (sendError) {
      return NextResponse.json(
        { error: `The invite was created but the email failed to send: ${sendError.message}` },
        { status: 502 },
      );
    }

    return NextResponse.json(reply.body, { status: 200 });
  } catch (error) {
    return failed(error);
  }
}

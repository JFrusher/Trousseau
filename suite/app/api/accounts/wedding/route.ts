import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { createWeddingHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

const unauthenticated = () =>
  NextResponse.json({ error: "Sign in first." }, { status: 401 });

/**
 * Anything thrown past the specific checks above is a genuine surprise — a
 * failed RPC, a database that isn't answering. Without this the exception
 * escapes into Next's default 500, whose body is HTML: the browser's
 * `response.json()` then rejects and the calling page hangs on its loading
 * state forever.
 */
const failed = (where: string, error: unknown) => {
  console.error(`[accounts] ${where}`, error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
};

/** The caller's current wedding, so a returning member's page can pick up where they left off. */
export async function GET() {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    const client = await serverClient();
    if (!client) return unconfigured();

    const membership = await accountsStore(client).memberOf(user.id);
    return NextResponse.json({ weddingId: membership?.weddingId ?? null });
  } catch (error) {
    return failed("GET /api/accounts/wedding", error);
  }
}

export async function POST() {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    const client = await serverClient();
    if (!client) return unconfigured();

    const reply = await createWeddingHandler(accountsStore(client), user.id);
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return failed("POST /api/accounts/wedding", error);
  }
}

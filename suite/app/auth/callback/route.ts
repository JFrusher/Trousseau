import { NextResponse } from "next/server";
import { serverClient } from "@/lib/accounts/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where every magic link lands — sign-in and partner invites alike.
 *
 * Supabase's link carries a PKCE `code`, not a session: it has to be exchanged
 * here, server-side, so the session cookies are set on the response before any
 * page renders. `next` is where to go once that's done (the invite page, for
 * an invite), so pages downstream can assume a session already exists.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  if (code) {
    try {
      const client = await serverClient();
      // A failed exchange is not worth an error page: the destination itself
      // will show "sign in first", which is the true state of things.
      if (client) await client.auth.exchangeCodeForSession(code);
    } catch (error) {
      console.error("[accounts] GET /auth/callback", error);
    }
  }

  // Only same-site paths: `next` arrives in a URL, so an absolute one would
  // turn this into an open redirect that borrows the sign-in link's trust.
  const destination = next && /^\/(?!\/)/.test(next) ? next : "/account";
  return NextResponse.redirect(new URL(destination, url.origin));
}

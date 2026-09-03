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
/**
 * A same-site path, or `/account` if `next` isn't one.
 *
 * Parse first, then compare the resolved origin — not a prefix check on the
 * raw string. A prefix regex like `/^\/(?!\/)/` looks like it blocks
 * `//evil.com` but not `/\evil.com`: `new URL()` normalises a backslash to a
 * forward slash for http/https before parsing, so that string resolves to
 * `https://evil.com/` regardless of what the raw text started with. Letting
 * the URL parser do the normalising, then checking *its* output, is the only
 * way `next` can't be turned into an open redirect through a variant a regex
 * didn't anticipate.
 */
export function sameOriginPath(next: string | null, origin: string): string {
  if (!next) return "/account";
  try {
    const resolved = new URL(next, origin);
    return resolved.origin === origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : "/account";
  } catch {
    return "/account";
  }
}

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

  const destination = sameOriginPath(next, url.origin);
  return NextResponse.redirect(new URL(destination, url.origin));
}

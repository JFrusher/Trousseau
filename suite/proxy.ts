import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Finish a sign-in wherever its link happens to land.
 *
 * `/auth/callback` is where the app asks Supabase to send people, and when the
 * project's redirect allowlist agrees, that is where they go. When it does not,
 * Supabase quietly falls back to the project's Site URL — so the link arrives
 * at `/?code=…`, nothing there exchanges it, and the user is returned to a page
 * telling them to sign in, having just done so. That happened on a real
 * deployment.
 *
 * Depending on a dashboard setting being right is not worth a broken sign-in,
 * so the exchange happens here instead: any path, any of the shapes a link can
 * take. The callback route stays, because it is still the correct destination
 * and is the only one that knows where an invite should go next.
 */

const CLEAN = ["code", "token_hash", "type"];

export async function proxy(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");

  // The overwhelmingly common case: no auth material, nothing to do.
  if (!code && !tokenHash) return NextResponse.next();
  // The callback route does its own exchange, and knows about `next`.
  if (request.nextUrl.pathname === "/auth/callback") return NextResponse.next();

  const destination = new URL(request.nextUrl);
  for (const key of CLEAN) destination.searchParams.delete(key);

  const response = NextResponse.redirect(destination);

  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  // No accounts on this deployment. Strip the parameters and move on rather
  // than leaving a code sitting in the address bar.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  try {
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" })
      : await supabase.auth.exchangeCodeForSession(code as string);
    if (error) {
      // Say so rather than dropping them on a page that just asks them to sign
      // in again. The session cookies already set on `response` stay set.
      destination.searchParams.set("signin", "failed");
      response.headers.set("location", destination.toString());
    }
  } catch (error) {
    console.error("[accounts] proxy sign-in", error);
    destination.searchParams.set("signin", "failed");
    response.headers.set("location", destination.toString());
  }

  return response;
}

export const config = {
  // Everything a person can land on. Static assets and image optimisation can
  // never carry a sign-in link, and running on them would cost every request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

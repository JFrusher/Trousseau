import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { accountsConfigured, env } from "@/lib/env";

/**
 * A Supabase client carrying the calling request's own session, for use in
 * Route Handlers and Server Components. Returns null when accounts aren't
 * configured on this deployment — every caller must handle that the same way
 * `lib/sync`'s routes handle an unconfigured backend: the feature is simply
 * unavailable, not an error.
 */
export async function serverClient(): Promise<SupabaseClient | null> {
  if (!accountsConfigured()) return null;
  const { SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = env();
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL as string, NEXT_PUBLIC_SUPABASE_ANON_KEY as string, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

/** The signed-in user for this request, or null if there isn't one. */
export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const client = await serverClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}

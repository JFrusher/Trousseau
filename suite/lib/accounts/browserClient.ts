"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * The client-side Supabase client, for calling `signInWithOtp` directly from
 * the browser. `undefined` means "not checked yet"; `null` means "checked,
 * and this deployment has no accounts configured" — kept apart from
 * `serverClient()`'s null check because `env()` (server-only: reads
 * `process.env` directly) cannot run in browser code, so the public env vars
 * are read from `process.env.NEXT_PUBLIC_*` here instead, inlined by Next.js
 * at build time.
 */
export function browserClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createBrowserClient(url, key) : null;
  return client;
}

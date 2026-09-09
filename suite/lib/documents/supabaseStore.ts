import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { DocumentRecord, DocumentStore, SaveResult } from "./store";

/**
 * How many abandoned weddings one sweep will remove.
 *
 * Bounded so a first run against a long-neglected database cannot time out the
 * function that calls it; the sweep runs daily and catches up.
 */
const SWEEP_BATCH = 100;

/**
 * The Postgres implementation, over a caller-scoped client — same reasoning
 * as `lib/accounts/supabaseStore.ts`: RLS and save_wedding_document() both
 * need to see the real caller via `auth.uid()`, from this client's own
 * session, not a service-role client shared across every request.
 */
export function documentStore(client: SupabaseClient): DocumentStore {
  return {
    async getDocument(weddingId) {
      const { data, error } = await client
        .from("wedding_documents")
        .select("wedding_id, document, version, updated_at")
        .eq("wedding_id", weddingId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        weddingId: data.wedding_id as string,
        document: data.document,
        version: data.version as number,
        updatedAt: data.updated_at as string,
      };
    },

    async saveDocument(weddingId, document, expectedVersion): Promise<SaveResult> {
      const { data, error } = await client
        .rpc("save_wedding_document", {
          p_wedding_id: weddingId,
          p_document: document,
          p_expected_version: expectedVersion,
        })
        .single();
      if (error) throw new Error(error.message);
      const row = data as { accepted: boolean; version: number; document: unknown; updated_at: string | null };
      const record: DocumentRecord = {
        weddingId,
        document: row.document,
        version: row.version,
        updatedAt: row.updated_at ?? new Date(0).toISOString(),
      };
      return { accepted: row.accepted, record };
    },

    async staleWeddings(before) {
      const { data, error } = await client
        .from("wedding_documents")
        .select("wedding_id")
        .lt("updated_at", before)
        .order("updated_at", { ascending: true })
        .limit(SWEEP_BATCH);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.wedding_id as string);
    },

    async deleteWedding(weddingId) {
      // Deletes account_weddings, not just wedding_documents: wedding_documents
      // and wedding_document_history both cascade from account_weddings (`on
      // delete cascade`, supabase/migrations/20260903000001_wedding_documents.sql),
      // and wedding_members does too (20260902000001_accounts.sql) — this is
      // what actually retires the whole wedding, not just its document.
      const { error } = await client.from("account_weddings").delete().eq("id", weddingId);
      if (error) throw new Error(error.message);
    },
  };
}

let adminClient: SupabaseClient | null = null;

/**
 * A service-role client, for the retention sweep only.
 *
 * `documentStore(client)` is generic over any `SupabaseClient` — the normal
 * app routes pass it a caller-scoped client so RLS applies, but the sweep has
 * to see every wedding, not just one account's, so it gets this one instead.
 * Same 5-second fetch timeout as lib/sync/supabaseStore.ts's equivalent, and
 * for the same reason: a paused Supabase project must fail fast, not hang.
 */
export function adminDocumentsClient(): SupabaseClient | null {
  if (adminClient) return adminClient;
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = env();
  if (!url || !key) return null;
  adminClient = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    },
  });
  return adminClient;
}

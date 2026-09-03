import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentRecord, DocumentStore, SaveResult } from "./store";

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
  };
}

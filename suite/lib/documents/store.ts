/**
 * Where a wedding's cloud document lives, behind an interface — the same
 * `lib/sync/store.ts` / `lib/accounts/store.ts` pattern: one real
 * implementation (Postgres, via save_wedding_document()) and one in-memory
 * fake, so the CAS and validation rules in handlers.ts can be tested without
 * a database.
 */

export interface DocumentRecord {
  weddingId: string;
  document: unknown;
  version: number;
  updatedAt: string;
}

export interface SaveResult {
  accepted: boolean;
  record: DocumentRecord;
}

export interface DocumentStore {
  /** Null if the wedding has never had a document saved for it. */
  getDocument(weddingId: string): Promise<DocumentRecord | null>;
  /**
   * Compare-and-set write. Always returns the true current record either
   * way — accepted or not — so a rejected write can show what it lost to.
   */
  saveDocument(weddingId: string, document: unknown, expectedVersion: number): Promise<SaveResult>;
  /**
   * Weddings stale as of `before`, oldest first: either a document last saved
   * before that time, or (the Supabase-backed implementation only) a wedding
   * old enough to count but that has never had a document saved at all.
   */
  staleWeddings(before: string): Promise<string[]>;
  /**
   * Delete a wedding outright, not just its document — used only by the
   * retention sweep. The Supabase-backed implementation deletes the whole
   * `account_weddings` row, cascading to its document, history, members, and
   * invites.
   */
  deleteWedding(weddingId: string): Promise<void>;
}

export function memoryStore(): DocumentStore {
  const documents = new Map<string, DocumentRecord>();

  return {
    async getDocument(weddingId) {
      return documents.get(weddingId) ?? null;
    },

    async saveDocument(weddingId, document, expectedVersion) {
      const current = documents.get(weddingId);
      const currentVersion = current?.version ?? 0;

      if (currentVersion !== expectedVersion) {
        return {
          accepted: false,
          record: current ?? { weddingId, document: null, version: 0, updatedAt: new Date(0).toISOString() },
        };
      }

      const record: DocumentRecord = {
        weddingId,
        document,
        version: currentVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      documents.set(weddingId, record);
      return { accepted: true, record };
    },

    async staleWeddings(before) {
      return [...documents.values()]
        .filter((record) => record.updatedAt < before)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .map((record) => record.weddingId);
    },

    async deleteWedding(weddingId) {
      documents.delete(weddingId);
    },
  };
}

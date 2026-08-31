import type { Sealed } from "./crypto";

/**
 * Where the ciphertext lives, behind an interface.
 *
 * Two implementations: Supabase in production, an in-memory map for the tests.
 * The route handlers only ever see this, so the authorisation and conflict
 * logic can be tested without a database — which is what makes it possible to
 * test them at all.
 */

export interface SliceRecord extends Sealed {
  slice: string;
  /** Bumped on every accepted write. The client sends what it expects. */
  version: number;
  updatedAt: string;
}

export interface WeddingRecord {
  id: string;
  /** Public. Served to anyone who asks, so a client can derive keys to try. */
  salt: string;
  /** SHA-256 of the write token. Never the token itself. */
  authHash: string;
  createdAt: string;
}

export interface ShareRecord extends Sealed {
  token: string;
  createdAt: string;
  /** Republishing a share replaces it, so a stale plan cannot linger. */
  updatedAt: string;
}

export interface BlobRecord extends Sealed {
  blobId: string;
  createdAt: string;
}

export interface SyncStore {
  createWedding: (record: WeddingRecord) => Promise<void>;
  getWedding: (id: string) => Promise<WeddingRecord | null>;
  listSlices: (id: string) => Promise<SliceRecord[]>;
  /**
   * Write one slice if `expectedVersion` still matches. Returns the stored
   * record either way, so a rejected write can hand the caller what it lost to.
   */
  putSlice: (
    id: string,
    slice: string,
    sealed: Sealed,
    expectedVersion: number,
  ) => Promise<{ accepted: boolean; record: SliceRecord }>;
  listBlobs: (id: string) => Promise<string[]>;
  putBlob: (id: string, record: BlobRecord) => Promise<void>;
  getBlob: (id: string, blobId: string) => Promise<BlobRecord | null>;
  putShare: (record: ShareRecord) => Promise<void>;
  getShare: (token: string) => Promise<ShareRecord | null>;
  deleteShare: (token: string) => Promise<void>;
}

/** For tests, and for running the whole thing with no database at all. */
export function memoryStore(): SyncStore {
  const weddings = new Map<string, WeddingRecord>();
  const slices = new Map<string, Map<string, SliceRecord>>();
  const shares = new Map<string, ShareRecord>();
  const blobs = new Map<string, Map<string, BlobRecord>>();

  return {
    createWedding: async (record) => {
      weddings.set(record.id, record);
      slices.set(record.id, new Map());
    },
    getWedding: async (id) => weddings.get(id) ?? null,
    listSlices: async (id) => [...(slices.get(id)?.values() ?? [])],
    putSlice: async (id, slice, sealed, expectedVersion) => {
      const group = slices.get(id) ?? new Map<string, SliceRecord>();
      slices.set(id, group);
      const current = group.get(slice);
      const version = current?.version ?? 0;

      // Absent is version 0. A caller expecting anything else is out of step
      // with this wedding, and creating a row under it would hide that — the
      // SQL takes the same position.
      if (version !== expectedVersion) {
        return {
          accepted: false,
          record: current ?? {
            slice,
            ciphertext: "",
            iv: "",
            version,
            updatedAt: new Date(0).toISOString(),
          },
        };
      }

      const record: SliceRecord = {
        slice,
        ...sealed,
        version: version + 1,
        updatedAt: new Date().toISOString(),
      };
      group.set(slice, record);
      return { accepted: true, record };
    },
    listBlobs: async (id) => [...(blobs.get(id)?.keys() ?? [])],
    putBlob: async (id, record) => {
      const group = blobs.get(id) ?? new Map<string, BlobRecord>();
      blobs.set(id, group);
      group.set(record.blobId, record);
    },
    getBlob: async (id, blobId) => blobs.get(id)?.get(blobId) ?? null,
    putShare: async (record) => void shares.set(record.token, record),
    getShare: async (token) => shares.get(token) ?? null,
    deleteShare: async (token) => void shares.delete(token),
  };
}

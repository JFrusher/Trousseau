import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Sealed } from "./crypto";
import type { BlobRecord, ShareRecord, SliceRecord, SyncStore, WeddingRecord } from "./store";

/**
 * The Supabase implementation.
 *
 * Reached only from route handlers, with the service role key, which never
 * leaves the server. Authorisation is the write-token hash checked in the
 * handler rather than row-level security: the rows hold ciphertext nobody can
 * read, and the one thing that must be enforced — "does this writer know the
 * passphrase" — is not a question a database policy can answer.
 *
 * Returns null when it is not configured, so the app runs perfectly well with
 * no backend at all. Sharing is the only thing that needs one.
 */

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  if (client) return client;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function isConfigured(): boolean {
  return supabase() !== null;
}

export function supabaseStore(): SyncStore | null {
  const db = supabase();
  if (!db) return null;

  return {
    createWedding: async (record) => {
      const { error } = await db.from("weddings").insert({
        id: record.id,
        salt: record.salt,
        auth_hash: record.authHash,
        created_at: record.createdAt,
      });
      if (error) throw new Error(error.message);
    },

    getWedding: async (id) => {
      const { data, error } = await db
        .from("weddings")
        .select("id, salt, auth_hash, created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        salt: data.salt as string,
        authHash: data.auth_hash as string,
        createdAt: data.created_at as string,
      };
    },

    listSlices: async (id) => {
      const { data, error } = await db
        .from("slices")
        .select("slice, ciphertext, iv, version, updated_at")
        .eq("wedding_id", id);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        slice: row.slice as string,
        ciphertext: row.ciphertext as string,
        iv: row.iv as string,
        version: row.version as number,
        updatedAt: row.updated_at as string,
      }));
    },

    putSlice: async (id, slice, sealed, expectedVersion) => {
      // One statement, so the check and the write cannot be separated by
      // another writer. The function is defined in the migration beside this.
      const { data, error } = await db.rpc("put_slice", {
        p_wedding: id,
        p_slice: slice,
        p_ciphertext: sealed.ciphertext,
        p_iv: sealed.iv,
        p_expected: expectedVersion,
      });
      if (error) throw new Error(error.message);

      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      if (!row) throw new Error("The write was neither accepted nor refused.");

      return {
        accepted: row["accepted"] === true,
        record: {
          slice,
          ciphertext: (row["ciphertext"] as string) ?? "",
          iv: (row["iv"] as string) ?? "",
          version: (row["version"] as number) ?? 0,
          updatedAt: (row["updated_at"] as string) ?? new Date(0).toISOString(),
        },
      };
    },

    listBlobs: async (id) => {
      const { data, error } = await db.from("blobs").select("blob_id").eq("wedding_id", id);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.blob_id as string);
    },

    putBlob: async (id, record) => {
      const { error } = await db.from("blobs").upsert({
        wedding_id: id,
        blob_id: record.blobId,
        ciphertext: record.ciphertext,
        iv: record.iv,
        created_at: record.createdAt,
      });
      if (error) throw new Error(error.message);
    },

    getBlob: async (id, blobId) => {
      const { data, error } = await db
        .from("blobs")
        .select("blob_id, ciphertext, iv, created_at")
        .eq("wedding_id", id)
        .eq("blob_id", blobId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        blobId: data.blob_id as string,
        ciphertext: data.ciphertext as string,
        iv: data.iv as string,
        createdAt: data.created_at as string,
      };
    },

    putShare: async (record) => {
      const { error } = await db.from("shares").upsert({
        token: record.token,
        ciphertext: record.ciphertext,
        iv: record.iv,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });
      if (error) throw new Error(error.message);
    },

    getShare: async (token) => {
      const { data, error } = await db
        .from("shares")
        .select("token, ciphertext, iv, created_at, updated_at")
        .eq("token", token)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        token: data.token as string,
        ciphertext: data.ciphertext as string,
        iv: data.iv as string,
        createdAt: data.created_at as string,
        updatedAt: data.updated_at as string,
      };
    },

    deleteShare: async (token) => {
      const { error } = await db.from("shares").delete().eq("token", token);
      if (error) throw new Error(error.message);
    },
  };
}

export type { Sealed, BlobRecord, ShareRecord, SliceRecord, SyncStore, WeddingRecord };

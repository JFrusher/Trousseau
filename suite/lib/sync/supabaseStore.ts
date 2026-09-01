import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
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

/**
 * How many abandoned weddings one sweep will remove.
 *
 * Bounded so a first run against a long-neglected database cannot time out the
 * function that calls it; the sweep runs daily and catches up.
 */
const SWEEP_BATCH = 100;

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  if (client) return client;
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = env();
  // Both or neither — the schema has already refused the half-configured case.
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: false },
    // Fail fast rather than hang. A paused or unreachable Supabase project does
    // not refuse a connection, it simply never answers, and the client retries
    // underneath — one create took 7.9 seconds in production before giving up,
    // which the person waiting experiences as the application being broken
    // rather than the backend being asleep. Five seconds is far longer than a
    // healthy round trip and far shorter than a serverless timeout.
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  });
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
        updated_at: record.updatedAt,
      });
      if (error) throw new Error(error.message);
    },

    getWedding: async (id) => {
      const { data, error } = await db
        .from("weddings")
        .select("id, salt, auth_hash, created_at, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        salt: data.salt as string,
        authHash: data.auth_hash as string,
        createdAt: data.created_at as string,
        updatedAt: (data.updated_at as string) ?? (data.created_at as string),
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

    blobBytes: async (id) => {
      // The recorded length, not the ciphertext: asking for the bytes must not
      // mean sending every asset the wedding holds across the wire.
      const { data, error } = await db.from("blobs").select("bytes").eq("wedding_id", id);
      if (error) throw new Error(error.message);
      return (data ?? []).reduce((total, row) => total + ((row.bytes as number) ?? 0), 0);
    },

    putBlob: async (id, record) => {
      const { error } = await db.from("blobs").upsert({
        wedding_id: id,
        blob_id: record.blobId,
        ciphertext: record.ciphertext,
        iv: record.iv,
        bytes: record.ciphertext.length,
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
        wedding_id: record.weddingId,
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
        .select("token, wedding_id, ciphertext, iv, created_at, updated_at")
        .eq("token", token)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        token: data.token as string,
        weddingId: data.wedding_id as string,
        ciphertext: data.ciphertext as string,
        iv: data.iv as string,
        createdAt: data.created_at as string,
        updatedAt: data.updated_at as string,
      };
    },

    deleteShare: async (weddingId, token) => {
      // Scoped to the wedding: the caller has been authorised against that
      // wedding, not against whichever one happens to own this token.
      const { error } = await db
        .from("shares")
        .delete()
        .eq("token", token)
        .eq("wedding_id", weddingId);
      if (error) throw new Error(error.message);
    },

    staleWeddings: async (before) => {
      // `put_slice` keeps `updated_at` current, in the same transaction as the
      // write it records.
      const { data, error } = await db
        .from("weddings")
        .select("id")
        .lt("updated_at", before)
        .order("updated_at", { ascending: true })
        .limit(SWEEP_BATCH);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.id as string);
    },

    deleteWedding: async (id) => {
      // Slices, blobs and shares all reference this row `on delete cascade`,
      // so this one statement is the whole deletion.
      const { error } = await db.from("weddings").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}

export type { Sealed, BlobRecord, ShareRecord, SliceRecord, SyncStore, WeddingRecord };

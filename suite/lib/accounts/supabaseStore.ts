import type { SupabaseClient } from "@supabase/supabase-js";
import type { AcceptResult, AccountsStore, InviteRecord, MemberRecord, WeddingRecord } from "./store";

/**
 * The Postgres implementation, over a caller-scoped client.
 *
 * Unlike `lib/sync/supabaseStore.ts`, which uses one service-role client for
 * every caller (authorization there is a token hash checked by hand), this
 * takes a *different* client per call — one carrying the signed-in user's own
 * session — so Postgres RLS and the `security definer` functions in the
 * accounts migration see the real caller via `auth.uid()`.
 */
export function accountsStore(client: SupabaseClient): AccountsStore {
  return {
    async createWedding(_userId) {
      // `_userId` is unused here deliberately: `create_wedding()` reads
      // `auth.uid()` from the client's own session, not an argument, so a
      // caller can never create a wedding "as" someone else by passing a
      // different id — the parameter exists only to satisfy the shared
      // `AccountsStore` interface the in-memory fake also implements.
      const { data, error } = await client.rpc("create_wedding");
      if (error) throw new Error(error.message);
      return { id: data as string, createdAt: new Date().toISOString() };
    },

    async memberOf(userId) {
      const { data, error } = await client
        .from("wedding_members")
        .select("user_id, wedding_id, joined_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return { userId: data.user_id as string, weddingId: data.wedding_id as string, joinedAt: data.joined_at as string };
    },

    async membersOf(weddingId) {
      const { data, error } = await client
        .from("wedding_members")
        .select("user_id, wedding_id, joined_at")
        .eq("wedding_id", weddingId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        userId: row.user_id as string,
        weddingId: row.wedding_id as string,
        joinedAt: row.joined_at as string,
      }));
    },

    async createInvite(weddingId, _byUserId, invitedEmail) {
      const { data, error } = await client
        .rpc("create_invite", { p_wedding_id: weddingId, p_invited_email: invitedEmail })
        .single();
      if (error) throw new Error(error.message);
      const row = data as { id: string; token: string; expires_at: string };
      return {
        id: row.id,
        weddingId,
        invitedEmail: invitedEmail.toLowerCase(),
        token: row.token,
        createdBy: _byUserId,
        createdAt: new Date().toISOString(),
        expiresAt: row.expires_at,
        acceptedAt: null,
      };
    },

    async getInvite(token) {
      const { data, error } = await client
        .from("invites")
        .select("id, wedding_id, invited_email, token, created_by, created_at, expires_at, accepted_at")
        .eq("token", token)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        weddingId: data.wedding_id as string,
        invitedEmail: data.invited_email as string,
        token: data.token as string,
        createdBy: data.created_by as string,
        createdAt: data.created_at as string,
        expiresAt: data.expires_at as string,
        acceptedAt: data.accepted_at as string | null,
      };
    },

    async acceptInvite(token, _userId) {
      // `_userId` is unused deliberately, same reasoning as `createWedding`
      // above: `accept_invite()` reads the real caller from `auth.uid()`
      // inside the security-definer function, from this client's own
      // session — not from an argument a caller could spoof.
      const { data, error } = await client.rpc("accept_invite", { p_token: token }).single();
      if (error) throw new Error(error.message);
      const row = data as { accepted: boolean; reason: string | null; wedding_id: string | null };
      return {
        accepted: row.accepted,
        reason: row.reason as AcceptResult["reason"],
        weddingId: row.wedding_id,
      };
    },

    async deleteAccount(_userId) {
      const { error } = await client.rpc("delete_my_account");
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Where account/wedding membership lives, behind an interface — exactly the
 * `lib/sync/store.ts` pattern: one real implementation (Postgres, via the SQL
 * functions in the accounts migration) and one in-memory fake, so the rules in
 * `handlers.ts` can be tested without a database.
 */

export interface WeddingRecord {
  id: string;
  createdAt: string;
}

export interface MemberRecord {
  userId: string;
  weddingId: string;
  joinedAt: string;
}

export interface InviteRecord {
  id: string;
  weddingId: string;
  invitedEmail: string;
  token: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export type AcceptReason = "wrong-email" | "expired" | "already-accepted" | "wedding-full";

export interface AcceptResult {
  accepted: boolean;
  reason: AcceptReason | null;
  weddingId: string | null;
}

export interface AccountsStore {
  /** Throws if the caller already has a wedding. */
  createWedding(userId: string): Promise<WeddingRecord>;
  memberOf(userId: string): Promise<MemberRecord | null>;
  membersOf(weddingId: string): Promise<MemberRecord[]>;
  /** Throws if the caller is not a member of the wedding, or it already has two members. */
  createInvite(weddingId: string, byUserId: string, invitedEmail: string): Promise<InviteRecord>;
  getInvite(token: string): Promise<InviteRecord | null>;
  /**
   * `userId` is redundant with the real store's session-derived `auth.uid()`,
   * kept as an explicit parameter here because the in-memory fake has no
   * session to read it from — every caller (handlers.ts, supabaseStore.ts)
   * always has the acting user's id in hand already, so passing it costs
   * nothing.
   */
  acceptInvite(token: string, userId: string): Promise<AcceptResult>;
  deleteAccount(userId: string): Promise<void>;
}

export function memoryStore(): AccountsStore {
  const weddings = new Map<string, WeddingRecord>();
  const members = new Map<string, MemberRecord>(); // keyed by userId
  const invites = new Map<string, InviteRecord>(); // keyed by token
  const emails = new Map<string, string>(); // userId -> email, seeded by tests

  const now = () => new Date().toISOString();

  return {
    async createWedding(userId) {
      if (members.has(userId)) throw new Error("already has a wedding");
      const wedding: WeddingRecord = { id: crypto.randomUUID(), createdAt: now() };
      weddings.set(wedding.id, wedding);
      members.set(userId, { userId, weddingId: wedding.id, joinedAt: now() });
      return wedding;
    },

    async memberOf(userId) {
      return members.get(userId) ?? null;
    },

    async membersOf(weddingId) {
      return [...members.values()].filter((m) => m.weddingId === weddingId);
    },

    async createInvite(weddingId, byUserId, invitedEmail) {
      const isMember = [...members.values()].some(
        (m) => m.weddingId === weddingId && m.userId === byUserId,
      );
      if (!isMember) throw new Error("not a member of that wedding");
      const memberCount = [...members.values()].filter((m) => m.weddingId === weddingId).length;
      if (memberCount >= 2) throw new Error("wedding already has two members");

      const invite: InviteRecord = {
        id: crypto.randomUUID(),
        weddingId,
        invitedEmail: invitedEmail.toLowerCase(),
        token: crypto.randomUUID().replace(/-/g, ""),
        createdBy: byUserId,
        createdAt: now(),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        acceptedAt: null,
      };
      invites.set(invite.token, invite);
      return invite;
    },

    async getInvite(token) {
      return invites.get(token) ?? null;
    },

    async acceptInvite(token, userId) {
      const invite = invites.get(token);
      if (!invite) return { accepted: false, reason: "wedding-full", weddingId: null }; // unreachable in practice; getInvite is checked by the caller first
      if (invite.acceptedAt) return { accepted: false, reason: "already-accepted", weddingId: invite.weddingId };
      if (new Date(invite.expiresAt).getTime() < Date.now()) {
        return { accepted: false, reason: "expired", weddingId: invite.weddingId };
      }
      const callerEmail = (emails.get(userId) ?? "").toLowerCase();
      if (callerEmail !== invite.invitedEmail) {
        return { accepted: false, reason: "wrong-email", weddingId: invite.weddingId };
      }
      const memberCount = [...members.values()].filter((m) => m.weddingId === invite.weddingId).length;
      if (memberCount >= 2) return { accepted: false, reason: "wedding-full", weddingId: invite.weddingId };

      members.set(userId, { userId, weddingId: invite.weddingId, joinedAt: now() });
      invite.acceptedAt = now();
      return { accepted: true, reason: null, weddingId: invite.weddingId };
    },

    async deleteAccount(userId) {
      const member = members.get(userId);
      if (!member) return;
      members.delete(userId);
      const remaining = [...members.values()].some((m) => m.weddingId === member.weddingId);
      if (!remaining) weddings.delete(member.weddingId);
    },

    // test-only seam, not part of the interface real Postgres implements —
    // Task 5's tests call this directly on the object memoryStore() returns.
    _seedEmail(userId: string, email: string) {
      emails.set(userId, email);
    },
  } as AccountsStore & { _seedEmail(userId: string, email: string): void };
}

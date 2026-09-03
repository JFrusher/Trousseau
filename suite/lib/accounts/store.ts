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

export type AcceptReason =
  | "not-found"
  | "wrong-email"
  | "expired"
  | "already-accepted"
  | "wedding-full"
  | "already-in-a-wedding";

export interface AcceptResult {
  accepted: boolean;
  reason: AcceptReason | null;
  weddingId: string | null;
  /**
   * The address the invite was sent to, so "this was sent to X" can be shown
   * on a wrong-email rejection. It comes back from the accept itself because
   * the invitee cannot read the `invites` row directly — RLS only lets the
   * person who *created* an invite select it.
   */
  invitedEmail: string | null;
}

export interface AccountsStore {
  /** Throws if the caller already has a wedding. */
  createWedding(userId: string): Promise<WeddingRecord>;
  memberOf(userId: string): Promise<MemberRecord | null>;
  membersOf(weddingId: string): Promise<MemberRecord[]>;
  /** Throws if the caller is not a member of the wedding, or it already has two members. */
  createInvite(weddingId: string, byUserId: string, invitedEmail: string): Promise<InviteRecord>;
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

    async acceptInvite(token, userId) {
      const invite = invites.get(token);
      if (!invite) return { accepted: false, reason: "not-found", weddingId: null, invitedEmail: null };
      const no = (reason: AcceptReason): AcceptResult => ({
        accepted: false,
        reason,
        weddingId: invite.weddingId,
        invitedEmail: invite.invitedEmail,
      });

      if (invite.acceptedAt) return no("already-accepted");
      if (new Date(invite.expiresAt).getTime() < Date.now()) return no("expired");
      const callerEmail = (emails.get(userId) ?? "").toLowerCase();
      if (callerEmail !== invite.invitedEmail) return no("wrong-email");
      const memberCount = [...members.values()].filter((m) => m.weddingId === invite.weddingId).length;
      if (memberCount >= 2) return no("wedding-full");
      if (members.has(userId)) return no("already-in-a-wedding");

      members.set(userId, { userId, weddingId: invite.weddingId, joinedAt: now() });
      invite.acceptedAt = now();
      return { accepted: true, reason: null, weddingId: invite.weddingId, invitedEmail: invite.invitedEmail };
    },

    async deleteAccount(userId) {
      const member = members.get(userId);
      if (!member) return;
      members.delete(userId);
      const remaining = [...members.values()].some((m) => m.weddingId === member.weddingId);
      if (!remaining) weddings.delete(member.weddingId);
    },

    // test-only seams, not part of the interface real Postgres implements —
    // the handler tests call these directly on the object memoryStore()
    // returns. (`_expire` stands in for waiting fourteen days; Postgres has
    // its own `expires_at` column to update instead.)
    _seedEmail(userId: string, email: string) {
      emails.set(userId, email);
    },
    _expire(token: string) {
      const invite = invites.get(token);
      if (invite) invite.expiresAt = new Date(0).toISOString();
    },
  } as AccountsStore & { _seedEmail(userId: string, email: string): void; _expire(token: string): void };
}

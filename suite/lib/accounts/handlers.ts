import type { AccountsStore } from "./store";

export interface Reply {
  status: number;
  body: unknown;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const conflict = (message: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 409,
  body: { error: message, ...extra },
});
const forbidden = (message: string): Reply => ({ status: 403, body: { error: message } });
const notFound = (message: string): Reply => ({ status: 404, body: { error: message } });

export async function createWeddingHandler(store: AccountsStore, userId: string): Promise<Reply> {
  const existing = await store.memberOf(userId);
  if (existing) return conflict("You already have a wedding.");
  const wedding = await store.createWedding(userId);
  return ok({ weddingId: wedding.id });
}

export async function createInviteHandler(
  store: AccountsStore,
  weddingId: string,
  byUserId: string,
  invitedEmail: string,
): Promise<Reply> {
  const members = await store.membersOf(weddingId);
  if (!members.some((m) => m.userId === byUserId)) {
    return forbidden("You are not a member of that wedding.");
  }
  if (members.length >= 2) {
    return conflict("This wedding already has two members.");
  }
  const invite = await store.createInvite(weddingId, byUserId, invitedEmail);
  return ok({ token: invite.token, expiresAt: invite.expiresAt });
}

export async function acceptInviteHandler(
  store: AccountsStore,
  token: string,
  userId: string,
): Promise<Reply> {
  // No lookup before the accept: the invitee can't read their own invite row
  // (RLS shows `invites` only to whoever created them), so `acceptInvite`
  // answers "no such token" itself, as one more rejection reason.
  const result = await store.acceptInvite(token, userId);
  if (result.accepted) return ok({ weddingId: result.weddingId });
  if (result.reason === "not-found") return notFound("That invite does not exist.");

  const messages: Record<string, string> = {
    "wrong-email": `This invite was sent to ${result.invitedEmail}. Sign in with that address to accept it.`,
    expired: "That invite has expired. Ask your partner to send a new one.",
    "already-accepted": "That invite was already used.",
    "wedding-full": "That wedding already has two members.",
    "already-in-a-wedding":
      "You already have a wedding of your own — leave it first if you want to join this one.",
  };
  return conflict(messages[result.reason ?? ""] ?? "That invite could not be accepted.", {
    reason: result.reason,
  });
}

export async function deleteAccountHandler(store: AccountsStore, userId: string): Promise<Reply> {
  await store.deleteAccount(userId);
  return ok({});
}

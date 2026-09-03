import { describe, expect, it } from "vitest";
import {
  acceptInviteHandler,
  createInviteHandler,
  createWeddingHandler,
  deleteAccountHandler,
} from "./handlers";
import { memoryStore } from "./store";

function seededStore() {
  const store = memoryStore() as ReturnType<typeof memoryStore> & {
    _seedEmail(userId: string, email: string): void;
  };
  return store;
}

describe("createWeddingHandler", () => {
  it("creates a wedding and returns its id", async () => {
    const store = seededStore();
    const reply = await createWeddingHandler(store, "alice");
    expect(reply.status).toBe(200);
    expect((reply.body as { weddingId: string }).weddingId).toBeTruthy();
  });

  it("refuses a second wedding for the same user", async () => {
    const store = seededStore();
    await createWeddingHandler(store, "alice");
    const reply = await createWeddingHandler(store, "alice");
    expect(reply.status).toBe(409);
  });
});

describe("createInviteHandler", () => {
  it("creates an invite for a member of the wedding", async () => {
    const store = seededStore();
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;

    const reply = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    expect(reply.status).toBe(200);
    expect((reply.body as { token: string }).token).toBeTruthy();
  });

  it("refuses someone who is not a member of the wedding", async () => {
    const store = seededStore();
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;

    const reply = await createInviteHandler(store, weddingId, "mallory", "bob@example.com");
    expect(reply.status).toBe(403);
  });

  it("refuses a third invite once the wedding already has two members", async () => {
    const store = seededStore();
    store._seedEmail("bob", "bob@example.com");
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;
    const invite = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    const token = (invite.body as { token: string }).token;
    await acceptInviteHandler(store, token, "bob");

    const reply = await createInviteHandler(store, weddingId, "alice", "carol@example.com");
    expect(reply.status).toBe(409);
  });
});

describe("acceptInviteHandler", () => {
  it("adds the invited user as a member on a matching-email accept", async () => {
    const store = seededStore();
    store._seedEmail("bob", "bob@example.com");
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;
    const invite = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    const token = (invite.body as { token: string }).token;

    const reply = await acceptInviteHandler(store, token, "bob");
    expect(reply.status).toBe(200);

    const members = await store.membersOf(weddingId);
    expect(members).toHaveLength(2);
  });

  it("rejects with a specific reason when the authenticating email doesn't match", async () => {
    const store = seededStore();
    store._seedEmail("eve", "eve@example.com");
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;
    const invite = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    const token = (invite.body as { token: string }).token;

    const reply = await acceptInviteHandler(store, token, "eve");
    expect(reply.status).toBe(409);
    expect((reply.body as { reason: string }).reason).toBe("wrong-email");
  });

  it("rejects an unknown token with 404", async () => {
    const store = seededStore();
    const reply = await acceptInviteHandler(store, "does-not-exist", "bob");
    expect(reply.status).toBe(404);
  });

  it("rejects accepting the same invite twice", async () => {
    const store = seededStore();
    store._seedEmail("bob", "bob@example.com");
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;
    const invite = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    const token = (invite.body as { token: string }).token;
    await acceptInviteHandler(store, token, "bob");

    store._seedEmail("bob2", "bob@example.com");
    const reply = await acceptInviteHandler(store, token, "bob2");
    expect(reply.status).toBe(409);
    expect((reply.body as { reason: string }).reason).toBe("already-accepted");
  });

  it("rejects an expired invite", async () => {
    const store = seededStore();
    store._seedEmail("bob", "bob@example.com");
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;
    const invite = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    const token = (invite.body as { token: string }).token;

    const record = await store.getInvite(token);
    if (record) record.expiresAt = new Date(0).toISOString();

    const reply = await acceptInviteHandler(store, token, "bob");
    expect(reply.status).toBe(409);
    expect((reply.body as { reason: string }).reason).toBe("expired");
  });

  it("rejects an accept once the wedding filled up between two outstanding invites", async () => {
    const store = seededStore();
    store._seedEmail("bob", "bob@example.com");
    store._seedEmail("carol", "carol@example.com");
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;

    const inviteBob = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    const inviteCarol = await createInviteHandler(store, weddingId, "alice", "carol@example.com");
    await acceptInviteHandler(store, (inviteBob.body as { token: string }).token, "bob");

    const reply = await acceptInviteHandler(store, (inviteCarol.body as { token: string }).token, "carol");
    expect(reply.status).toBe(409);
    expect((reply.body as { reason: string }).reason).toBe("wedding-full");
  });
});

describe("deleteAccountHandler", () => {
  it("leaves the wedding intact for a remaining partner", async () => {
    const store = seededStore();
    store._seedEmail("bob", "bob@example.com");
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;
    const invite = await createInviteHandler(store, weddingId, "alice", "bob@example.com");
    const token = (invite.body as { token: string }).token;
    await acceptInviteHandler(store, token, "bob");

    await deleteAccountHandler(store, "bob");

    const remainingMember = await store.memberOf("alice");
    expect(remainingMember?.weddingId).toBe(weddingId);
  });

  it("removes the wedding entirely once its last member is deleted", async () => {
    const store = seededStore();
    const created = await createWeddingHandler(store, "alice");
    const weddingId = (created.body as { weddingId: string }).weddingId;

    await deleteAccountHandler(store, "alice");

    const members = await store.membersOf(weddingId);
    expect(members).toHaveLength(0);
  });
});

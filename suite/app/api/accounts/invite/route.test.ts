// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { memoryStore } from "@/lib/accounts/store";

const store = memoryStore();
let currentUserResult: { id: string; email: string } | null = { id: "user-1", email: "a@example.com" };

vi.mock("@/lib/env", () => ({ accountsConfigured: () => true }));
vi.mock("@/lib/accounts/serverClient", () => ({
  currentUser: async () => currentUserResult,
  serverClient: async () => ({ auth: { signInWithOtp: async () => ({ error: null }) } }),
}));
vi.mock("@/lib/accounts/supabaseStore", () => ({ accountsStore: () => store }));

const { POST } = await import("./route");

const post = () =>
  POST(
    new Request("http://localhost/api/accounts/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "partner@example.com" }),
    }),
  );

// A fresh account (already holding a wedding of its own) per test, since both
// the in-memory store and the limiter's window map are shared across this file.
beforeEach(async () => {
  currentUserResult = { id: `user-${Math.random()}`, email: "a@example.com" };
  await store.createWedding(currentUserResult.id);
});

test("invites past the limit are throttled, per account", async () => {
  // INVITE_LIMIT is 5 an hour. Spend it, then confirm the next is refused.
  for (let i = 0; i < 5; i += 1) {
    const response = await post();
    expect(response.status).toBe(200);
  }
  const sixth = await post();
  expect(sixth.status).toBe(429);
});

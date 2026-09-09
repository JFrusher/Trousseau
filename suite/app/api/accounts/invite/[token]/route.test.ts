// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { memoryStore } from "@/lib/accounts/store";

const store = memoryStore() as ReturnType<typeof memoryStore> & {
  _seedEmail(userId: string, email: string): void;
};

let currentUserResult: { id: string; email: string } | null = { id: "user-1", email: "a@example.com" };

vi.mock("@/lib/env", () => ({ accountsConfigured: () => true }));
vi.mock("@/lib/accounts/serverClient", () => ({
  currentUser: async () => currentUserResult,
  serverClient: async () => ({}),
}));
vi.mock("@/lib/accounts/supabaseStore", () => ({ accountsStore: () => store }));

const { POST } = await import("./route");

// A valid-shaped token that need not resolve to a real invite: the rate
// limiter runs before the lookup, so a "not found" reply is enough to prove
// the budget is being spent without needing a whole invite fixture per call.
const token = "a".repeat(64);
const post = () =>
  POST(new Request(`http://localhost/api/accounts/invite/${token}`), {
    params: Promise.resolve({ token }),
  });

beforeEach(() => {
  currentUserResult = { id: `user-${Math.random()}`, email: "a@example.com" };
});

test("accepting invites past the limit is throttled, per account", async () => {
  // AUTH_LIMIT is 20 per 15 minutes. Spend it, then confirm the next is refused.
  for (let i = 0; i < 20; i += 1) {
    const response = await post();
    expect(response.status).toBe(404);
  }
  const refused = await post();
  expect(refused.status).toBe(429);
});

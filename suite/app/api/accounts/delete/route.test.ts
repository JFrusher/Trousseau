// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { memoryStore } from "@/lib/accounts/store";

const store = memoryStore();
let currentUserResult: { id: string; email: string } | null = { id: "user-1", email: "a@example.com" };

vi.mock("@/lib/env", () => ({
  accountsConfigured: () => true,
  // No SUPABASE_SERVICE_ROLE_KEY here, so the route stops after the store
  // cleanup with a 500 before it would ever reach the admin-client delete —
  // fine for a rate-limit test, which only needs a non-401/429 shape past
  // the throttle.
  env: () => ({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }),
}));
vi.mock("@/lib/accounts/serverClient", () => ({
  currentUser: async () => currentUserResult,
  serverClient: async () => ({}),
}));
vi.mock("@/lib/accounts/supabaseStore", () => ({ accountsStore: () => store }));

const { POST } = await import("./route");

beforeEach(() => {
  currentUserResult = { id: `user-${Math.random()}`, email: "a@example.com" };
});

test("account deletion past the limit is throttled, per account", async () => {
  // CREATE_LIMIT is 5 an hour. Every call here reaches the store cleanup and
  // then stops at the missing service-role key (mocked env has neither), so
  // calls 1-5 land on that same 500, distinctly from the 429 call 6 must get.
  for (let i = 0; i < 5; i += 1) {
    const response = await POST();
    expect(response.status).toBe(500);
  }
  const sixth = await POST();
  expect(sixth.status).toBe(429);
});

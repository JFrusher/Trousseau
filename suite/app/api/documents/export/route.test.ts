// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { memoryStore } from "@/lib/documents/store";

/**
 * The export route end to end, with only the Supabase seams faked. The
 * handler's own rules are tested in lib/documents/handlers.test.ts; what is
 * covered here is the wiring: auth, the per-account limit, the membership
 * lookup, and the download headers.
 */

const store = memoryStore();
let currentUserResult: { id: string; email: string } | null = { id: "user-1", email: "a@example.com" };
let membership: { weddingId: string } | null = { weddingId: "wedding-1" };

vi.mock("@/lib/env", () => ({ accountsConfigured: () => true }));

vi.mock("@/lib/accounts/serverClient", () => ({
  currentUser: async () => currentUserResult,
  serverClient: async () => ({}),
}));

vi.mock("@/lib/accounts/supabaseStore", () => ({
  accountsStore: () => ({ memberOf: async () => membership }),
}));

vi.mock("@/lib/documents/supabaseStore", () => ({
  documentStore: () => store,
}));

const route = await import("./route");

const wedding = (coupleNames: string) => ({
  event: { date: "2026-08-20", coupleNames },
  day: null,
  guests: {},
  seating: { tables: {} },
  sources: {},
});

// A fresh account and wedding per test: the store and the limiter's window map
// are both module state shared across this file.
beforeEach(() => {
  currentUserResult = { id: `user-${Math.random()}`, email: "a@example.com" };
  membership = { weddingId: `wedding-${Math.random()}` };
});

test("a member downloads their own wedding as an attachment", async () => {
  const document = wedding("Charis & Jacob");
  await store.saveDocument(membership!.weddingId, document, 0);

  const response = await route.GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="charis-and-jacob.trousseau.json"',
  );
  // Personal data must never sit in a shared cache.
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(JSON.parse(await response.text())).toEqual(document);
});

test("a signed-out caller gets nothing", async () => {
  currentUserResult = null;
  const response = await route.GET();
  expect(response.status).toBe(401);
});

test("a caller who belongs to no wedding cannot export one", async () => {
  // The application-layer half of the spec's negative test. The database half
  // already exists in lib/documents/migrations.test.ts, against real Postgres.
  membership = null;
  const response = await route.GET();
  expect(response.status).toBe(404);
  expect(response.headers.get("content-disposition")).toBeNull();
});

test("a member of a wedding that has never been saved gets 404, not an empty file", async () => {
  const response = await route.GET();
  expect(response.status).toBe(404);
});

test("downloads past the limit are throttled, per account", async () => {
  await store.saveDocument(membership!.weddingId, wedding("Charis & Jacob"), 0);

  // EXPORT_LIMIT is 20 an hour.
  for (let i = 0; i < 20; i += 1) {
    expect((await route.GET()).status).toBe(200);
  }
  expect((await route.GET()).status).toBe(429);

  // A different account still gets theirs.
  currentUserResult = { id: "someone-else", email: "b@example.com" };
  membership = { weddingId: "someone-elses-wedding" };
  await store.saveDocument("someone-elses-wedding", wedding("Ana & Bo"), 0);
  expect((await route.GET()).status).toBe(200);
});

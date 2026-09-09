# Hosted-Readiness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four gaps found in a consolidation-pass review of Trousseau: no CI gate before Vercel deploys, no retention sweep for the account-based wedding data every real user is now on, no rate limiting on four `/api/accounts/*` routes, and several tools shipping their whole PDF/export stack on every page load instead of on demand.

**Architecture:** Each fix extends a pattern the codebase already uses elsewhere rather than inventing a new one — CI mirrors the sibling Plaque repo's working workflow; the retention sweep mirrors `lib/sync/handlers.ts`'s existing `sweepAbandoned`; rate limiting reuses `lib/sync/rateLimit.ts`'s already-generic `allow()`; lazy loading mirrors Plaque's `ExportBar.tsx` and `WeddingPack.tsx`'s existing dynamic-import calls.

**Tech Stack:** Next.js 16 (Turbopack), Vitest, PGlite (in-process Postgres for migration tests), Supabase, GitHub Actions.

**Spec:** `C:\Users\frusherj\.claude\plans\create-a-detailed-plan-jazzy-sutton.md` (the user-approved plan this implementation plan expands into bite-sized tasks — read it for the original context/reasoning; this document is the executable version).

## Global Constraints

- No lint step anywhere in this plan — confirmed no eslint/prettier config or `lint` script exists in this repo today; introducing one is explicitly out of scope.
- No deploy step in CI — Vercel's own git integration already deploys; the workflow only gates `push`/`pull_request`.
- The retention sweep for `wedding_documents` needs its **own service-role Supabase client**, separate from `documentStore(client)`'s normal caller-scoped client — `documentStore(client)` is generic over any `SupabaseClient`, so the cron route passes it an admin client instead of `serverClient()`'s per-request one. Do not add RLS-bypassing logic anywhere else.
- `RETENTION_MONTHS` is defined twice today (`suite/lib/sync/handlers.ts:326` and `suite/lib/legal.ts:37`) with an explicit "must not drift" comment on each. Reuse the existing constants — do not add a third.
- `suite/lib/legal.test.ts` hashes the privacy policy's text and fails if `updated`/`digest` don't match a wording change — when you edit `suite/lib/legal.ts`'s paragraphs, the test failure message itself names the exact digest string to paste in; use that rather than computing SHA-256 yourself.

---

## Task 1: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:** None — this task has no code dependencies on any other task and produces nothing other tasks consume.

- [ ] **Step 1: Write the workflow file**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test
      - run: npm run typecheck -w suite
      - run: npm run test -w suite
      - run: npm run build -w suite
```

`npm ci` at the repo root installs both the root contract package and `suite` (npm workspaces). `npm run build -w suite` itself runs `npm --prefix .. run build && next build` (per `suite/package.json`), so the contract package gets rebuilt before Next runs — no separate root build step is needed. No environment variables: every var in `suite/lib/env.ts`'s schema is optional, so `env()` validates with a completely empty environment and the build needs no secrets. No services block: `suite/lib/sync/migrations.test.ts` uses PGlite (in-process WASM Postgres, already a devDependency) — no Docker, no external database.

- [ ] **Step 2: Verify locally before pushing**

Run each command from the workflow, in order, from the repo root:
```bash
npm ci
npm run typecheck
npm run test
npm run typecheck -w suite
npm run test -w suite
npm run build -w suite
```
Expected: all six succeed. (This is the same sequence CI will run — running it locally first catches anything workflow-specific before spending a CI run on it.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add a GitHub Actions workflow that gates on typecheck, test, and build"
```

The workflow itself is only provably correct once it runs on GitHub — Verification step 5 below covers pushing and confirming a green run.

---

## Task 2: Service-role client and stale-wedding lookup for `lib/documents`

**Files:**
- Modify: `suite/lib/documents/store.ts`
- Modify: `suite/lib/documents/supabaseStore.ts`
- Test: `suite/lib/documents/store.test.ts` (create if it doesn't exist, or extend if it does — check first)

**Interfaces:**
- Produces: `DocumentStore.staleWeddings(before: string): Promise<string[]>`, `DocumentStore.deleteWedding(weddingId: string): Promise<void>`, and `adminDocumentsClient(): SupabaseClient | null` (a new exported function in `supabaseStore.ts`, mirroring `suite/lib/sync/supabaseStore.ts:30-61`'s `supabase()`).
  Task 3 consumes `staleWeddings`/`deleteWedding` (via `documentStore(adminClient)`) and `adminDocumentsClient`.

Current `DocumentStore` interface (`suite/lib/documents/store.ts`):
```ts
export interface DocumentStore {
  getDocument(weddingId: string): Promise<DocumentRecord | null>;
  saveDocument(weddingId: string, document: unknown, expectedVersion: number): Promise<SaveResult>;
}
```

- [ ] **Step 1: Write the failing tests**

Check first whether `suite/lib/documents/store.test.ts` already exists (it may not — `store.ts`'s `memoryStore()` may currently only be tested indirectly via `handlers.test.ts` or route tests). If it exists, add these tests to it; if not, create it following the style of `suite/lib/sync/store.ts`'s equivalent tests (check `suite/lib/sync/store.test.ts` if present, otherwise mirror the in-memory-store test style used elsewhere in `lib/documents/`).

```ts
import { expect, test } from "vitest";
import { memoryStore } from "./store";

test("staleWeddings returns ids whose document predates the cutoff, oldest first", async () => {
  const store = memoryStore();
  await store.saveDocument("old", { a: 1 }, 0);
  await store.saveDocument("recent", { a: 1 }, 0);

  // memoryStore's saveDocument stamps updatedAt with `new Date().toISOString()`
  // at call time, so both are "recent" by default — this test needs a real
  // cutoff in the future relative to both saves, then confirms both come back,
  // and a cutoff in the past returns neither. See Step 3 for why memoryStore's
  // updatedAt can't be backdated directly from a test without exposing a seam
  // for it, and how that's resolved.
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const stale = await store.staleWeddings(future.toISOString());
  expect(stale).toContain("old");
  expect(stale).toContain("recent");

  const past = new Date();
  past.setFullYear(past.getFullYear() - 1);
  expect(await store.staleWeddings(past.toISOString())).toEqual([]);
});

test("deleteWedding removes the document so getDocument returns null after", async () => {
  const store = memoryStore();
  await store.saveDocument("gone", { a: 1 }, 0);
  await store.deleteWedding("gone");
  expect(await store.getDocument("gone")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/documents/store.test.ts` (from `suite/`)
Expected: FAIL — `staleWeddings`/`deleteWedding` don't exist on `DocumentStore` yet.

- [ ] **Step 3: Extend `DocumentStore` and its `memoryStore()`**

In `suite/lib/documents/store.ts`, add to the interface:

```ts
export interface DocumentStore {
  getDocument(weddingId: string): Promise<DocumentRecord | null>;
  saveDocument(weddingId: string, document: unknown, expectedVersion: number): Promise<SaveResult>;
  /** Weddings whose document was last saved before `before`, oldest first. */
  staleWeddings(before: string): Promise<string[]>;
  /** Delete a wedding's document outright — used only by the retention sweep. */
  deleteWedding(weddingId: string): Promise<void>;
}
```

In `memoryStore()`, add the two implementations alongside the existing `documents` map:

```ts
    async staleWeddings(before) {
      return [...documents.values()]
        .filter((record) => record.updatedAt < before)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .map((record) => record.weddingId);
    },

    async deleteWedding(weddingId) {
      documents.delete(weddingId);
    },
```

(mirrors `suite/lib/sync/store.ts:152-156`'s in-memory `staleWeddings` exactly, adapted to this file's `documents` map.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/documents/store.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Add the Supabase implementations**

In `suite/lib/documents/supabaseStore.ts`, add to the object `documentStore(client)` returns:

```ts
    async staleWeddings(before) {
      const { data, error } = await client
        .from("wedding_documents")
        .select("wedding_id")
        .lt("updated_at", before)
        .order("updated_at", { ascending: true })
        .limit(SWEEP_BATCH);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.wedding_id as string);
    },

    async deleteWedding(weddingId) {
      // Deletes account_weddings, not just wedding_documents: wedding_documents
      // and wedding_document_history both cascade from account_weddings (`on
      // delete cascade`, supabase/migrations/20260903000001_wedding_documents.sql),
      // and wedding_members does too (20260902000001_accounts.sql) — this is
      // what actually retires the whole wedding, not just its document.
      const { error } = await client.from("account_weddings").delete().eq("id", weddingId);
      if (error) throw new Error(error.message);
    },
```

Add the `SWEEP_BATCH` constant near the top of the file, mirroring `suite/lib/sync/supabaseStore.ts:20-26` exactly (same value, same comment reasoning — a first run against a long-neglected database must not time out):

```ts
/**
 * How many abandoned weddings one sweep will remove.
 *
 * Bounded so a first run against a long-neglected database cannot time out the
 * function that calls it; the sweep runs daily and catches up.
 */
const SWEEP_BATCH = 100;
```

- [ ] **Step 6: Add `adminDocumentsClient()`**

Still in `suite/lib/documents/supabaseStore.ts`, add a service-role client constructor, mirroring `suite/lib/sync/supabaseStore.ts:1-61`'s `supabase()` function exactly (same imports, same 5-second fetch timeout, same both-or-neither env check, same module-level singleton caching):

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let adminClient: SupabaseClient | null = null;

/**
 * A service-role client, for the retention sweep only.
 *
 * `documentStore(client)` is generic over any `SupabaseClient` — the normal
 * app routes pass it a caller-scoped client so RLS applies, but the sweep has
 * to see every wedding, not just one account's, so it gets this one instead.
 * Same 5-second fetch timeout as lib/sync/supabaseStore.ts's equivalent, and
 * for the same reason: a paused Supabase project must fail fast, not hang.
 */
export function adminDocumentsClient(): SupabaseClient | null {
  if (adminClient) return adminClient;
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = env();
  if (!url || !key) return null;
  adminClient = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }),
    },
  });
  return adminClient;
}
```

(This is a simplified version of `lib/sync/supabaseStore.ts`'s fetch wrapper — that file's version also logs `describeCause(cause)` on failure via a `lib/sync/safely.ts` helper local to that module; since `lib/documents` doesn't have an equivalent helper, a plain try/catch-free passthrough is fine here — the timeout still applies, only the extra logging is omitted. If a reviewer prefers the identical logging, importing `describeCause` from `@/lib/sync/safely` is acceptable too, since that helper has no `lib/sync`-specific logic in it — check its contents before deciding.)

- [ ] **Step 7: Run the full `lib/documents` test suite**

Run: `npx vitest run lib/documents/` (from `suite/`)
Expected: PASS, no regressions in `getDocument`/`saveDocument`'s existing tests.

- [ ] **Step 8: Commit**

```bash
git add suite/lib/documents/store.ts suite/lib/documents/supabaseStore.ts suite/lib/documents/store.test.ts
git commit -m "feat(documents): add stale-wedding lookup and an admin client for the retention sweep"
```

---

## Task 3: `sweepAbandonedDocuments` and cron wiring

**Files:**
- Modify: `suite/lib/documents/handlers.ts`
- Test: `suite/lib/documents/handlers.test.ts` (extend, following `suite/lib/sync/handlers.test.ts:378-435`'s pattern for `sweepAbandoned`)
- Modify: `suite/app/api/cron/sweep/route.ts`

**Interfaces:**
- Consumes: `staleWeddings`/`deleteWedding`/`adminDocumentsClient` from Task 2.
- Produces: `sweepAbandonedDocuments(store: DocumentStore, now?: Date): Promise<{ deleted: string[] }>`.

- [ ] **Step 1: Write the failing test**

In `suite/lib/documents/handlers.test.ts` (append), following the exact structure of `suite/lib/sync/handlers.test.ts:378-392`:

```ts
import { sweepAbandonedDocuments } from "./handlers";
import { RETENTION_MONTHS } from "@/lib/sync/handlers";
import { memoryStore } from "./store";

test("a wedding untouched inside the retention period is left alone", async () => {
  const store = memoryStore();
  await store.saveDocument("recent", { a: 1 }, 0);
  expect((await sweepAbandonedDocuments(store)).deleted).toEqual([]);
  expect(await store.getDocument("recent")).not.toBeNull();
});

test("a wedding untouched past the retention period is swept", async () => {
  const store = memoryStore();
  await store.saveDocument("old", { a: 1 }, 0);

  const later = new Date();
  later.setMonth(later.getMonth() + RETENTION_MONTHS + 1);

  expect((await sweepAbandonedDocuments(store, later)).deleted).toEqual(["old"]);
  expect(await store.getDocument("old")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/documents/handlers.test.ts` (from `suite/`)
Expected: FAIL — `sweepAbandonedDocuments` is not exported.

- [ ] **Step 3: Implement `sweepAbandonedDocuments`**

In `suite/lib/documents/handlers.ts`, add (mirroring `suite/lib/sync/handlers.ts:334-349` exactly, reusing that file's `retentionCutoff`/`RETENTION_MONTHS` rather than redefining them — per the Global Constraints, there must be exactly two copies of `RETENTION_MONTHS`, not three):

```ts
import { retentionCutoff } from "@/lib/sync/handlers";
import type { DocumentStore } from "./store";

/**
 * Delete account-held weddings nobody has written to inside the retention
 * period. Mirrors lib/sync/handlers.ts's sweepAbandoned exactly — same cutoff,
 * same shape — for the account-based system that one doesn't cover.
 */
export async function sweepAbandonedDocuments(
  store: DocumentStore,
  now: Date = new Date(),
): Promise<{ deleted: string[] }> {
  const stale = await store.staleWeddings(retentionCutoff(now));
  for (const id of stale) await store.deleteWedding(id);
  return { deleted: stale };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/documents/handlers.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Wire into the cron route**

Current `suite/app/api/cron/sweep/route.ts`:

```ts
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sweepAbandoned } from "@/lib/sync/handlers";
import { supabaseStore } from "@/lib/sync/supabaseStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { CRON_SECRET } = env();
  if (!CRON_SECRET) {
    return NextResponse.json({ error: "No sweep is configured." }, { status: 501 });
  }

  const presented = request.headers.get("authorization");
  if (presented !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "No." }, { status: 401 });
  }

  const db = supabaseStore();
  if (!db) return NextResponse.json({ error: "No backend." }, { status: 501 });

  try {
    const { deleted } = await sweepAbandoned(db);
    console.info(`[Trousseau] retention sweep removed ${deleted.length} wedding(s)`);
    return NextResponse.json({ deleted: deleted.length });
  } catch (cause) {
    console.error("[Trousseau] retention sweep failed:", cause);
    return NextResponse.json({ error: "The sweep failed." }, { status: 503 });
  }
}
```

Replace the `try`/`catch` block with (adding the second sweep, keeping the same fail-closed posture — if the sync sweep runs and the documents sweep then throws, that's still reported as a failure, not silently half-succeeded):

```ts
import { sweepAbandoned } from "@/lib/sync/handlers";
import { supabaseStore } from "@/lib/sync/supabaseStore";
import { sweepAbandonedDocuments } from "@/lib/documents/handlers";
import { documentStore } from "@/lib/documents/supabaseStore";
import { adminDocumentsClient } from "@/lib/documents/supabaseStore";

// ... unchanged CRON_SECRET / auth checks above ...

  const db = supabaseStore();
  if (!db) return NextResponse.json({ error: "No backend." }, { status: 501 });

  try {
    const { deleted } = await sweepAbandoned(db);

    const adminClient = adminDocumentsClient();
    const documentsDeleted = adminClient
      ? (await sweepAbandonedDocuments(documentStore(adminClient))).deleted
      : [];

    const total = deleted.length + documentsDeleted.length;
    console.info(
      `[Trousseau] retention sweep removed ${deleted.length} passphrase wedding(s), ${documentsDeleted.length} account wedding(s)`,
    );
    return NextResponse.json({ deleted: total });
  } catch (cause) {
    console.error("[Trousseau] retention sweep failed:", cause);
    return NextResponse.json({ error: "The sweep failed." }, { status: 503 });
  }
```

Note: `adminDocumentsClient()` returning `null` (accounts not configured on this deployment) is handled by skipping the documents sweep, not by failing the whole request — a deployment with only the passphrase system configured (no Supabase accounts) should still get its `lib/sync` sweep.

- [ ] **Step 6: Manual smoke check**

Run: `npx tsc --noEmit` (from `suite/`)
Expected: no type errors in the route file or its new imports.

- [ ] **Step 7: Commit**

```bash
git add suite/lib/documents/handlers.ts suite/lib/documents/handlers.test.ts suite/app/api/cron/sweep/route.ts
git commit -m "feat(cron): sweep abandoned account-held weddings alongside the passphrase system's sweep"
```

---

## Task 4: Privacy policy update

**Files:**
- Modify: `suite/lib/legal.ts`

**Interfaces:** None — this is a content-only change, no code interfaces produced or consumed.

- [ ] **Step 1: Rewrite the "How long it is kept" section**

Current (`suite/lib/legal.ts:88-93`):

```ts
    {
      heading: "How long it is kept",
      paragraphs: [
        `A wedding that is not written to for ${RETENTION_MONTHS} months is deleted automatically, along with its uploaded files and its guest link. That is long enough to cover an engagement, the wedding, and a year of still wanting the seating plan.`,
        "There is no backup that outlives this. When it is deleted, it is gone.",
        "A wedding held under an account is kept for as long as the account is. Deleting your account deletes it, unless your partner is still on it — in which case it stays with them, because it is their wedding too.",
      ],
    },
```

Replace the third paragraph so both systems state the same rule (keep the first two paragraphs exactly as they are — they already describe the passphrase system correctly and `lib/legal.test.ts:36-41` checks the literal substring `` `${RETENTION_MONTHS} months` `` appears, which paragraph one already satisfies):

```ts
    {
      heading: "How long it is kept",
      paragraphs: [
        `A wedding that is not written to for ${RETENTION_MONTHS} months is deleted automatically, along with its uploaded files and its guest link. That is long enough to cover an engagement, the wedding, and a year of still wanting the seating plan.`,
        "There is no backup that outlives this. When it is deleted, it is gone.",
        `A wedding held under an account follows the same rule: ${RETENTION_MONTHS} months with nobody writing to it, and it is deleted the same way. Deleting your account deletes it immediately, regardless of that timer — unless your partner is still on it, in which case it stays with them, because it is their wedding too.`,
      ],
    },
```

- [ ] **Step 2: Run the failing test to get the real digest**

Run: `npx vitest run lib/legal.test.ts` (from `suite/`)
Expected: FAIL — the first test's failure message reads `The Privacy text has changed. Set updated to today and digest to "<some 16-char hex string>".` Copy that exact string.

- [ ] **Step 3: Update `updated` and `digest`**

In `suite/lib/legal.ts`, change:
```ts
  updated: "2026-09-08",
  digest: "6d6471cfa67c065a",
```
to today's date and the exact digest string the failed test printed in Step 2 (do not guess or recompute it by hand — the test's own failure message is the source of truth for this value).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/legal.test.ts`
Expected: PASS, all tests — including `"the retention period quoted to the reader is the one the code enforces"` (`lib/legal.test.ts:36-41`), which now also implicitly covers the new paragraph since it checks the substring appears somewhere in the policy text, and it appears twice now.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/legal.ts
git commit -m "docs(legal): state the same 24-month retention rule for account-held weddings"
```

---

## Task 5: Rate limiting on `/api/accounts/*`

**Files:**
- Modify: `suite/lib/sync/rateLimit.ts`
- Modify: `suite/app/api/accounts/wedding/route.ts`
- Modify: `suite/app/api/accounts/invite/route.ts`
- Modify: `suite/app/api/accounts/invite/[token]/route.ts`
- Modify: `suite/app/api/accounts/delete/route.ts`
- Test: `suite/app/api/accounts/wedding/route.test.ts`, `suite/app/api/accounts/invite/route.test.ts`, `suite/app/api/accounts/invite/[token]/route.test.ts`, `suite/app/api/accounts/delete/route.test.ts` (all new — none of these route-level test files exist today; only `suite/lib/accounts/handlers.test.ts` does, which tests one layer down)

**Interfaces:**
- Produces: `INVITE_LIMIT: Limit` (new constant in `rateLimit.ts`, alongside the existing `CREATE_LIMIT`/`AUTH_LIMIT`/`WRITE_LIMIT`/`EXPORT_LIMIT`).

This is the same small change applied four times — one `allow()` call inserted into each route, right after `currentUser()` confirms a real signed-in user, keyed by `` `accounts:<action>:${user.id}` ``, returning a `429` via a local `throttled()` helper matching the file's existing reply-helper style. `suite/app/api/documents/route.ts:57-69` is the reference implementation for this exact pattern, and `suite/app/api/documents/route.test.ts:76-91` is the reference test.

- [ ] **Step 1: Add `INVITE_LIMIT`**

In `suite/lib/sync/rateLimit.ts`, add near the existing `CREATE_LIMIT` (`:40`):

```ts
/** Sending an invite email. Same budget shape as CREATE_LIMIT, named for what it guards: an outbound email send, not "creating unlimited weddings." */
export const INVITE_LIMIT: Limit = { max: 5, windowMs: 60 * 60 * 1000 };
```

- [ ] **Step 2: Write the failing test for `wedding/route.ts`**

Create `suite/app/api/accounts/wedding/route.test.ts`, following `suite/app/api/documents/route.test.ts:1-30`'s mocking setup (mock `@/lib/env`'s `accountsConfigured`, `@/lib/accounts/serverClient`'s `currentUser`/`serverClient`, and `@/lib/accounts/supabaseStore`'s `accountsStore` backed by `memoryStore()`):

```ts
import { beforeEach, expect, test, vi } from "vitest";
import { memoryStore } from "@/lib/accounts/store";

const store = memoryStore();
let currentUserResult: { id: string; email: string } | null = { id: "user-1", email: "a@example.com" };

vi.mock("@/lib/env", () => ({ accountsConfigured: () => true }));
vi.mock("@/lib/accounts/serverClient", () => ({
  currentUser: async () => currentUserResult,
  serverClient: async () => ({}),
}));
vi.mock("@/lib/accounts/supabaseStore", () => ({ accountsStore: () => store }));

const { POST } = await import("./route");

beforeEach(() => {
  currentUserResult = { id: "user-1", email: "a@example.com" };
});

test("wedding creation past the limit is throttled, per account", async () => {
  // CREATE_LIMIT is 5 an hour. The store also refuses a second wedding for the
  // same user regardless, so use a fresh currentUserResult.id per call to
  // isolate the rate limit itself from that unrelated refusal.
  for (let i = 0; i < 5; i += 1) {
    currentUserResult = { id: `user-${i}`, email: `a${i}@example.com` };
    // Rate limiting is keyed by user.id, so this loop doesn't actually spend
    // one shared budget — adjust: use the SAME id 5 times, expecting the
    // store-level "already has a wedding" refusal on calls 2-5, then confirm
    // call 6 is throttled specifically (429), not just refused for a
    // different reason (409/400). See Step 3's reply-shape check.
  }
  currentUserResult = { id: "same-user", email: "a@example.com" };
  for (let i = 0; i < 5; i += 1) {
    await POST();
  }
  const sixth = await POST();
  expect(sixth.status).toBe(429);
});
```

Note: this test sketch has a real wrinkle — `createWeddingHandler` already refuses a second wedding for the same user (per `suite/lib/accounts/store.ts`'s `createWedding`: "Throws if the caller already has a wedding"), so calls 2-5 in the "same-user" loop will fail for that reason, not because the budget hasn't run out yet — but the rate limiter still counts them, since `allow()` is checked before the handler runs. Before finalizing this test, read `suite/lib/accounts/handlers.ts`'s `createWeddingHandler` to confirm its exact non-200 status for "already has a wedding" (likely 409), and assert that shape for calls 2-5, then 429 specifically for call 6 — do not just assert `!== 200` for the middle calls, or a regression that accidentally returns 429 early would pass this test by accident.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/api/accounts/wedding/route.test.ts` (from `suite/`)
Expected: FAIL — the 6th call currently succeeds or fails for the wrong reason (no rate limit exists yet).

- [ ] **Step 4: Add the rate-limit check to `wedding/route.ts`**

Current `POST` in `suite/app/api/accounts/wedding/route.ts`:

```ts
export async function POST() {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    const client = await serverClient();
    if (!client) return unconfigured();

    const reply = await createWeddingHandler(accountsStore(client), user.id);
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return failed("POST /api/accounts/wedding", error);
  }
}
```

Add the import and the check, matching `documents/route.ts:69`'s exact placement (right after `currentUser()` confirms a real user, before any store work):

```ts
import { allow, CREATE_LIMIT } from "@/lib/sync/rateLimit";

const throttled = () =>
  NextResponse.json({ error: "Too many requests. Wait a while and try again." }, { status: 429 });

export async function POST() {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    if (!allow(`accounts:create-wedding:${user.id}`, CREATE_LIMIT)) return throttled();

    const client = await serverClient();
    if (!client) return unconfigured();

    const reply = await createWeddingHandler(accountsStore(client), user.id);
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return failed("POST /api/accounts/wedding", error);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/api/accounts/wedding/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Repeat Steps 2-5 for the other three routes**

Same shape, different limit/key/file each time — write each route's test first, watch it fail, then add the check:

- **`suite/app/api/accounts/invite/route.ts`** — insert right after `currentUser()` (before the body-parsing/validation that follows), using `INVITE_LIMIT` from Step 1: `if (!allow(`accounts:invite:${user.id}`, INVITE_LIMIT)) return throttled();`. Add a local `throttled()` matching this file's existing helper style (it already has `unconfigured`/`unauthenticated`/`failed` defined at the top).
- **`suite/app/api/accounts/invite/[token]/route.ts`** — insert right after `currentUser()`, using `AUTH_LIMIT` (already imported style: `import { allow, AUTH_LIMIT } from "@/lib/sync/rateLimit";`): `if (!allow(`accounts:accept-invite:${user.id}`, AUTH_LIMIT)) return NextResponse.json({ error: "Too many requests. Wait a while and try again." }, { status: 429 });` (this file doesn't have named reply helpers like the others — inline is consistent with its existing style).
- **`suite/app/api/accounts/delete/route.ts`** — insert right after `currentUser()` inside the `deleteAccount()` function, using `CREATE_LIMIT`: `if (!allow(`accounts:delete:${user.id}`, CREATE_LIMIT)) return NextResponse.json({ error: "Too many requests. Wait a while and try again." }, { status: 429 });`.

For each: write the test mirroring Step 2's mocking setup (adjust the mocked handler per route), confirm RED, implement, confirm GREEN.

- [ ] **Step 7: Run the full accounts test suite**

Run: `npx vitest run app/api/accounts/ lib/accounts/` (from `suite/`)
Expected: PASS, no regressions in existing handler-level tests.

- [ ] **Step 8: Commit**

```bash
git add suite/lib/sync/rateLimit.ts suite/app/api/accounts/
git commit -m "feat(accounts): rate-limit the four account routes, keyed by user"
```

---

## Task 6: Lazy-load Tableaux's XLSX export

**Files:**
- Modify: `suite/apps/tableaux/utils/exportXlsx.js`

**Interfaces:** None — self-contained within one file.

- [ ] **Step 1: Convert the eager `XLSX` import to a dynamic loader**

Current `suite/apps/tableaux/utils/exportXlsx.js` (full file):

```js
import * as XLSX from 'xlsx'
import { slug, downloadFile } from './exportJson.js'

const sortKey = (s) => String(s || '').toLowerCase()

/** One row per non-declined guest: big group / subgroup / family / full name / table. */
export function buildGroupSheetRows(state) {
  /* ...unchanged... */
}

export function exportGroupsXlsx(state, name) {
  const { headers, rows } = buildGroupSheetRows(state)
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 14 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Groups')
  const buf = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  downloadFile(
    `${slug(name)}-groups.xlsx`,
    buf,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}
```

Replace the top-level import and `exportGroupsXlsx`, mirroring `exportPdf.js:5-10`'s `loadPdf()` pattern exactly (same comment style):

```js
import { slug, downloadFile } from './exportJson.js'

const sortKey = (s) => String(s || '').toLowerCase()

// xlsx is heavy and only needed on export, so it is dynamically imported
// (kept out of the main bundle) — same reasoning as exportPdf.js's loadPdf().
async function loadXlsx() {
  return import('xlsx')
}

/** One row per non-declined guest: big group / subgroup / family / full name / table. */
export function buildGroupSheetRows(state) {
  /* ...unchanged... */
}

export async function exportGroupsXlsx(state, name) {
  const XLSX = await loadXlsx()
  const { headers, rows } = buildGroupSheetRows(state)
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 28 }, { wch: 14 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Groups')
  const buf = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  downloadFile(
    `${slug(name)}-groups.xlsx`,
    buf,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
}
```

`exportGroupsXlsx` is now `async` — find its call site (grep `exportGroupsXlsx(` under `suite/apps/tableaux/`) and confirm the caller already handles it as a promise (e.g. inside an `onClick` that's already `async`/fires-and-forgets) or add `void`/`await` as appropriate to match how `exportFloorPlanPdf`/`exportCards` (the already-async, already-lazy PDF exports in the same directory) are called from their own click handlers.

- [ ] **Step 2: Run the tool's tests**

Run: `npx vitest run --project tableaux` (from `suite/`)
Expected: PASS — check specifically for any existing test of `exportGroupsXlsx`/`buildGroupSheetRows` (grep for `exportXlsx` in `suite/apps/tableaux/**/*.test.*`) and confirm it either already awaits the function or gets updated to do so.

- [ ] **Step 3: Manual verification**

Run: `npm run dev` (from `suite/`), open `/seating`, open the export-groups modal, click the XLSX export button, confirm a file downloads. Open browser devtools' Network tab first to confirm `xlsx`'s chunk loads only at that click, not on initial page load.

- [ ] **Step 4: Commit**

```bash
git add suite/apps/tableaux/utils/exportXlsx.js
git commit -m "perf(tableaux): lazy-load xlsx, only on export"
```

---

## Task 7: Lazy-load Cadence's PDF stack and unused-on-load `fontkit`

**Files:**
- Modify: `suite/apps/cadence/ui/ExportBar.tsx`
- Modify: `suite/apps/cadence/state/fontLoader.ts`
- Create: `suite/apps/cadence/state/fontFamily.ts` (new small module, isolating the `fontkit`-dependent `familyOf`)

**Interfaces:**
- Produces: `familyOf(bytes: Uint8Array): string | null` moves to the new file — any other caller of `familyOf` (check `grep -rn "familyOf" suite/apps/cadence/` first) needs its import path updated too.

- [ ] **Step 1: Split `familyOf` out of `fontLoader.ts`**

Current `suite/apps/cadence/state/fontLoader.ts` (full file):

```ts
import * as fontkit from "fontkit";
import type { UploadedFont } from "../core/model/types";
import { getBlob, putBlob, type BlobBackend } from "./blobStore";

export interface LoadedFont {
  family: string;
  blobKey: string;
  bytes: Uint8Array;
}

const registered = new Set<string>();

/** Reads the family name out of the file itself, so the picker is honest. */
export function familyOf(bytes: Uint8Array): string | null {
  try {
    const font = fontkit.create(bytes as unknown as Buffer);
    const named = font as unknown as { familyName?: string; fullName?: string };
    return named.familyName ?? named.fullName ?? null;
  } catch {
    return null;
  }
}

export type AddFontResult = { font: UploadedFont; error?: undefined } | { error: string };

export async function addFont(file: File | Blob, backend?: BlobBackend): Promise<AddFontResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const family = familyOf(bytes);
  if (!family) {
    return { error: "That file is not a font Cadence can read. Try a .ttf, .otf or .woff2." };
  }

  const blobKey = backend ? await putBlob("font", file, backend) : await putBlob("font", file);
  await registerFace(family, bytes);
  return { font: { family, blobKey } };
}

export async function registerFace(family: string, bytes: Uint8Array): Promise<void> {
  if (registered.has(family) || typeof FontFace === "undefined") return;
  const face = new FontFace(family, bytes as unknown as BufferSource);
  await face.load();
  document.fonts.add(face);
  registered.add(family);
}

export async function restoreFonts(fonts: UploadedFont[]): Promise<string[]> {
  const missing: string[] = [];
  for (const font of fonts) {
    const blob = await getBlob(font.blobKey).catch(() => null);
    if (!blob) {
      missing.push(font.family);
      continue;
    }
    await registerFace(font.family, new Uint8Array(await blob.arrayBuffer()));
  }
  return missing;
}
```

Create `suite/apps/cadence/state/fontFamily.ts`:

```ts
import * as fontkit from "fontkit";

/**
 * Reads the family name out of the file itself, so the picker is honest.
 *
 * Isolated from fontLoader.ts on purpose: this is the only thing in this
 * tool's font handling that actually needs `fontkit`, and it only runs on
 * upload (addFont) — restoreFonts, which runs unconditionally on mount, never
 * calls this. Keeping it in its own module means fontkit's parser only loads
 * when someone uploads a font, not on every page visit.
 */
export function familyOf(bytes: Uint8Array): string | null {
  try {
    const font = fontkit.create(bytes as unknown as Buffer);
    const named = font as unknown as { familyName?: string; fullName?: string };
    return named.familyName ?? named.fullName ?? null;
  } catch {
    return null;
  }
}
```

Update `suite/apps/cadence/state/fontLoader.ts` to remove the `fontkit` import and `familyOf` definition, and dynamically import `familyOf` inside `addFont`:

```ts
import type { UploadedFont } from "../core/model/types";
import { getBlob, putBlob, type BlobBackend } from "./blobStore";

export interface LoadedFont {
  family: string;
  blobKey: string;
  bytes: Uint8Array;
}

const registered = new Set<string>();

export type AddFontResult = { font: UploadedFont; error?: undefined } | { error: string };

/**
 * Takes an uploaded file, checks it is really a font, stores the bytes and
 * registers the face for the screen. A renamed text file is refused here
 * rather than at export time, when it would cost the user a print run.
 */
export async function addFont(file: File | Blob, backend?: BlobBackend): Promise<AddFontResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { familyOf } = await import("./fontFamily");
  const family = familyOf(bytes);
  if (!family) {
    return { error: "That file is not a font Cadence can read. Try a .ttf, .otf or .woff2." };
  }

  const blobKey = backend ? await putBlob("font", file, backend) : await putBlob("font", file);
  await registerFace(family, bytes);
  return { font: { family, blobKey } };
}

/** Makes a family usable in the browser's own text rendering. */
export async function registerFace(family: string, bytes: Uint8Array): Promise<void> {
  if (registered.has(family) || typeof FontFace === "undefined") return;
  const face = new FontFace(family, bytes as unknown as BufferSource);
  await face.load();
  document.fonts.add(face);
  registered.add(family);
}

/** Re-registers every uploaded font a document refers to, after a reload. */
export async function restoreFonts(fonts: UploadedFont[]): Promise<string[]> {
  const missing: string[] = [];
  for (const font of fonts) {
    const blob = await getBlob(font.blobKey).catch(() => null);
    if (!blob) {
      missing.push(font.family);
      continue;
    }
    await registerFace(font.family, new Uint8Array(await blob.arrayBuffer()));
  }
  return missing;
}
```

Before finishing this step, `grep -rn "familyOf" suite/apps/cadence/` and update any other import site (e.g. a test file importing `familyOf` from `./fontLoader` needs to import it from `./fontFamily` instead).

- [ ] **Step 2: Convert `ExportBar.tsx`'s static render imports to dynamic**

Current `suite/apps/cadence/ui/ExportBar.tsx:1-13` (imports section) and `:38-79` (the `download` function) — full current content already captured above during exploration. Replace the five static render imports:

```tsx
import { renderAllCallSheets } from "../render/pdf/callSheet";
import { renderContactSheet } from "../render/pdf/contactSheet";
import { renderOrderOfDay } from "../render/pdf/orderOfDay";
import { renderRunSheet } from "../render/pdf/runSheet";
import { renderTimeline } from "../render/pdf/timeline";
```

with nothing at the top (remove them entirely), and change the `download` function's rendering branch from directly calling the imported functions to dynamically importing each module first, mirroring Plaque's `ExportBar.tsx:100,125` pattern:

```tsx
  const download = async (piece: OutputId | "timeline") => {
    setBusy(true);
    try {
      const uploaded = new Map<string, Uint8Array>();
      for (const font of doc.fonts) {
        const blob = await getBlob(font.blobKey).catch(() => null);
        if (blob) uploaded.set(font.family, new Uint8Array(await blob.arrayBuffer()));
      }

      const fontSource = browserFontSource(uploaded);
      const generatedOn = `Made with Cadence, ${new Date().toLocaleDateString()}`;
      const bytes =
        piece === "timeline"
          ? await (await import("../render/pdf/timeline")).renderTimeline(doc, { fontSource, generatedOn })
          : piece === "run-sheet"
            ? await (await import("../render/pdf/runSheet")).renderRunSheet(doc, { fontSource, generatedOn })
            : piece === "call-sheet"
              ? await (await import("../render/pdf/callSheet")).renderAllCallSheets(doc, { fontSource, generatedOn })
              : piece === "order-of-day"
                ? await (await import("../render/pdf/orderOfDay")).renderOrderOfDay(doc, { fontSource })
                : await (await import("../render/pdf/contactSheet")).renderContactSheet(doc, { fontSource, generatedOn });
```

(Keep everything else in `download` — the slug computation, the blob-URL download trigger, the `catch`/`finally` — exactly as it is.) `OutputId` (imported from `../core/model/types`, unchanged import) and `browserFontSource` (unchanged import, stays static — it's a small font-mapping helper, not part of the PDF stack) are untouched.

- [ ] **Step 3: Run Cadence's tests**

Run: `npx vitest run --project cadence` (from `suite/`)
Expected: PASS. Pay particular attention to any test that imports `familyOf` from the old location, and any test of `ExportBar.tsx`'s `download` behavior that might mock the render functions via their old static import path — those mocks need to target the new dynamic-import path instead (check `suite/apps/cadence/ui/ExportBar.test.tsx` if it exists).

- [ ] **Step 4: Manual verification**

`npm run dev`, open `/timeline`, add a block, use the font upload feature (confirm family-name detection still works), then export a PDF piece (confirm it still downloads correctly). Check Network tab: `fontkit` and the `render/pdf/*` modules should not appear in the initial `/timeline` page load, only after upload/export respectively.

- [ ] **Step 5: Commit**

```bash
git add suite/apps/cadence/ui/ExportBar.tsx suite/apps/cadence/state/fontLoader.ts suite/apps/cadence/state/fontFamily.ts
git commit -m "perf(cadence): lazy-load the PDF export stack and split fontkit out of the mount-time path"
```

---

## Task 8: Lazy-load Brigade's PDF stack

**Files:**
- Modify: `suite/apps/brigade/ui/ExportBar.tsx`

**Interfaces:** None — self-contained, same pattern as Task 7's `ExportBar.tsx` half, one tool.

- [ ] **Step 1: Convert the static render imports to dynamic**

Current `suite/apps/brigade/ui/ExportBar.tsx` (full file captured above). Remove the static import block:

```tsx
import {
  renderAllPersonSheets,
  renderAllTeamSheets,
  renderJobList,
} from "../render/pdf/jobSheets";
```

and change the `make` function's rendering branch:

```tsx
  const make = async () => {
    setBusy(true);
    try {
      const fontSource = browserFontSource();
      const generatedOn = `Made with Brigade, ${new Date().toLocaleDateString()}`;
      const { renderAllPersonSheets, renderAllTeamSheets, renderJobList } = await import(
        "../render/pdf/jobSheets"
      );
      const bytes =
        piece === "job-list"
          ? await renderJobList(doc, { fontSource, generatedOn })
          : piece === "person-sheets"
            ? await renderAllPersonSheets(doc, { fontSource, generatedOn })
            : await renderAllTeamSheets(doc, { fontSource, generatedOn });
```

(All three functions live in the same `../render/pdf/jobSheets` module, so this is one dynamic import rather than three, unlike Cadence's five separate modules.) Keep everything else in `make` unchanged.

- [ ] **Step 2: Run Brigade's tests**

Run: `npx vitest run --project brigade` (from `suite/`)
Expected: PASS — check for any test mocking `../render/pdf/jobSheets` via static import that needs updating to match the dynamic import.

- [ ] **Step 3: Manual verification**

`npm run dev`, open `/delegation`, export each of the three piece types, confirm all three still download correctly. Check Network tab for the deferred chunk.

- [ ] **Step 4: Commit**

```bash
git add suite/apps/brigade/ui/ExportBar.tsx
git commit -m "perf(brigade): lazy-load the PDF export stack"
```

---

## Task 9: Route-split and lazy-load Ensemble (group-shots)

**Files:**
- Modify: `suite/app/(app)/(tools)/group-shots/page.tsx`
- Modify: `suite/components/ensemble/PrintPanel.tsx`

**Interfaces:** None — self-contained.

- [ ] **Step 1: Route-split `EnsembleBoard`, matching the other four tools**

Current `suite/app/(app)/(tools)/group-shots/page.tsx` (full file):

```tsx
import type { Metadata } from "next";
import { EnsembleBoard } from "@/components/ensemble/EnsembleBoard";

export const metadata: Metadata = {
  title: "Group shots",
  description: "The family and group photo list, built from the guest list and the room.",
};

export default function GroupShotsPage() {
  return <EnsembleBoard />;
}
```

Ensemble has no `WhenDocumentReady`/scoped-CSS wrapper client component like the other four tools (`TableauxClient.tsx`, `PlaqueClient.tsx`, `CadenceClient.tsx`, `BrigadeClient.tsx`) — check whether `EnsembleBoard` itself already handles document-readiness internally (grep `WhenDocumentReady` inside `suite/components/ensemble/`) before deciding whether this needs a new client wrapper file or can dynamic-import directly in `page.tsx`. If `EnsembleBoard` is already `"use client"` and self-contained, the minimal fix is:

```tsx
import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = {
  title: "Group shots",
  description: "The family and group photo list, built from the guest list and the room.",
};

const EnsembleBoard = dynamic(
  () => import("@/components/ensemble/EnsembleBoard").then((m) => m.EnsembleBoard),
  { ssr: false },
);

export default function GroupShotsPage() {
  return <EnsembleBoard />;
}
```

If `EnsembleBoard` is NOT already client-only and self-sufficient (e.g. it needs a `WhenDocumentReady`-equivalent wrapper the other tools have), instead create `suite/app/(app)/(tools)/group-shots/EnsembleClient.tsx` mirroring `TableauxClient.tsx`'s exact shape (Task-9-relevant excerpt already shown in Task plan context above) — with `WhenDocumentReady` wrapping the dynamically-imported board — and have `page.tsx` render that client component instead. Check `EnsembleBoard.tsx`'s own top of file for a `"use client"` directive and its use (or non-use) of `WhenDocumentReady` before choosing which path.

- [ ] **Step 2: Dynamic-import `renderShotSheet` in `PrintPanel.tsx`**

Current `suite/components/ensemble/PrintPanel.tsx` (full file captured above). Remove the static import:

```tsx
import { renderShotSheet } from "@/lib/ensemble/render/pdf/shotSheet";
```

and change `makePdf`:

```tsx
  const makePdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const { renderShotSheet } = await import("@/lib/ensemble/render/pdf/shotSheet");
      const bytes = await renderShotSheet(
        shots.sections,
        guests,
        seating,
        shots.cast,
        {
          fontSource: browserFontSource(),
          pageSize,
          coupleNames,
          generatedOn: `Made with Trousseau, ${new Date().toLocaleDateString()}`,
        },
        shots.customRoles,
      );
      download(`${slug()}-group-shots.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PDF could not be made.");
    } finally {
      setBusy(false);
    }
  };
```

(Keep `makeCsv` and everything else unchanged — CSV export has no heavy dependency to defer.)

- [ ] **Step 3: Run Ensemble's tests**

Run: `npx vitest run --project suite -- ensemble` (Ensemble's code lives under the `suite` vitest project per the earlier exploration's file layout — confirm the right `--project` flag by checking `suite/vitest.config.ts`'s project definitions before running; adjust if Ensemble/lib/ensemble tests are grouped under a different project name).
Expected: PASS.

- [ ] **Step 4: Manual verification**

`npm run dev`, open `/group-shots`, confirm the board still renders and works, then export both PDF and CSV, confirm both still download. Check Network tab: `pdf-lib` should not load until the PDF export click.

- [ ] **Step 5: Commit**

```bash
git add "suite/app/(app)/(tools)/group-shots" suite/components/ensemble/PrintPanel.tsx
git commit -m "perf(ensemble): route-split the board and lazy-load its PDF export"
```

---

## Task 10: Defer the Data Manager modal out of the shared header

**Files:**
- Modify: `suite/components/shell/Header.tsx`

**Interfaces:** None — self-contained.

- [ ] **Step 1: Wrap `DataManager` in `next/dynamic`**

Current `suite/components/shell/Header.tsx` (full file captured above, line 12): `import { DataManager } from "./DataManager";`.

Replace that import with:

```tsx
import dynamic from "next/dynamic";

const DataManager = dynamic(() => import("./DataManager").then((m) => m.DataManager), { ssr: false });
```

`DataManager` is already prop-gated (`open`/`onClose`, rendered unconditionally in the JSX but internally checks `open` via `AnimatePresence`) — no other change needed to `Header.tsx`'s JSX; the existing `<DataManager open={dataOpen} onClose={() => setDataOpen(false)} />` call at the bottom stays exactly as it is. `next/dynamic` with `ssr: false` means the component (and everything it imports — `framer-motion`, `@jfrusher/trousseau`, the CSV/guest-import parsing) only loads client-side, on first render of `Header`, but as its own chunk rather than inlined into `Header`'s/the shared layout's chunk — check whether this alone is sufficient or whether a further guard (only mounting `DataManager` at all once `dataOpen` first becomes `true`, via `{dataOpen && <DataManager .../>}` or similar) is worth adding for a bigger win; `next/dynamic` alone still defers the *download* to first render of the page rather than first *open* of the modal, so if the goal is "the chunk doesn't load until the button is clicked," combine it with not rendering `<DataManager>` at all until `dataOpen` has been true at least once. Decide based on Step 3's actual Network-tab observation — don't guess.

- [ ] **Step 2: Run the shell's tests**

Run: `npx vitest run --project suite -- Header DataManager` (adjust the filter to whatever actually matches — check `suite/components/shell/*.test.*` file names first).
Expected: PASS.

- [ ] **Step 3: Manual verification**

`npm run dev`, load any tool page, check Network tab for whether `framer-motion`/`DataManager`'s chunk loads on initial page load or is deferred. Click the "Data" button in the header, confirm the modal still opens and works (CSV import, export, etc.). If the chunk still loads eagerly on page load despite `next/dynamic`, apply the additional guard described in Step 1 and re-check.

- [ ] **Step 4: Commit**

```bash
git add suite/components/shell/Header.tsx
git commit -m "perf(shell): defer the Data Manager modal's chunk out of every route's initial load"
```

---

## Task 11: Bundle-analyzer verification tooling

**Files:**
- Modify: `suite/package.json` (add devDependency)
- Modify: `suite/next.config.ts`

**Interfaces:** None — tooling only, consumed by the Verification section below, not by other tasks.

- [ ] **Step 1: Install `@next/bundle-analyzer`**

```bash
cd suite && npm install --save-dev @next/bundle-analyzer
```

- [ ] **Step 2: Wire it into `next.config.ts`**

Read the current `suite/next.config.ts` in full first (it's CSP/security-headers construction per the earlier exploration — confirm there's no existing `export default` shape conflict). Wrap the existing config export with the standard Next.js pattern:

```ts
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

// ... existing nextConfig object definition, unchanged ...

export default withBundleAnalyzer(nextConfig);
```

(Adapt to whatever the file's actual existing export shape is — if it's `export default nextConfig` today, change only the final line; do not restructure the CSP/headers logic above it.)

- [ ] **Step 3: Verify it runs**

Run: `ANALYZE=true npm run build` (from `suite/`)
Expected: build succeeds and opens/generates bundle-analyzer HTML reports (typically under `.next/analyze/`). Confirm the reports show the chunks touched by Tasks 6-10 (`xlsx`, Cadence's `render/pdf/*` + `fontkit`, Brigade's `render/pdf/jobSheets`, Ensemble's board + `pdf-lib`, `DataManager`) as separate, non-initial chunks.

- [ ] **Step 4: Commit**

```bash
git add suite/package.json suite/package-lock.json suite/next.config.ts
git commit -m "chore(suite): add bundle-analyzer, gated behind ANALYZE=true"
```

---

## Self-Review Notes

- **Spec coverage:** CI → Task 1. Retention sweep → Tasks 2-4 (store/client, sweep function + cron wiring, policy text). Rate limiting → Task 5. Lazy loading → Tasks 6-10 (one per tool + shared shell). Bundle verification tooling → Task 11. All four original weak spots covered.
- **Type consistency:** `DocumentStore.staleWeddings`/`deleteWedding` (Task 2) used unchanged in Task 3's `sweepAbandonedDocuments`. `adminDocumentsClient()` (Task 2) used unchanged in Task 3's cron route. `INVITE_LIMIT` (Task 5, Step 1) used unchanged in Task 5, Step 6's invite route.
- **Known open judgment calls, flagged rather than pre-decided:** Task 5's wedding-creation rate-limit test sketch has a real interaction with the store's own "already has a wedding" refusal that needs resolving against `createWeddingHandler`'s actual status code before the test is exact — flagged explicitly in Step 2 rather than guessed at. Task 9 depends on whether `EnsembleBoard` is already a self-contained client component or needs a new wrapper file — flagged with the exact check to run before choosing. Task 10's dynamic-import may or may not be sufficient on its own to defer the actual network fetch until the modal opens (versus just until first render) — flagged with the exact Network-tab check to decide.

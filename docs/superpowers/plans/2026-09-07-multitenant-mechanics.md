# Multi-Tenant Suite Mechanics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted suite behave correctly with many tenants rather than
one: throttle the authenticated document write path with the limiter the
project already has, and give a couple a real, authenticated way to download
their whole wedding as a file.

**Architecture:** Two small additions on top of subsystem B, both reusing
machinery that already exists. Rate limiting reuses `suite/lib/sync/rateLimit.ts`
(`allow`, `Limit`) unchanged, keyed by **authenticated user id** rather than by
IP, so two couples behind one NAT cannot throttle each other. Export follows the
established `handlers.ts` split exactly: a pure `exportDocumentHandler` tested
against the in-memory `DocumentStore` fake, behind a thin route that adds auth,
the limit, and the `Content-Disposition` header. No new tables, no new
migration, no new dependency.

**Tech Stack:** Next.js App Router (`suite/`), TypeScript, Vitest,
`@jfrusher/trousseau` (for `migrate`, `suggestedFilename`, `TROUSSEAU_EXTENSION`).

**Spec:** [docs/superpowers/specs/2026-09-02-multitenant-mechanics-design.md](../specs/2026-09-02-multitenant-mechanics-design.md)

## Status

**Complete — all 6 tasks, 2026-09-07.**

Verified on the finished branch, not from memory:

| Check | Result |
|---|---|
| `vitest run` (all five projects) | 162 files / 1,574 tests pass |
| `vitest run --project suite lib/sync` | 9 files / 121 tests — the predicted 115 + Task 1's 6 |
| `npm test` (contract package) | 7 files / 98 tests pass |
| `tsc --noEmit -p suite/tsconfig.json` | clean |
| `next build` | clean; `/api/documents/export` registered as dynamic |
| `git diff main -- suite/lib/sync/` | one additive hunk, `EXPORT_LIMIT` only |
| Account page, with and without a wedding | checked by hand in `next dev` |

The account-page check drove the real page with a seeded `@supabase/ssr`
session cookie (`sb-localhost-auth-token`, `base64-` + base64url JSON): the
section appears only when the account has a wedding, and the button fires a
real download named `charis-and-jacob.trousseau.json`.

No corrections to this plan were needed during execution. The two corrections
it makes to the *spec* are recorded above under "Two corrections to the spec".

## Global Constraints

- **Reuse the existing in-memory limiter.** No shared/Postgres/Redis limiter.
  The per-serverless-instance ceiling is disclosed, not hidden — it is already
  documented in `rateLimit.ts`'s header comment, and that comment stays.
- **No admin/support access to user data, by design.** Nothing in this plan adds
  a path for the maintainer to read a couple's wedding. Do not add one.
- **No wedding-switcher UI, and no multi-wedding-per-account.** One active
  wedding per account. `accountsStore(client).memberOf(userId)` returns at most
  one membership and that is the whole mapping.
- **The `/seat/[token]` E2E sync system is untouched.** `suite/lib/sync/` gains
  exactly one new exported constant (`EXPORT_LIMIT`) and one new test file.
  No behaviour in that system changes.
- **Export never re-validates.** The endpoint returns the stored bytes. A
  document that fails `migrate()` must still export — refusing to hand a user
  their own data because a validator dislikes it is the one outcome this
  endpoint exists to prevent. This mirrors the project's standing rule that
  validation never repairs and never deletes.
- **Reads stay unthrottled.** `GET /api/documents` is called once per page load
  by cloud-sync hydration; limiting it would break a heavy user's boot.

## Two corrections to the spec

Both were checked against the codebase before this plan was written.

1. **The spec says "existing `/seat/[token]` limiter tests continue to cover the
   shared implementation."** There are none. `rateLimit.ts` has zero test
   coverage anywhere in the repo — only a passing mention in a comment in
   `suite/app/api/sync/route.test.ts`. Task 1 adds that coverage, because this
   plan makes the limiter load-bearing on the authenticated write path.

2. **The spec asks for an RLS negative test on export.** The database layer
   already has this, against a real Postgres, in
   `suite/lib/documents/migrations.test.ts` ("a non-member cannot save a
   document for someone else's wedding", "a member reads their own wedding's
   document row through a plain select; a non-member reads nothing"). This plan
   adds the *application-layer* counterpart — a caller with no membership gets
   404 and no document — rather than duplicating the database test.

## Known limitation, deliberately accepted

Keying the limit by user id means an **unauthenticated** flood of
`/api/documents` is not throttled by this plan. Those requests are rejected at
`currentUser()` with a 401 before any document work happens, so the cost per
request is low, but it is not zero. This is the accepted trade for not
throttling honest couples who share a public IP. Task 2 records this in a
comment at the call site rather than leaving it implicit.

## File Structure

| File | Responsibility |
|---|---|
| `suite/lib/sync/rateLimit.ts` | **Modify.** Gains one exported constant, `EXPORT_LIMIT`. No logic change. |
| `suite/lib/sync/rateLimit.test.ts` | **Create.** Characterisation tests for `allow()`'s window behaviour. |
| `suite/app/api/documents/route.ts` | **Modify.** `PUT` gains a per-user rate limit check. `GET` unchanged. |
| `suite/app/api/documents/route.test.ts` | **Create.** Drives the route with the Supabase seams mocked and the real handlers/store fake. |
| `suite/lib/documents/handlers.ts` | **Modify.** Gains pure `exportDocumentHandler`. |
| `suite/lib/documents/handlers.test.ts` | **Modify.** Gains export cases against `memoryStore()`. |
| `suite/app/api/documents/export/route.ts` | **Create.** Auth + limit + handler + `Content-Disposition`. |
| `suite/app/api/documents/export/route.test.ts` | **Create.** Route-level coverage including the no-membership case. |
| `suite/app/(app)/account/page.tsx` | **Modify.** Gains a "Your data" section with a download button. |

---

## Task 1: Cover the rate limiter that is about to become load-bearing

**Files:**
- Create: `suite/lib/sync/rateLimit.test.ts`

**Interfaces:**
- Consumes: `allow`, `type Limit` from `suite/lib/sync/rateLimit.ts` (already exported, unchanged).
- Produces: nothing. This task adds no production code.

These are characterisation tests for code that already works, so they pass the
first time they are run. That is expected and is not a reason to skip Step 2 —
running them proves they exercise the module rather than silently passing on a
typo'd import.

`windows` is module-level state shared by every test in the file, so **every
test must use its own unique key**. Do not reuse a key between tests.

- [x] **Step 1: Write the tests**

Create `suite/lib/sync/rateLimit.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { allow, type Limit } from "./rateLimit";

/**
 * The limiter had no tests at all until subsystem G made it load-bearing on
 * the authenticated document write path, not just on the public /seat/[token]
 * endpoints.
 *
 * `windows` is module state shared by this whole file, so every test uses its
 * own key. Reusing one across tests makes them order-dependent.
 */

const LIMIT: Limit = { max: 3, windowMs: 1000 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("calls under the limit are all allowed", () => {
  expect(allow("under", LIMIT)).toBe(true);
  expect(allow("under", LIMIT)).toBe(true);
  expect(allow("under", LIMIT)).toBe(true);
});

test("the call past the limit is refused", () => {
  for (let i = 0; i < LIMIT.max; i += 1) expect(allow("past", LIMIT)).toBe(true);
  expect(allow("past", LIMIT)).toBe(false);
  // Still refused — a rejected call does not reset the window.
  expect(allow("past", LIMIT)).toBe(false);
});

test("two keys have separate budgets", () => {
  for (let i = 0; i < LIMIT.max; i += 1) allow("separate-a", LIMIT);
  expect(allow("separate-a", LIMIT)).toBe(false);
  expect(allow("separate-b", LIMIT)).toBe(true);
});

test("the window reopens once it has expired", () => {
  for (let i = 0; i < LIMIT.max; i += 1) allow("reopen", LIMIT);
  expect(allow("reopen", LIMIT)).toBe(false);

  vi.advanceTimersByTime(LIMIT.windowMs);
  expect(allow("reopen", LIMIT)).toBe(true);
});

test("the window does not reopen early", () => {
  for (let i = 0; i < LIMIT.max; i += 1) allow("early", LIMIT);

  vi.advanceTimersByTime(LIMIT.windowMs - 1);
  expect(allow("early", LIMIT)).toBe(false);
});

test("the sweep drops expired windows without touching live ones", () => {
  // A live key, counted up to one below its limit.
  allow("sweep-live", LIMIT);
  allow("sweep-live", LIMIT);

  // Enough short-lived keys to push the map past the sweep threshold of 5000.
  const brief: Limit = { max: 1, windowMs: 10 };
  for (let i = 0; i < 5200; i += 1) allow(`sweep-filler-${i}`, brief);

  // Past the filler's window but well inside the live key's.
  vi.advanceTimersByTime(20);

  // The sweep runs on the next call. The live key kept its count, so it has
  // exactly one allowed call left before it is refused.
  expect(allow("sweep-live", LIMIT)).toBe(true);
  expect(allow("sweep-live", LIMIT)).toBe(false);
});
```

- [x] **Step 2: Run the tests**

Run from `suite/`: `npx vitest run --project suite lib/sync/rateLimit.test.ts`
Expected: PASS, 6 tests. If any fail, the limiter does not behave as this plan
assumes — stop and report rather than editing `rateLimit.ts` to suit the test.

- [x] **Step 3: Commit**

```bash
git add suite/lib/sync/rateLimit.test.ts
git commit -m "Cover the rate limiter before making it load-bearing"
```

---

## Task 2: Throttle the authenticated document write path, keyed by user

**Files:**
- Modify: `suite/lib/sync/rateLimit.ts`
- Modify: `suite/app/api/documents/route.ts`
- Create: `suite/app/api/documents/route.test.ts`

**Interfaces:**
- Consumes: `allow`, `WRITE_LIMIT` (existing) from `suite/lib/sync/rateLimit.ts`.
- Produces: `EXPORT_LIMIT: Limit` exported from `suite/lib/sync/rateLimit.ts`,
  consumed by Task 4.

- [x] **Step 1: Add the export limit constant**

In `suite/lib/sync/rateLimit.ts`, add directly below the existing
`WRITE_LIMIT` declaration:

```ts
/**
 * Downloading the whole wedding. The largest single response the API serves,
 * so it gets its own ceiling rather than sharing the write budget — but
 * generous enough that a person clicking "download" a few times, or a script
 * taking periodic backups, never notices it.
 */
export const EXPORT_LIMIT: Limit = { max: 20, windowMs: 60 * 60 * 1000 };
```

- [x] **Step 2: Add the limit check to `PUT /api/documents`**

In `suite/app/api/documents/route.ts`, add to the imports at the top of the
file:

```ts
import { allow, WRITE_LIMIT } from "@/lib/sync/rateLimit";
```

Add this helper next to the existing `noWedding` helper:

```ts
const throttled = () =>
  NextResponse.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429 });
```

Then, in `PUT`, insert the check immediately after the `user` is known and
before `serverClient()` is called. The two lines above it already exist — they
are shown so the insertion point is unambiguous:

```ts
    const user = await currentUser();
    if (!user) return unauthenticated();

    // Keyed by account, not by IP: two couples on one office or mobile-carrier
    // NAT must not share a budget. The trade is that an *unauthenticated*
    // flood is not throttled here at all — those requests are refused by
    // `currentUser()` above before any document work happens, which is cheap
    // but not free. Accepted deliberately; revisit if it ever shows up in
    // real traffic.
    if (!allow(`documents:write:${user.id}`, WRITE_LIMIT)) return throttled();
```

Leave `GET` exactly as it is. Cloud-sync hydration calls it once per page
load, and throttling that would break boot for a user with several tabs.

- [x] **Step 3: Write the route test**

Create `suite/app/api/documents/route.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { memoryStore } from "@/lib/documents/store";

/**
 * The route itself, with only the Supabase seams faked.
 *
 * `lib/documents/handlers.ts` is already tested against the in-memory store,
 * and the migration against a real Postgres — but nothing covered the route:
 * the ordering of auth against the rate limit, the membership lookup, the
 * shape of the 429. Those are exactly the joins that break.
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

const put = (document: unknown, expectedVersion: number) =>
  route.PUT(
    new Request("http://localhost/api/documents", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document, expectedVersion }),
    }),
  );

// A fresh account and wedding per test, because both the in-memory store and
// the limiter's window map are shared across this file.
beforeEach(() => {
  currentUserResult = { id: `user-${Math.random()}`, email: "a@example.com" };
  membership = { weddingId: `wedding-${Math.random()}` };
});

test("a signed-in member can save, and the version advances", async () => {
  const first = await put({ kind: "trousseau", version: 1 }, 0);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ version: 1 });
});

test("a stale expected version comes back as a conflict, with the true state", async () => {
  await put({ kind: "trousseau", version: 1 }, 0);
  const second = await put({ kind: "trousseau", version: 1 }, 0);
  expect(second.status).toBe(409);
  expect(await second.json()).toMatchObject({ version: 1 });
});

test("a signed-out caller is refused before any document work", async () => {
  currentUserResult = null;
  const response = await put({ kind: "trousseau", version: 1 }, 0);
  expect(response.status).toBe(401);
});

test("an account with no wedding gets 404, not a crash", async () => {
  membership = null;
  const response = await put({ kind: "trousseau", version: 1 }, 0);
  expect(response.status).toBe(404);
});

test("writes past the limit are throttled, and the budget is per account", async () => {
  // WRITE_LIMIT is 600 a minute. Spend it, then confirm the next is refused.
  let version = 0;
  for (let i = 0; i < 600; i += 1) {
    const response = await put({ kind: "trousseau", version: 1 }, version);
    if (response.status === 200) version += 1;
  }
  const refused = await put({ kind: "trousseau", version: 1 }, version);
  expect(refused.status).toBe(429);

  // A different account is unaffected — this is the point of keying by user.
  currentUserResult = { id: "someone-else", email: "b@example.com" };
  membership = { weddingId: "someone-elses-wedding" };
  const other = await put({ kind: "trousseau", version: 1 }, 0);
  expect(other.status).toBe(200);
});
```

- [x] **Step 4: Run the route test**

Run from `suite/`: `npx vitest run --project suite app/api/documents/route.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Confirm the sync system still passes**

Run from `suite/`: `npx vitest run --project suite lib/sync`
Expected: PASS, 9 files / 121 tests — the 8 files and 115 tests that existed
before this plan, plus Task 1's new file and its 6 tests.

- [x] **Step 6: Commit**

```bash
git add suite/lib/sync/rateLimit.ts suite/app/api/documents/route.ts suite/app/api/documents/route.test.ts
git commit -m "Rate limit the authenticated document write path, keyed by account"
```

---

## Task 3: The pure export handler

**Files:**
- Modify: `suite/lib/documents/handlers.ts`
- Modify: `suite/lib/documents/handlers.test.ts`

**Interfaces:**
- Consumes: `DocumentStore`, `memoryStore` from `suite/lib/documents/store.ts`;
  `migrate`, `suggestedFilename`, `TROUSSEAU_EXTENSION` from `@jfrusher/trousseau`.
- Produces: `exportDocumentHandler(store: DocumentStore, weddingId: string): Promise<ExportReply>`,
  `interface ExportFile { filename: string; text: string }`, and
  `type ExportReply = { status: 200; file: ExportFile } | { status: 404; body: unknown }`.
  All three are consumed by Task 4.

- [x] **Step 1: Write the failing tests**

`suite/lib/documents/handlers.test.ts` uses `describe`/`it`, not bare `test`,
and already defines a `validDoc` fixture in the shape the contract actually
accepts (no `kind`/`version` keys; `seating` is `{ tables: {} }`). Match both.

Add `exportDocumentHandler` to the existing import from `./handlers` at the top
of the file, then append this block to the end:

```ts
describe("exportDocumentHandler", () => {
  it("returns the stored document, pretty-printed, under a name from the couple", async () => {
    const store = memoryStore();
    const document = { ...validDoc, event: { date: "2026-08-20", coupleNames: "Charis & Jacob" } };
    await store.saveDocument("w1", document, 0);

    const reply = await exportDocumentHandler(store, "w1");
    expect(reply.status).toBe(200);
    if (reply.status !== 200) return;
    expect(reply.file.filename).toBe("charis-and-jacob.trousseau.json");
    expect(JSON.parse(reply.file.text)).toEqual(document);
    // Pretty-printed, so a person opening the file can read it.
    expect(reply.file.text).toContain("
  ");
  });

  it("exports nothing, and says so, when the wedding has never been saved", async () => {
    const reply = await exportDocumentHandler(memoryStore(), "never-saved");
    expect(reply.status).toBe(404);
  });

  it("still exports a document the schema rejects, byte for byte", async () => {
    // The whole point of the endpoint: a validator must never be the reason
    // somebody cannot get their own wedding out. `guests` as a string is a
    // shape `migrate()` genuinely throws on, so this exercises the fallback
    // rather than merely asserting the default name.
    const store = memoryStore();
    const broken = { ...validDoc, guests: "not an object at all" };
    await store.saveDocument("w2", broken, 0);

    const reply = await exportDocumentHandler(store, "w2");
    expect(reply.status).toBe(200);
    if (reply.status !== 200) return;
    expect(JSON.parse(reply.file.text)).toEqual(broken);
    // migrate() threw, so the name falls back instead of the export failing.
    expect(reply.file.filename).toBe("wedding.trousseau.json");
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run from `suite/`: `npx vitest run --project suite lib/documents/handlers.test.ts`
Expected: FAIL — `exportDocumentHandler` is not exported from `./handlers`.

- [x] **Step 3: Implement the handler**

Add to the imports at the top of `suite/lib/documents/handlers.ts`:

```ts
import { migrate, suggestedFilename, TROUSSEAU_EXTENSION } from "@jfrusher/trousseau";
```

Add at the end of `suite/lib/documents/handlers.ts`:

```ts
export interface ExportFile {
  filename: string;
  text: string;
}

export type ExportReply = { status: 200; file: ExportFile } | { status: 404; body: unknown };

/**
 * Hand the caller their own wedding as a file.
 *
 * Returns the **stored** document, not a re-validated copy. Every other read
 * path in the suite is free to refuse a document it cannot parse; this one is
 * not, because it is the path a person uses when something has gone wrong and
 * they want their data out. A validator standing between somebody and their
 * own guest list is the single worst failure this endpoint could have.
 */
export async function exportDocumentHandler(
  store: DocumentStore,
  weddingId: string,
): Promise<ExportReply> {
  const record = await store.getDocument(weddingId);
  if (!record || record.document === null || record.document === undefined) {
    return { status: 404, body: { error: "Nothing has been saved to your account yet." } };
  }

  return {
    status: 200,
    file: {
      filename: exportFilename(record.document),
      text: JSON.stringify(record.document, null, 2),
    },
  };
}

/**
 * A name a person will recognise in their downloads folder, falling back
 * rather than throwing. Parsing here is only ever to read the couple's names;
 * if it fails, the document is still exported untouched under a generic name.
 */
function exportFilename(document: unknown): string {
  try {
    return suggestedFilename(migrate(document));
  } catch {
    return `wedding${TROUSSEAU_EXTENSION}`;
  }
}
```

- [x] **Step 4: Run to verify they pass**

Run from `suite/`: `npx vitest run --project suite lib/documents/handlers.test.ts`
Expected: PASS — the file's existing tests plus the three new ones.

- [x] **Step 5: Commit**

```bash
git add suite/lib/documents/handlers.ts suite/lib/documents/handlers.test.ts
git commit -m "Add the pure export handler, which never lets validation block a download"
```

---

## Task 4: `GET /api/documents/export`

**Files:**
- Create: `suite/app/api/documents/export/route.ts`
- Create: `suite/app/api/documents/export/route.test.ts`

**Interfaces:**
- Consumes: `exportDocumentHandler`, `ExportReply` (Task 3); `EXPORT_LIMIT`
  (Task 2); the same `accountsConfigured` / `currentUser` / `serverClient` /
  `accountsStore` / `documentStore` seams `suite/app/api/documents/route.ts`
  already uses.
- Produces: the URL `/api/documents/export`, consumed by Task 5.

- [x] **Step 1: Write the route**

Create `suite/app/api/documents/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { documentStore } from "@/lib/documents/supabaseStore";
import { exportDocumentHandler } from "@/lib/documents/handlers";
import { allow, EXPORT_LIMIT } from "@/lib/sync/rateLimit";

/**
 * "Download my wedding" — the honest answer to "can I get my data out".
 *
 * Also the migration path off the hosted instance: the file this returns is
 * the same `.trousseau.json` a self-hosted instance, or the local-only mode,
 * will open. There is no export format to keep in step, because there is no
 * separate export format.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

export async function GET() {
  try {
    if (!accountsConfigured()) return unconfigured();

    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    // Keyed by account, as on the write path. The whole document is the
    // largest response this API produces, so it gets its own ceiling.
    if (!allow(`documents:export:${user.id}`, EXPORT_LIMIT)) {
      return NextResponse.json(
        { error: "Too many downloads. Try again a little later." },
        { status: 429 },
      );
    }

    const client = await serverClient();
    if (!client) return unconfigured();

    // A caller with no membership resolves to no wedding, so there is nothing
    // to export. RLS enforces the same thing a second time at the database.
    const membership = await accountsStore(client).memberOf(user.id);
    if (!membership?.weddingId) {
      return NextResponse.json({ error: "You don't have a wedding yet." }, { status: 404 });
    }

    const reply = await exportDocumentHandler(documentStore(client), membership.weddingId);
    if (reply.status === 404) return NextResponse.json(reply.body, { status: 404 });

    return new NextResponse(reply.file.text, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${reply.file.filename}"`,
        // A wedding is personal data. Never let a shared cache hold it.
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    console.error("[documents] GET /api/documents/export", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
```

- [x] **Step 2: Write the route test**

Create `suite/app/api/documents/export/route.test.ts`:

```ts
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
  kind: "trousseau",
  version: 1,
  event: {
    date: "2026-08-20",
    coupleNames,
    venueName: "The barn",
    curfewMin: 1410,
    utcOffsetMin: 60,
  },
  guests: {},
  seating: {},
  crew: {},
  stationery: {},
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
```

- [x] **Step 3: Run the route test**

Run from `suite/`: `npx vitest run --project suite app/api/documents/export/route.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 4: Commit**

```bash
git add suite/app/api/documents/export/route.ts suite/app/api/documents/export/route.test.ts
git commit -m "Add GET /api/documents/export, the authenticated download of a whole wedding"
```

---

## Task 5: "Your data" on the account page

**Files:**
- Modify: `suite/app/(app)/account/page.tsx`

**Interfaces:**
- Consumes: `/api/documents/export` (Task 4).
- Produces: nothing consumed by a later task.

The account page already owns the "my account and my data" surface — it holds
sign-out, partner invites and account deletion. The download goes there rather
than into the Data Manager's Backup panel, which already has an "Export backup"
button for the *local* copy; two near-identical buttons in one panel would be
worse than one in each of the two places a user actually looks.

A plain navigation is enough: the route sets `Content-Disposition: attachment`,
so the browser downloads rather than navigates, and the session cookie rides
along without any token handling in the client.

- [x] **Step 1: Add the section**

In `suite/app/(app)/account/page.tsx`, change the `lucide-react` import line to
add `Download`:

```ts
import { Download, LogOut, Trash2, UserPlus } from "lucide-react";
```

Then add this section immediately before the existing sign-out / delete
section, whose opening tag is
`<section className="flex flex-wrap gap-2 border-t border-charcoal/10 pt-6">`:

```tsx
          {state.weddingId && (
            <section className="space-y-3 border-t border-charcoal/10 pt-6">
              <h2 className="text-xs tracking-widest text-slate uppercase">Your data</h2>
              <p className="text-sm text-slate">
                Download everything saved to your account as one file — guests, seating, the day,
                the crew and the stationery. It opens in Trousseau anywhere, including your own
                copy if you ever run one.
              </p>
              <Button
                onClick={() => window.location.assign("/api/documents/export")}
                icon={Download}
              >
                Download my wedding
              </Button>
            </section>
          )}
```

- [x] **Step 2: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

If it reports `Cannot find name 'LayoutProps'` in `app/layout.tsx`, that is not
a real error and not caused by this change: `LayoutProps` is generated by Next
into `.next/types`, which is gitignored and so absent from a fresh worktree.
Run `npx next build` once, then re-run the type-check.

- [x] **Step 3: Commit**

```bash
git add "suite/app/(app)/account/page.tsx"
git commit -m "Offer the wedding as a download from the account page"
```

---

## Task 6: Full regression check

**Files:** none created or modified — verification only.

**Interfaces:** none.

- [x] **Step 1: Confirm the E2E sync system was not touched beyond the one constant**

Run: `git diff main -- suite/lib/sync/ ':(exclude)suite/lib/sync/rateLimit.test.ts'`
Expected: exactly one hunk — the `EXPORT_LIMIT` constant added to
`rateLimit.ts`. No other file in `suite/lib/sync/` appears, and no existing
line in `rateLimit.ts` is changed.

- [x] **Step 2: Run the sync suite**

Run from `suite/`: `npx vitest run --project suite lib/sync`
Expected: PASS, 9 files / 121 tests — the 8 files and 115 tests that existed
before this plan, plus Task 1's file and its 6 tests.

- [x] **Step 3: Run the whole suite project**

Run from `suite/`: `npx vitest run --project suite`
Expected: PASS, no failures.

- [x] **Step 4: Run every project**

Run from `suite/`: `npx vitest run`
Expected: PASS across `suite`, `plaque`, `brigade`, `tableaux` and `cadence`.

- [x] **Step 5: Run the contract package's tests**

Run from the repo root: `npm test`
Expected: PASS. Unaffected by this plan, but it confirms the workspace is
healthy before review.

- [x] **Step 6: Type-check**

Run from `suite/`: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. See Task 5 Step 2 if `LayoutProps` appears.

- [x] **Step 7: Build**

Run from `suite/`: `npx next build`
Expected: builds clean, and `/api/documents/export` appears in the route list
as a dynamic (`ƒ`) route.

- [x] **Step 8: Nothing to commit**

This task is a gate, not a change. If every check passed, the branch is ready
for review. If any failed, fix it, re-run that check, then re-run Steps 1-7 in
full before considering this task complete.

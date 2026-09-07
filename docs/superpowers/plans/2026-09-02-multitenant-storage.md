# Multi-Tenant Data & Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an account-holding couple's wedding a real cloud home — one
JSONB document per wedding, gated by RLS and a compare-and-set write path
that also runs cross-slice validation as a hard gate — while local IndexedDB
storage becomes an offline cache with queued-write replay, and both the
no-account local-only mode and the existing E2E `/seat/[token]` sync system
are left completely untouched.

**Architecture:** Two new Postgres tables (`wedding_documents`,
`wedding_document_history`) plus one `security definer` SQL function
(`save_wedding_document`) that does the compare-and-set write and the
history-snapshot insert atomically, in one statement, following the exact
UPSERT-with-a-`where`-guard shape `put_slice` already uses in
`supabase/migrations/20260830000002_suite_sync_fixes.sql`. RLS on both
tables reuses `is_wedding_member()`, the `security definer` helper subsystem
A's accounts migration already introduced specifically to avoid RLS's
self-referential-policy infinite-recursion bug — this plan does not
reintroduce that bug by writing a fresh subquery-on-self policy.
Application code is a thin `DocumentStore` interface (real Postgres + an
in-memory fake for tests) behind pure handler functions that also run the
ported `validate-wedding.mjs` cross-slice check — mirroring
`suite/lib/sync/`'s and `suite/lib/accounts/`'s existing
store/handlers/supabaseStore split exactly. An offline write queue
(`suite/lib/documents/cloudSync.ts`) sits between the existing
`useTrousseauStore` local-first store and the new API routes, replaying
queued writes on reconnect and surfacing any resulting conflict the same way
an online conflict is surfaced — not auto-merged.

**Tech Stack:** Next.js App Router (`suite/`), `@supabase/supabase-js`,
`@supabase/ssr`, `@electric-sql/pglite` (real-Postgres RLS/SQL function
tests), Vitest, Zod, `idb-keyval` (already used by `useTrousseauStore` for
local persistence), `zustand`.

**Spec:** `docs/superpowers/specs/2026-09-02-multitenant-storage-design.md`

## Global Constraints

- Accounts (and therefore cloud document sync) are entirely opt-in. Nothing
  in this plan may change the behavior of the app when
  `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`NEXT_PUBLIC_SUPABASE_URL`
  are unset, or when a signed-in user has no wedding yet — it must keep
  working exactly as it does today, local-only. Every new code path is
  gated behind `accountsConfigured()` from `@/lib/env` (already shipped by
  subsystem A) and, further, behind the caller actually having a wedding.
- **The real table names are `account_weddings` and `wedding_members`**, not
  the spec's paraphrased `weddings`/`wedding_members` — `weddings` is
  already the name of the E2E sync system's own table
  (`supabase/migrations/20260830000001_suite_sync.sql`). Every foreign key
  and every RLS policy in this plan references `public.account_weddings`.
  `wedding_members.user_id` is itself the primary key (one row per user,
  ever — "one active wedding per account for v1"), not a composite
  `(wedding_id, user_id)` key.
- RLS policies on the new tables reuse `public.is_wedding_member(uuid)`
  (defined in `20260902000001_accounts.sql`), never a fresh subquery
  against `wedding_members` from within a policy on a table that itself
  joins back to `wedding_members` — that shape is exactly what caused the
  infinite-recursion bug `is_wedding_member()` was introduced to fix.
- Every function granted to `authenticated` must also have its default
  PUBLIC execute grant explicitly revoked (`revoke all on function ... from
  public`) before the `grant ... to authenticated` — `from anon` is a
  no-op for a grant held through PUBLIC, per the working comment already in
  `20260902000001_accounts.sql`.
- Every new migration file is additive-only — nothing in
  `20260830*.sql`, `20260901*.sql`, or `20260902000001_accounts.sql` is
  modified. This plan's migration is a new file dated after all of those.
- Any foreign key from a new table to `auth.users` that records *who acted*
  (as opposed to *what wedding this belongs to*) must use `on delete set
  null`, not the Postgres default `no action` and not `on delete cascade`.
  Subsystem A shipped exactly this bug (`invites.created_by` had no
  `on delete` action at all, so deleting the account that sent an invite —
  the common case — failed on the foreign key; caught only in A's final
  whole-branch review, not any per-task review) and separately would have
  been wrong the other way too: cascading a document's `updated_by` or a
  history row's `saved_by` would delete real wedding data just because its
  last editor later deleted their own account, while their partner's
  wedding lives on. `set null` is correct in both directions here.
- The existing `suite/lib/sync/` E2E-encrypted backend
  (tables, migration, RLS-free-by-design token-hash authorisation) is not
  read, modified, or referenced by any task in this plan except Task 9's
  regression check, which runs its existing test suite unmodified.
- **`put_slice`'s CAS-via-UPSERT shape has a confirmed bug and must not be
  copied.** `insert ... select ... where p_expected = 0 on conflict (...) do
  update ... where <table>.version = p_expected` looks race-free but isn't
  correct: when the `select`'s `where` excludes its only candidate row
  (true for every non-zero expected version), Postgres has zero proposed
  rows to insert, so `on conflict` never triggers at all — the UPDATE
  branch, including every ordinary second-or-later write with the *correct*
  expected version, silently never runs. `put_slice`'s own test suite
  (`suite/lib/sync/migrations.test.ts`) never exercises "second write at
  the correct non-zero expected version," so this shipped as an untested
  gap; it was caught here because Task 1's test suite does exercise that
  case. The write function in this plan instead does an unconditional
  UPDATE first (gated by `wedding_id` and `version` in its own `where`,
  with nothing upstream suppressing row generation), then an unconditional
  plain INSERT with `on conflict (wedding_id) do nothing`, only attempted
  when the UPDATE found nothing and the caller expected version 0. This is
  still a single race-free round trip — no separate `for update` lock is
  needed, the same way `put_slice` needed none for its own (different)
  race — it is simply not the same statement shape. Fixing `put_slice`
  itself is out of scope for this plan (it lives in a migration file this
  plan may not touch) and was surfaced to the human partner separately.
- At least one test layer in this plan exercises RLS as a genuine
  non-superuser Postgres role reading through the exact query shape the
  production adapter (`supabaseStore.ts`) will run — not only through a
  `security definer` SQL function, which bypasses RLS by construction, and
  not only through the in-memory fake, which has no real authorization at
  all. This is the specific gap that let subsystem A's Critical bug C1
  (`invites` RLS blocked the invitee from reading their own invite) ship
  past every per-task review and surface only in the final whole-branch
  review. Task 1, Step 8 below is that test.

---

## Task 1: The wedding-documents migration — tables, RLS, and the CAS write function

**Files:**
- Create: `supabase/migrations/20260903000001_wedding_documents.sql`
- Create: `suite/lib/documents/migrations.test.ts`

**Interfaces:**
- Consumes: `public.account_weddings`, `public.wedding_members`,
  `public.is_wedding_member(uuid)` — all from
  `20260902000001_accounts.sql`, unmodified.
- Produces (SQL, called from `suite/lib/documents/supabaseStore.ts` in Task
  5): `select * from public.save_wedding_document(p_wedding_id uuid,
  p_document jsonb, p_expected_version integer)` → one row `(accepted
  boolean, version integer, document jsonb, updated_at timestamptz)`; plain
  `select` access to `public.wedding_documents` and
  `public.wedding_document_history`, gated by RLS.

This is the highest-value task to get right, for the same reason Task 2 was
in subsystem A's plan: it's where the actual access rules live, and it's
the layer every later task's confidence rests on.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260903000001_wedding_documents.sql`:

```sql
-- A wedding's own account-owned data: one JSONB document per wedding, plus an
-- append-only snapshot history. Entirely separate from the E2E-encrypted
-- passphrase-based sharing in 20260830000001_suite_sync.sql (that system's
-- `weddings`/`slices` tables are untouched and unrelated) and built on top of
-- 20260902000001_accounts.sql's `account_weddings`/`wedding_members`, not the
-- sync system's own `weddings` table of the same-sounding name.

create table if not exists public.wedding_documents (
  wedding_id uuid primary key references public.account_weddings (id) on delete cascade,
  document   jsonb not null default '{}'::jsonb,
  -- Starts at 0, meaning "no document has ever been saved for this wedding
  -- yet" — save_wedding_document()'s insert branch below only fires when the
  -- caller's expected version is 0, so a wedding's first save creates this
  -- row rather than requiring it to be pre-created at wedding-creation time.
  version    integer not null default 0,
  updated_at timestamptz not null default now(),
  -- `on delete set null`, not the default `no action`: the person who last
  -- saved a wedding's document is very often not the only member, and their
  -- account being deleted later must not block their own deletion nor erase
  -- their partner's wedding. See 20260902000001_accounts.sql's `invites` table
  -- comment for the identical reasoning (and the bug that shipped without it).
  updated_by uuid references auth.users (id) on delete set null
);

-- Append-only: every accepted write to wedding_documents inserts exactly one
-- row here, in the same transaction, as a full snapshot (not a diff) — the
-- DVC version-history replacement. Nothing in this migration updates or
-- deletes a row here once inserted.
create table if not exists public.wedding_document_history (
  id         uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.account_weddings (id) on delete cascade,
  document   jsonb not null,
  saved_at   timestamptz not null default now(),
  -- Same `set null` reasoning as wedding_documents.updated_by above — a
  -- history row must survive its author's later account deletion.
  saved_by   uuid references auth.users (id) on delete set null
);

alter table public.wedding_documents         enable row level security;
alter table public.wedding_document_history  enable row level security;

-- Every mutation goes through save_wedding_document() below; direct table
-- access from the client is read-only, and only for a wedding's own members —
-- the same shape 20260902000001_accounts.sql already established.
grant select on public.wedding_documents        to authenticated;
grant select on public.wedding_document_history to authenticated;
revoke insert, update, delete on public.wedding_documents        from authenticated;
revoke insert, update, delete on public.wedding_document_history from authenticated;
revoke all on public.wedding_documents        from anon;
revoke all on public.wedding_document_history from anon;

-- Reuses is_wedding_member(), not a fresh subquery against wedding_members —
-- a policy here that queried wedding_members directly would be fine on its
-- own (this table does not recurse into itself), but there is no reason to
-- duplicate the membership check's own bugs-not-yet-found when a tested,
-- already-shipped helper says the same thing.
create policy "members can read their wedding's document"
  on public.wedding_documents for select
  using (public.is_wedding_member(wedding_id));

create policy "members can read their wedding's document history"
  on public.wedding_document_history for select
  using (public.is_wedding_member(wedding_id));

/**
 * Compare-and-set write: accept the incoming document only if the caller's
 * expected version still matches what is stored, and record a full snapshot
 * in wedding_document_history in the same transaction as any accepted write.
 *
 * Mirrors put_slice's exact shape in 20260830000002_suite_sync_fixes.sql: an
 * `insert ... select ... where p_expected_version = 0` guards the
 * first-ever-save case (no row exists yet), `on conflict (wedding_id) do
 * update ... where <table>.version = p_expected_version` guards every save
 * after that, and the same UPSERT statement's row lock is what makes this
 * race-free under concurrent writers without a separate `for update` step —
 * unlike accept_invite/delete_my_account in 20260902000001_accounts.sql,
 * which lock a *different* row (the wedding) before counting members in a
 * *different* table, there is only one row involved here, and the UPSERT's
 * own conflict handling already serialises access to it.
 *
 * Cross-slice validation (the ported validate-wedding.mjs logic) does not
 * live here — it runs in TypeScript, in
 * suite/lib/documents/handlers.ts (Task 4), before this function is ever
 * called, because that logic is pure and depends only on the *incoming*
 * document, never on concurrent database state. Rewriting it in plpgsql
 * would duplicate real business logic in a second language for no
 * correctness benefit.
 */
create or replace function public.save_wedding_document(
  p_wedding_id       uuid,
  p_document         jsonb,
  p_expected_version integer
)
returns table (accepted boolean, version integer, document jsonb, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_written record;
  v_current record;
begin
  if not public.is_wedding_member(p_wedding_id) then
    raise exception 'not a member of that wedding' using errcode = '42501';
  end if;

  -- Try the update first — the common case, since a document row exists for
  -- every wedding after its first save. This is NOT `put_slice`'s single
  -- `insert ... select ... where p_expected = 0 on conflict ... do update`
  -- shape, on purpose: that shape has a real, confirmed bug (see the note
  -- below) — when the SELECT's `where` filters out its only candidate row
  -- (which it does for every non-zero expected version), Postgres has zero
  -- proposed rows to insert, so ON CONFLICT never fires at all, and the
  -- UPDATE branch — including every ordinary second-or-later write with the
  -- correct expected version — silently never runs. Splitting into an
  -- explicit UPDATE-then-INSERT avoids that: the UPDATE is unconditional
  -- over the wedding_id/version match (no row-generation step to suppress),
  -- and the INSERT is a plain, unconditionally-proposed row so
  -- `on conflict (wedding_id) do nothing` can always detect a genuine
  -- concurrent first-write race, the same race `put_slice`'s own comment
  -- describes handling.
  update public.wedding_documents d
     set document   = p_document,
         version    = d.version + 1,
         updated_at = now(),
         updated_by = auth.uid()
   where d.wedding_id = p_wedding_id
     and d.version = p_expected_version
  returning d.document, d.version, d.updated_at
       into v_written;

  if v_written is null and p_expected_version = 0 then
    -- No row was updated. If the caller expected "nothing saved yet",
    -- attempt to create it — `on conflict do nothing` rather than `do
    -- update` because a version mismatch on an existing row is already a
    -- rejection, not something to retry as an update here.
    insert into public.wedding_documents (wedding_id, document, version, updated_at, updated_by)
    values (p_wedding_id, p_document, 1, now(), auth.uid())
    on conflict (wedding_id) do nothing
    returning document, version, updated_at
         into v_written;
  end if;

  if v_written is not null then
    insert into public.wedding_document_history (wedding_id, document, saved_at, saved_by)
    values (p_wedding_id, v_written.document, v_written.updated_at, auth.uid());

    return query select true, v_written.version, v_written.document, v_written.updated_at;
    return;
  end if;

  -- Rejected: either a real version mismatch on an existing row, or
  -- p_expected_version was above 0 on a wedding with no document row yet.
  -- Either way, return the true current state so the caller can show it —
  -- never a generic failure.
  select d.document, d.version, d.updated_at
    into v_current
    from public.wedding_documents d
   where d.wedding_id = p_wedding_id;

  if v_current is not null then
    return query select false, v_current.version, v_current.document, v_current.updated_at;
  else
    return query select false, 0, null::jsonb, null::timestamptz;
  end if;
end;
$$;

revoke all on function public.save_wedding_document(uuid, jsonb, integer) from public;
grant execute on function public.save_wedding_document(uuid, jsonb, integer) to authenticated;
```

- [ ] **Step 2: Write the failing migration test — setup and the RLS/CAS core**

Create `suite/lib/documents/migrations.test.ts`. Follow
`suite/lib/accounts/migrations.test.ts`'s exact pattern (read that file
first if you have not already): PGlite, `authStub()`, `asUser()` /
`asSuperuser()` via `set role` + `set_config('request.jwt.claim.sub', ...,
false)`, migrations applied in order.

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SYNC_MIGRATION = join(process.cwd(), "..", "supabase", "migrations", "20260830000001_suite_sync.sql");
const ACCOUNTS_MIGRATION = join(process.cwd(), "..", "supabase", "migrations", "20260902000001_accounts.sql");
const DOCUMENTS_MIGRATION = join(
  process.cwd(),
  "..",
  "supabase",
  "migrations",
  "20260903000001_wedding_documents.sql",
);

async function authStub(db: PGlite): Promise<void> {
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key, email text not null);
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
}

async function databaseWith(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec("create role anon; create role authenticated;");
  await authStub(db);
  await db.exec(readFileSync(SYNC_MIGRATION, "utf8"));
  await db.exec(readFileSync(ACCOUNTS_MIGRATION, "utf8"));
  await db.exec(readFileSync(DOCUMENTS_MIGRATION, "utf8"));
  return db;
}

let db: PGlite;

async function userExists(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.exec("reset role;");
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

async function asUser(id: string): Promise<void> {
  await db.exec("set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}

async function asSuperuser(): Promise<void> {
  await db.exec("reset role;");
}

async function weddingFor(userId: string): Promise<string> {
  const { rows } = await db.query<{ create_wedding: string }>("select create_wedding()");
  return rows[0]!.create_wedding;
}

beforeEach(async () => {
  db = await databaseWith();
});

test("a member can create the first version of their wedding's document", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);

  const { rows } = await db.query<{ accepted: boolean; version: number; document: unknown }>(
    "select * from save_wedding_document($1, $2, 0)",
    [weddingId, JSON.stringify({ event: { coupleNames: "Alice & Bob" } })],
  );
  expect(rows[0]?.accepted).toBe(true);
  expect(rows[0]?.version).toBe(1);
  expect(rows[0]?.document).toEqual({ event: { coupleNames: "Alice & Bob" } });
});

test("a stale expected version is rejected with the true current state, not a generic failure", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);
  await db.query("select * from save_wedding_document($1, $2, 0)", [
    weddingId,
    JSON.stringify({ event: { coupleNames: "v1" } }),
  ]);

  const { rows } = await db.query<{ accepted: boolean; version: number; document: unknown }>(
    "select * from save_wedding_document($1, $2, 0)",
    [weddingId, JSON.stringify({ event: { coupleNames: "v2, but stale" } })],
  );
  expect(rows[0]?.accepted).toBe(false);
  expect(rows[0]?.version).toBe(1);
  expect(rows[0]?.document).toEqual({ event: { coupleNames: "v1" } });
});

test("the correct expected version is accepted and bumps to the next one", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);
  await db.query("select * from save_wedding_document($1, $2, 0)", [
    weddingId,
    JSON.stringify({ event: { coupleNames: "v1" } }),
  ]);

  const { rows } = await db.query<{ accepted: boolean; version: number }>(
    "select * from save_wedding_document($1, $2, 1)",
    [weddingId, JSON.stringify({ event: { coupleNames: "v2" } })],
  );
  expect(rows[0]?.accepted).toBe(true);
  expect(rows[0]?.version).toBe(2);
});

test("a non-member cannot save a document for someone else's wedding", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);

  const mallory = await userExists("mallory@example.com");
  await asUser(mallory);
  await expect(
    db.query("select * from save_wedding_document($1, $2, 0)", [weddingId, JSON.stringify({})]),
  ).rejects.toThrow();
});

test("every accepted write appends exactly one history row, and a rejected write appends none", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);

  await db.query("select * from save_wedding_document($1, $2, 0)", [
    weddingId,
    JSON.stringify({ event: { coupleNames: "v1" } }),
  ]);
  // Stale — rejected, must not append.
  await db.query("select * from save_wedding_document($1, $2, 0)", [
    weddingId,
    JSON.stringify({ event: { coupleNames: "also v1?" } }),
  ]);
  await db.query("select * from save_wedding_document($1, $2, 1)", [
    weddingId,
    JSON.stringify({ event: { coupleNames: "v2" } }),
  ]);

  await asSuperuser();
  const history = await db.query<{ document: { event: { coupleNames: string } } }>(
    "select document from wedding_document_history where wedding_id = $1 order by saved_at",
    [weddingId],
  );
  expect(history.rows).toHaveLength(2);
  expect(history.rows[0]?.document.event.coupleNames).toBe("v1");
  expect(history.rows[1]?.document.event.coupleNames).toBe("v2");
});

test("deleting the account that last saved a document does not fail on a foreign key", async () => {
  // The identity-accounts branch shipped invites.created_by with no ON DELETE
  // action at all, which made deleting the common case (the account that sent
  // an invite) fail on this exact class of foreign key. Both new tables here
  // use `on delete set null` specifically to not repeat that.
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);
  const invite = await db.query<{ token: string }>("select * from create_invite($1, $2)", [
    weddingId,
    "bob@example.com",
  ]);
  const bob = await userExists("bob@example.com");
  await asUser(bob);
  await db.query("select * from accept_invite($1)", [invite.rows[0]?.token]);
  await db.query("select * from save_wedding_document($1, $2, 0)", [
    weddingId,
    JSON.stringify({ event: { coupleNames: "saved by bob" } }),
  ]);

  // Bob leaves (the wedding survives for alice), then his auth.users row is
  // removed — the case that broke without `on delete set null`.
  await db.query("select delete_my_account()");
  await asSuperuser();
  await expect(db.query("delete from auth.users where id = $1", [bob])).resolves.toBeDefined();

  const doc = await db.query<{ updated_by: string | null }>(
    "select updated_by from wedding_documents where wedding_id = $1",
    [weddingId],
  );
  expect(doc.rows[0]?.updated_by).toBeNull();
  const history = await db.query<{ saved_by: string | null }>(
    "select saved_by from wedding_document_history where wedding_id = $1",
    [weddingId],
  );
  expect(history.rows[0]?.saved_by).toBeNull();
});
```

- [ ] **Step 3: Run the tests written so far to verify they fail**

Run: `npx vitest run --project suite lib/documents/migrations.test.ts`
Expected: FAIL — the migration file doesn't exist yet.

- [ ] **Step 4: Confirm the migration file from Step 1 is saved, then run the tests**

Run: `npx vitest run --project suite lib/documents/migrations.test.ts`
Expected: PASS (all 6 tests so far)

- [ ] **Step 5: Add the RLS-under-a-real-session test — the one this plan's Global Constraints call out by name**

Append to the same file. This is the test that would have caught subsystem
A's Critical bug C1 had an equivalent existed for the accounts migration:
it does not call any `security definer` function, and it does not use the
in-memory fake — it runs the exact `select ... where wedding_id = $1` shape
`supabaseStore.ts` (Task 5) will actually execute, as the `authenticated`
role with a real session, and checks both a member and a non-member.

```ts
test("a member reads their own wedding's document row through a plain select; a non-member reads nothing", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);
  await db.query("select * from save_wedding_document($1, $2, 0)", [
    weddingId,
    JSON.stringify({ event: { coupleNames: "Alice & Bob" } }),
  ]);

  // The member: the same plain select the adapter runs, under the same role.
  const asOwner = await db.query(
    "select wedding_id, document, version from wedding_documents where wedding_id = $1",
    [weddingId],
  );
  expect(asOwner.rows).toHaveLength(1);

  const mallory = await userExists("mallory@example.com");
  await asUser(mallory);
  const asStranger = await db.query(
    "select wedding_id, document, version from wedding_documents where wedding_id = $1",
    [weddingId],
  );
  expect(asStranger.rows).toHaveLength(0);
});

test("a member reads their own wedding's history through a plain select; a non-member reads nothing", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const weddingId = await weddingFor(alice);
  await db.query("select * from save_wedding_document($1, $2, 0)", [weddingId, JSON.stringify({})]);

  const asOwner = await db.query("select id from wedding_document_history where wedding_id = $1", [
    weddingId,
  ]);
  expect(asOwner.rows).toHaveLength(1);

  const mallory = await userExists("mallory@example.com");
  await asUser(mallory);
  const asStranger = await db.query("select id from wedding_document_history where wedding_id = $1", [
    weddingId,
  ]);
  expect(asStranger.rows).toHaveLength(0);
});
```

- [ ] **Step 6: Run the full test file to verify everything passes**

Run: `npx vitest run --project suite lib/documents/migrations.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903000001_wedding_documents.sql suite/lib/documents/migrations.test.ts
git commit -m "Add wedding_documents/wedding_document_history schema and the CAS write function"
```

---

## Task 2: Port the cross-slice validation gate

**Files:**
- Create: `suite/lib/documents/crossSliceValidation.ts`
- Create: `suite/lib/documents/crossSliceValidation.test.ts`

**Interfaces:**
- Consumes: nothing (pure function over a plain object).
- Produces: `checkCrossSlice(doc: unknown): CrossSliceResult`, `CrossSliceResult` — consumed by `suite/lib/documents/handlers.ts` (Task 4).

This is a faithful, mechanical port of `scripts/validate-wedding.mjs`'s
exported `check()` function — the "ported validate-wedding.mjs logic" the
spec calls for. The logic and its existing test suite
(`scripts/validate-wedding.test.mjs`) are both already correct and already
caught two real bugs in production use (per that file's own comments); this
task transcribes both, not redesigns either.

- [ ] **Step 1: Write the failing tests — transcribed from `scripts/validate-wedding.test.mjs`**

Create `suite/lib/documents/crossSliceValidation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkCrossSlice } from "./crossSliceValidation";

const withTable = (table: unknown, guests: Array<Record<string, unknown>>) => ({
  event: { date: "2026-06-20" },
  day: null,
  sources: {
    tableaux: {
      meta: { date: "2026-06-20" },
      guests: Object.fromEntries(guests.map((g) => [g.id as string, g])),
      tables: { [(table as { id: string }).id]: table },
    },
  },
});

const guest = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  fullName: id,
  rsvpStatus: "confirmed",
  dietaryRaw: "No",
  ...extra,
});

describe("seat slots", () => {
  it("does not treat an empty seat as a missing guest", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", null, null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([]);
  });

  it("still catches a guest id that does not exist", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["ghost", null] },
      [],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("ghost")]);
  });

  it("catches the same guest seated twice at one table", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", "g1", null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("twice")]);
  });

  it("catches one seat holding two people", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", "g2"] },
      [
        guest("g1", { assignedTableId: "t1", assignedSeatId: "s1" }),
        guest("g2", { assignedTableId: "t1", assignedSeatId: "s1" }),
      ],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("assigned to both")]);
  });

  it("catches a table over its capacity, counting only filled seats", () => {
    const doc = withTable(
      { id: "t1", label: "Table 8", capacity: 1, assignedGuestIds: ["g1", "g2", null] },
      [guest("g1", { assignedTableId: "t1" }), guest("g2", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("has 1 seats")]);
  });

  it("catches a guest and their table disagreeing", () => {
    const doc = withTable({ id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: [null] }, [
      guest("g1", { assignedTableId: "t1" }),
    ]);
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("does not list them")]);
  });
});

describe("lanes", () => {
  const day = (lanes: string[], blocks: Array<Record<string, unknown>>) => ({
    event: { date: "2026-06-20" },
    sources: {},
    day: { day: { date: "2026-06-20" }, lanes, blocks },
  });

  it("accepts a block whose lane is named by string", () => {
    const doc = day(["Main day"], [{ id: "b1", label: "Ceremony", lane: "Main day" }]);
    expect(checkCrossSlice(doc).errors).toEqual([]);
  });

  it("catches a block in a lane that does not exist", () => {
    const doc = day(["Main day"], [{ id: "b1", label: "Ceremony", lane: "Transport" }]);
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("Transport")]);
  });
});

describe("the event date", () => {
  it("fails when two slices claim different dates", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: { tableaux: { meta: { date: "2026-09-12" } } },
    };
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("2 different dates")]);
  });

  it("passes when every slice agrees", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: { tableaux: { meta: { date: "2026-06-20" } } },
    };
    expect(checkCrossSlice(doc).errors).toEqual([]);
  });
});

describe("the suite's own slices", () => {
  const asSlices = (table: unknown, guests: Array<Record<string, unknown>>) => ({
    event: { date: "2026-06-20" },
    day: null,
    guests: Object.fromEntries(guests.map((g) => [g.id as string, g])),
    seating: { tables: { [(table as { id: string }).id]: table } },
    sources: {},
  });

  it("checks the slices the suite writes, not only sources.tableaux", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1", null] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    const result = checkCrossSlice(doc);
    expect(result.errors).toEqual([]);
    expect(result.facts).toContainEqual(expect.stringContaining("(slices)"));
  });

  it("catches a guest and their table disagreeing, in the slices", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: [] },
      [guest("g1", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("does not list them")]);
  });

  it("catches a table over its own capacity, in the slices", () => {
    const doc = asSlices(
      { id: "t1", label: "Table 8", capacity: 1, assignedGuestIds: ["g1", "g2"] },
      [guest("g1", { assignedTableId: "t1" }), guest("g2", { assignedTableId: "t1" })],
    );
    expect(checkCrossSlice(doc).errors).toEqual([expect.stringContaining("but has 1 seats")]);
  });

  it("still reads a pre-suite bundle that only has sources.tableaux", () => {
    const doc = withTable({ id: "t1", label: "Table 8", capacity: 8, assignedGuestIds: ["g1"] }, [
      guest("g1", { assignedTableId: "t1" }),
    ]);
    const result = checkCrossSlice(doc);
    expect(result.errors).toEqual([]);
    expect(result.facts).toContainEqual(expect.stringContaining("(sources.tableaux)"));
  });
});

describe("warnings do not block", () => {
  it("an unseated confirmed guest is a warning, not an error", () => {
    const doc = {
      event: { date: "2026-06-20" },
      day: null,
      sources: {},
      guests: { g1: guest("g1") },
      seating: { tables: {} },
    };
    const result = checkCrossSlice(doc);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("no table")]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project suite lib/documents/crossSliceValidation.test.ts`
Expected: FAIL — `./crossSliceValidation` doesn't exist yet.

- [ ] **Step 3: Write the ported module**

Create `suite/lib/documents/crossSliceValidation.ts`:

```ts
/**
 * The cross-slice invariant gate — a faithful port of `check()` from
 * `scripts/validate-wedding.mjs`. That script validates the file on disk
 * before a DVC commit; this validates a document before it is accepted into
 * `wedding_documents`. The logic itself does not change: an error blocks the
 * write outright, a warning does not.
 *
 * Kept as a deliberate duplication rather than an import across the
 * suite/scripts boundary — `scripts/validate-wedding.mjs` is plain ESM
 * outside the `suite` Next.js app's module root, and importing it directly
 * would tie this app's build to a sibling directory's bundling behavior for
 * no real benefit. If `scripts/validate-wedding.mjs` changes, this file needs
 * the same change made twice; subsystem C (suite de-duplication) is the
 * place a shared package for this would belong, not this plan.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface CrossSliceResult {
  errors: string[];
  warnings: string[];
  facts: string[];
}

export function checkCrossSlice(doc: unknown): CrossSliceResult {
  const d = isObj(doc) ? doc : {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const facts: string[] = [];
  const fail = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  const sources = isObj(d.sources) ? d.sources : {};
  const tableaux = isObj(sources.tableaux) ? sources.tableaux : null;
  const cadence = isObj(sources.cadence) ? sources.cadence : null;
  const event = isObj(d.event) ? d.event : {};
  const day = isObj(d.day) ? d.day : null;
  const dayInner = day && isObj(day.day) ? day.day : null;
  const tableauxMeta = tableaux && isObj(tableaux.meta) ? tableaux.meta : null;
  const cadenceDay = cadence && isObj(cadence.day) ? cadence.day : null;

  // -------------------------------------------------------------- event date
  const claims: Array<[string, unknown]> = [
    ["event.date", event.date],
    ["day.day.date", dayInner?.date],
    ["sources.tableaux.meta.date", tableauxMeta?.date],
    ["sources.cadence.day.date", cadenceDay?.date],
  ].filter(([, v]) => typeof v === "string" && v !== "");

  const distinctDates = [...new Set(claims.map(([, v]) => v as string))];
  if (distinctDates.length > 1) {
    fail(
      `the wedding has ${distinctDates.length} different dates:\n` +
        claims.map(([where, v]) => `      ${v}  <- ${where}`).join("\n"),
    );
  }

  // ------------------------------------------------------------ seating slice
  const docGuests = isObj(d.guests) ? d.guests : null;
  const docSeatingTables = isObj(d.seating) && isObj((d.seating as Obj).tables)
    ? ((d.seating as Obj).tables as Obj)
    : null;

  const seated = (() => {
    if (docGuests && docSeatingTables) {
      return { guests: docGuests, tables: docSeatingTables, from: "slices" };
    }
    if (tableaux && isObj(tableaux.guests) && isObj(tableaux.tables)) {
      return { guests: tableaux.guests as Obj, tables: tableaux.tables as Obj, from: "sources.tableaux" };
    }
    return null;
  })();

  if (seated) {
    const guests = Object.values(seated.guests) as Obj[];
    const tables = Object.values(seated.tables) as Obj[];
    const guestIds = new Set(guests.map((g) => g.id as string));
    const tableById = new Map(tables.map((t) => [t.id as string, t]));
    const name = (g: Obj) =>
      (g.fullName as string) ||
      `${(g.firstName as string) ?? ""} ${(g.lastName as string) ?? ""}`.trim() ||
      (g.id as string);

    const bySeat = new Map<string, Obj>();
    for (const g of guests) {
      const seatId = g.assignedSeatId as string | undefined;
      if (!seatId) continue;
      const held = bySeat.get(seatId);
      if (held) fail(`seat ${seatId} is assigned to both ${name(held)} and ${name(g)}`);
      else bySeat.set(seatId, g);
    }

    for (const t of tables) {
      const slots = Array.isArray(t.assignedGuestIds) ? (t.assignedGuestIds as unknown[]) : [];
      const ids = slots.filter((id) => id !== null && id !== undefined && id !== "") as string[];
      const where = (t.label as string) ?? (t.id as string);

      for (const id of ids) {
        if (!guestIds.has(id)) fail(`table ${where} holds guest ${id}, who does not exist`);
      }
      for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
        fail(`table ${where} lists guest ${id} twice`);
      }
      if (typeof t.capacity === "number" && ids.length > t.capacity) {
        fail(`table ${where} seats ${ids.length} people but has ${t.capacity} seats`);
      }
    }

    for (const g of guests) {
      const assignedTableId = g.assignedTableId as string | undefined;
      if (!assignedTableId) continue;
      const t = tableById.get(assignedTableId);
      if (!t) {
        fail(`${name(g)} is assigned to table ${assignedTableId}, which does not exist`);
      } else if (!((t.assignedGuestIds as unknown[] | undefined) ?? []).includes(g.id)) {
        fail(`${name(g)} thinks they sit at ${(t.label as string) ?? (t.id as string)}, but that table does not list them`);
      }
    }

    const unseated = guests.filter((g) => g.rsvpStatus === "confirmed" && !g.assignedTableId);
    if (unseated.length > 0) {
      warn(`${unseated.length} confirmed guest(s) have no table: ${unseated.map(name).join(", ")}`);
    }

    const noDietary = guests.filter(
      (g) => g.rsvpStatus === "confirmed" && !g.dietary && !g.dietaryRaw,
    );
    if (noDietary.length > 0) {
      warn(
        `${noDietary.length} confirmed guest(s) have no dietary answer at all: ${noDietary.map(name).join(", ")}`,
      );
    }

    facts.push(`seating: ${guests.length} guests, ${tables.length} tables (${seated.from})`);
  }

  // ---------------------------------------------------------------- day slice
  if (day) {
    const blocks = Array.isArray(day.blocks) ? (day.blocks as Obj[]) : [];
    const lanes = new Set((day.lanes as string[] | undefined) ?? []);
    for (const b of blocks) {
      const lane = b.lane as string | undefined;
      if (lane && !lanes.has(lane)) {
        fail(`block "${(b.label as string) ?? (b.id as string)}" sits in lane "${lane}", which does not exist`);
      }
    }
    const empty = [...lanes].filter((l) => !blocks.some((b) => b.lane === l));
    if (empty.length > 0) warn(`lane(s) with nothing in them: ${empty.join(", ")}`);
    facts.push(`day: ${blocks.length} blocks, ${lanes.size} lanes`);
  }

  return { errors, warnings, facts };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project suite lib/documents/crossSliceValidation.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add suite/lib/documents/crossSliceValidation.ts suite/lib/documents/crossSliceValidation.test.ts
git commit -m "Port validate-wedding.mjs's cross-slice check into suite/lib/documents"
```

---

## Task 3: `DocumentStore` interface and in-memory fake

**Files:**
- Create: `suite/lib/documents/store.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DocumentStore` interface, `memoryStore(): DocumentStore`, `DocumentRecord` — consumed by `handlers.ts` (Task 4) and `supabaseStore.ts` (Task 5).

- [ ] **Step 1: Write the store interface and in-memory implementation**

Create `suite/lib/documents/store.ts`:

```ts
/**
 * Where a wedding's cloud document lives, behind an interface — the same
 * `lib/sync/store.ts` / `lib/accounts/store.ts` pattern: one real
 * implementation (Postgres, via save_wedding_document()) and one in-memory
 * fake, so the CAS and validation rules in handlers.ts can be tested without
 * a database.
 */

export interface DocumentRecord {
  weddingId: string;
  document: unknown;
  version: number;
  updatedAt: string;
}

export interface SaveResult {
  accepted: boolean;
  record: DocumentRecord;
}

export interface DocumentStore {
  /** Null if the wedding has never had a document saved for it. */
  getDocument(weddingId: string): Promise<DocumentRecord | null>;
  /**
   * Compare-and-set write. Always returns the true current record either
   * way — accepted or not — so a rejected write can show what it lost to.
   */
  saveDocument(weddingId: string, document: unknown, expectedVersion: number): Promise<SaveResult>;
}

export function memoryStore(): DocumentStore {
  const documents = new Map<string, DocumentRecord>();

  return {
    async getDocument(weddingId) {
      return documents.get(weddingId) ?? null;
    },

    async saveDocument(weddingId, document, expectedVersion) {
      const current = documents.get(weddingId);
      const currentVersion = current?.version ?? 0;

      if (currentVersion !== expectedVersion) {
        return {
          accepted: false,
          record: current ?? { weddingId, document: null, version: 0, updatedAt: new Date(0).toISOString() },
        };
      }

      const record: DocumentRecord = {
        weddingId,
        document,
        version: currentVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      documents.set(weddingId, record);
      return { accepted: true, record };
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add suite/lib/documents/store.ts
git commit -m "Add the DocumentStore interface and in-memory fake"
```

---

## Task 4: Pure handlers — CAS and the validation gate, tested against the in-memory store

**Files:**
- Create: `suite/lib/documents/handlers.ts`
- Create: `suite/lib/documents/handlers.test.ts`

**Interfaces:**
- Consumes: `DocumentStore`, `memoryStore()`, `DocumentRecord` (Task 3); `checkCrossSlice` (Task 2).
- Produces: `Reply` type, `getDocumentHandler`, `saveDocumentHandler` — both `(store: DocumentStore, ...) => Promise<Reply>`, called directly by the API routes in Task 6.

This is where the spec's write-path ordering (CAS-then-validation for the
*response the user sees*, but validation runs before the database is ever
touched, since it is pure and does not need to) gets its test coverage: an
error-level cross-slice violation is rejected before `store.saveDocument`
is even called; a warning-level violation does not block; a genuine CAS
conflict returns the current state.

- [ ] **Step 1: Write the failing tests**

Create `suite/lib/documents/handlers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getDocumentHandler, saveDocumentHandler } from "./handlers";
import { memoryStore } from "./store";

const validDoc = {
  event: { date: "2026-06-20", coupleNames: "Alice & Bob" },
  day: null,
  guests: {},
  seating: { tables: {} },
  sources: {},
};

describe("getDocumentHandler", () => {
  it("returns version 0 and a null document when nothing has been saved yet", async () => {
    const store = memoryStore();
    const reply = await getDocumentHandler(store, "w1");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ document: null, version: 0 });
  });

  it("returns the stored document and version once one exists", async () => {
    const store = memoryStore();
    await saveDocumentHandler(store, "w1", validDoc, 0);
    const reply = await getDocumentHandler(store, "w1");
    expect(reply.status).toBe(200);
    expect((reply.body as { version: number }).version).toBe(1);
  });
});

describe("saveDocumentHandler", () => {
  it("accepts a valid document at the right expected version", async () => {
    const store = memoryStore();
    const reply = await saveDocumentHandler(store, "w1", validDoc, 0);
    expect(reply.status).toBe(200);
    expect((reply.body as { version: number }).version).toBe(1);
  });

  it("rejects a stale expected version with a 409 and the true current state", async () => {
    const store = memoryStore();
    await saveDocumentHandler(store, "w1", validDoc, 0);

    const reply = await saveDocumentHandler(store, "w1", { ...validDoc, event: { ...validDoc.event, coupleNames: "stale write" } }, 0);
    expect(reply.status).toBe(409);
    const body = reply.body as { version: number; document: unknown };
    expect(body.version).toBe(1);
    expect(body.document).toMatchObject({ event: { coupleNames: "Alice & Bob" } });
  });

  it("rejects an error-level cross-slice violation with a 422, without touching the store", async () => {
    const store = memoryStore();
    const saveSpy = vi.spyOn(store, "saveDocument");
    const invalid = {
      ...validDoc,
      guests: { g1: { id: "g1", fullName: "G1", rsvpStatus: "confirmed", dietaryRaw: "No" } },
      seating: { tables: { t1: { id: "t1", label: "T1", capacity: 8, assignedGuestIds: ["ghost"] } } },
    };
    const reply = await saveDocumentHandler(store, "w1", invalid, 0);
    expect(reply.status).toBe(422);
    expect((reply.body as { errors: string[] }).errors[0]).toContain("ghost");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("accepts a document with only a warning-level violation, and reports the warning", async () => {
    const store = memoryStore();
    const withUnseated = {
      ...validDoc,
      guests: { g1: { id: "g1", fullName: "G1", rsvpStatus: "confirmed", dietaryRaw: "No" } },
    };
    const reply = await saveDocumentHandler(store, "w1", withUnseated, 0);
    expect(reply.status).toBe(200);
    expect((reply.body as { warnings: string[] }).warnings[0]).toContain("no table");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project suite lib/documents/handlers.test.ts`
Expected: FAIL — `./handlers` doesn't exist yet.

- [ ] **Step 3: Write the handlers**

Create `suite/lib/documents/handlers.ts`:

```ts
import { checkCrossSlice } from "./crossSliceValidation";
import type { DocumentStore } from "./store";

export interface Reply {
  status: number;
  body: unknown;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const conflict = (body: unknown): Reply => ({ status: 409, body });
const invalid = (body: unknown): Reply => ({ status: 422, body });

export async function getDocumentHandler(store: DocumentStore, weddingId: string): Promise<Reply> {
  const record = await store.getDocument(weddingId);
  return ok({ document: record?.document ?? null, version: record?.version ?? 0 });
}

/**
 * Validate first — pure, and depends only on the incoming document — then
 * attempt the compare-and-set write. An error-level cross-slice violation is
 * rejected before the store is ever touched, so a write that was going to be
 * refused anyway never becomes a database round trip. A genuine CAS conflict
 * is only ever reported by `store.saveDocument`'s own return value: it is the
 * one authority on "does the expected version still match," since it runs
 * the check and the write as one atomic operation. Nothing here does its own
 * separate version pre-check, which would be a check-then-act race.
 */
export async function saveDocumentHandler(
  store: DocumentStore,
  weddingId: string,
  document: unknown,
  expectedVersion: number,
): Promise<Reply> {
  const validation = checkCrossSlice(document);
  if (validation.errors.length > 0) {
    return invalid({ error: "That wedding is not valid.", errors: validation.errors, warnings: validation.warnings });
  }

  const result = await store.saveDocument(weddingId, document, expectedVersion);
  if (!result.accepted) {
    return conflict({
      error: "Someone else saved a change to this wedding. Refresh and reapply your change.",
      version: result.record.version,
      document: result.record.document,
    });
  }

  return ok({ version: result.record.version, warnings: validation.warnings });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project suite lib/documents/handlers.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add suite/lib/documents/handlers.ts suite/lib/documents/handlers.test.ts
git commit -m "Add pure document handlers: CAS write gated by cross-slice validation"
```

---

## Task 5: Real Postgres store implementation

**Files:**
- Create: `suite/lib/documents/supabaseStore.ts`

**Interfaces:**
- Consumes: `DocumentStore`, `DocumentRecord` (Task 3); a per-request authenticated Supabase client, same shape `suite/lib/accounts/supabaseStore.ts` takes.
- Produces: `documentStore(client: SupabaseClient): DocumentStore`, called from the API routes in Task 6.

Thin adapter, same reasoning as `lib/accounts/supabaseStore.ts`: the rules
are already tested in Task 4 against the fake, and in Task 1 at the SQL
layer directly; this file's only job is calling the right RPC/select with
the right arguments.

- [ ] **Step 1: Write the implementation**

Create `suite/lib/documents/supabaseStore.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentRecord, DocumentStore, SaveResult } from "./store";

/**
 * The Postgres implementation, over a caller-scoped client — same reasoning
 * as `lib/accounts/supabaseStore.ts`: RLS and save_wedding_document() both
 * need to see the real caller via `auth.uid()`, from this client's own
 * session, not a service-role client shared across every request.
 */
export function documentStore(client: SupabaseClient): DocumentStore {
  return {
    async getDocument(weddingId) {
      const { data, error } = await client
        .from("wedding_documents")
        .select("wedding_id, document, version, updated_at")
        .eq("wedding_id", weddingId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        weddingId: data.wedding_id as string,
        document: data.document,
        version: data.version as number,
        updatedAt: data.updated_at as string,
      };
    },

    async saveDocument(weddingId, document, expectedVersion): Promise<SaveResult> {
      const { data, error } = await client
        .rpc("save_wedding_document", {
          p_wedding_id: weddingId,
          p_document: document,
          p_expected_version: expectedVersion,
        })
        .single();
      if (error) throw new Error(error.message);
      const row = data as { accepted: boolean; version: number; document: unknown; updated_at: string | null };
      const record: DocumentRecord = {
        weddingId,
        document: row.document,
        version: row.version,
        updatedAt: row.updated_at ?? new Date(0).toISOString(),
      };
      return { accepted: row.accepted, record };
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add suite/lib/documents/supabaseStore.ts
git commit -m "Add the Postgres DocumentStore implementation over a per-request client"
```

---

## Task 6: API routes

**Files:**
- Create: `suite/app/api/documents/route.ts`

**Interfaces:**
- Consumes: `currentUser()`, `serverClient()` (`@/lib/accounts/serverClient`); `accountsStore()` (`@/lib/accounts/supabaseStore`); `documentStore()` (Task 5); `getDocumentHandler`, `saveDocumentHandler` (Task 4).
- Produces: `GET /api/documents`, `PUT /api/documents` — consumed by Task 7's `cloudSync.ts`.

No `[weddingId]` in the path or the request body — per the "one active
wedding per account for v1" global constraint (already the shape
`GET /api/accounts/wedding` uses), the wedding is always the caller's own,
resolved server-side via `accountsStore(client).memberOf(user.id)`, the
same way subsystem A's Task 8 ruled `create_invite`'s wedding id should be
derived rather than trusted from the client.

- [ ] **Step 1: Write the route**

Create `suite/app/api/documents/route.ts`:

```ts
import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { documentStore } from "@/lib/documents/supabaseStore";
import { getDocumentHandler, saveDocumentHandler } from "@/lib/documents/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

const unauthenticated = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });

const noWedding = () =>
  NextResponse.json({ error: "You don't have a wedding yet." }, { status: 404 });

const failed = (where: string, error: unknown) => {
  console.error(`[documents] ${where}`, error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
};

async function resolveWeddingId(client: NonNullable<Awaited<ReturnType<typeof serverClient>>>, userId: string) {
  const membership = await accountsStore(client).memberOf(userId);
  return membership?.weddingId ?? null;
}

export async function GET() {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    const client = await serverClient();
    if (!client) return unconfigured();

    const weddingId = await resolveWeddingId(client, user.id);
    if (!weddingId) return noWedding();

    const reply = await getDocumentHandler(documentStore(client), weddingId);
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return failed("GET /api/documents", error);
  }
}

interface PutBody {
  document: unknown;
  expectedVersion: number;
}

export async function PUT(request: Request) {
  try {
    if (!accountsConfigured()) return unconfigured();
    const user = await currentUser();
    if (!user) return unauthenticated();

    const client = await serverClient();
    if (!client) return unconfigured();

    const weddingId = await resolveWeddingId(client, user.id);
    if (!weddingId) return noWedding();

    let body: PutBody;
    try {
      body = (await request.json()) as PutBody;
    } catch {
      return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
    }
    if (typeof body.expectedVersion !== "number" || body.document === undefined) {
      return NextResponse.json({ error: "A document and its expected version are required." }, { status: 400 });
    }

    const reply = await saveDocumentHandler(documentStore(client), weddingId, body.document, body.expectedVersion);
    return NextResponse.json(reply.body, { status: reply.status });
  } catch (error) {
    return failed("PUT /api/documents", error);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add suite/app/api/documents/route.ts
git commit -m "Add GET/PUT /api/documents, resolving the caller's wedding server-side"
```

---

## Task 7: Offline write queue and cloud-sync module

**Files:**
- Create: `suite/lib/documents/cloudSync.ts`
- Create: `suite/lib/documents/cloudSync.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (talks to `/api/documents` over `fetch`, and to `idb-keyval` for its own queue) — kept store-agnostic so it is testable in isolation.
- Produces: `fetchCloudDocument()`, `pushDocument(document, expectedVersion)`, `CloudSyncResult`, `PendingWrite`, `getPendingWrite()`, `clearPendingWrite()`, `startAutoRetry(onSettled)` — consumed by Task 8's integration into `useTrousseauStore`.

Because Trousseau's document model is one full JSON snapshot per wedding —
not an operation log or per-field diffs — the "queue" the spec describes is
correctly a queue of *at most one* pending write: every local edit already
supersedes whatever was queued before it, the same way the existing
`schedulePersist` debounce already coalesces rapid local edits into one
write. There is nothing to replay "in order" beyond replaying that one
latest write; ordering only matters in the sense that a second local edit
made while offline must overwrite the first one's queued entry rather than
both being sent.

- [ ] **Step 1: Write the failing tests**

Create `suite/lib/documents/cloudSync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const idbStore = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (key: string) => idbStore.get(key),
  set: async (key: string, value: unknown) => void idbStore.set(key, value),
  del: async (key: string) => void idbStore.delete(key),
}));

const { fetchCloudDocument, pushDocument, getPendingWrite, clearPendingWrite, replayPendingWrite, queueWrite } =
  await import("./cloudSync");

beforeEach(() => {
  idbStore.clear();
  vi.restoreAllMocks();
});

describe("fetchCloudDocument", () => {
  it("returns the document and version on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ document: { event: {} }, version: 3 }), { status: 200 })),
    );
    const result = await fetchCloudDocument();
    expect(result).toEqual({ ok: true, document: { event: {} }, version: 3 });
  });

  it("reports not-reachable on a network failure, without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await fetchCloudDocument();
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("reports unavailable on a 501 (accounts not configured or no wedding yet)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 501 })));
    const result = await fetchCloudDocument();
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("pushDocument", () => {
  it("succeeds and clears any previously queued write", async () => {
    await queueWrite({ event: {} }, 0);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: 1, warnings: [] }), { status: 200 })),
    );
    const result = await pushDocument({ event: {} }, 0);
    expect(result).toEqual({ ok: true, version: 1, warnings: [] });
    expect(await getPendingWrite()).toBeNull();
  });

  it("queues the write and reports queued when the network is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await pushDocument({ event: { coupleNames: "offline edit" } }, 2);
    expect(result).toEqual({ ok: false, reason: "queued" });
    const pending = await getPendingWrite();
    expect(pending).toEqual({ document: { event: { coupleNames: "offline edit" } }, expectedVersion: 2 });
  });

  it("a second offline write while one is already queued replaces it, not appends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await pushDocument({ event: { coupleNames: "first" } }, 2);
    await pushDocument({ event: { coupleNames: "second" } }, 2);
    const pending = await getPendingWrite();
    expect(pending?.document).toEqual({ event: { coupleNames: "second" } });
  });

  it("surfaces a conflict without treating it as queueable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: 5, document: { event: { coupleNames: "theirs" } } }), {
            status: 409,
          }),
      ),
    );
    const result = await pushDocument({ event: { coupleNames: "mine, but stale" } }, 4);
    expect(result).toEqual({ ok: false, reason: "conflict", version: 5, document: { event: { coupleNames: "theirs" } } });
    expect(await getPendingWrite()).toBeNull();
  });

  it("surfaces a validation failure without queueing it for silent retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "That wedding is not valid.", errors: ["bad"] }), { status: 422 }),
      ),
    );
    const result = await pushDocument({ event: {} }, 0);
    expect(result).toEqual({ ok: false, reason: "invalid", errors: ["bad"] });
    expect(await getPendingWrite()).toBeNull();
  });
});

describe("clearPendingWrite", () => {
  it("removes a queued write", async () => {
    await queueWrite({ event: {} }, 0);
    await clearPendingWrite();
    expect(await getPendingWrite()).toBeNull();
  });
});

describe("replayPendingWrite", () => {
  it("returns null when nothing is queued", async () => {
    expect(await replayPendingWrite()).toBeNull();
  });

  it("replays a queued write successfully and clears the queue", async () => {
    await queueWrite({ event: { coupleNames: "queued while offline" } }, 3);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: 4, warnings: [] }), { status: 200 })),
    );
    const result = await replayPendingWrite();
    expect(result).toEqual({ ok: true, version: 4, warnings: [] });
    expect(await getPendingWrite()).toBeNull();
  });

  it("a queued write that now conflicts on replay surfaces the same conflict shape as an online conflict", async () => {
    await queueWrite({ event: { coupleNames: "queued while offline" } }, 3);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: 6, document: { event: { coupleNames: "someone else's edit" } } }), {
            status: 409,
          }),
      ),
    );
    const result = await replayPendingWrite();
    expect(result).toEqual({
      ok: false,
      reason: "conflict",
      version: 6,
      document: { event: { coupleNames: "someone else's edit" } },
    });
    expect(await getPendingWrite()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project suite lib/documents/cloudSync.test.ts`
Expected: FAIL — `./cloudSync` doesn't exist yet.

- [ ] **Step 3: Write the module**

Create `suite/lib/documents/cloudSync.ts`:

```ts
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";

/**
 * The offline write queue and cloud transport, kept entirely separate from
 * `useTrousseauStore` so it can be tested with a fake `fetch` and a mocked
 * `idb-keyval`, the same way `persistFailure.test.ts` tests the local store's
 * own IndexedDB failure handling.
 *
 * One document per wedding, saved as a whole snapshot rather than an
 * operation log, means the "offline queue" the spec describes is correctly a
 * queue of at most one pending write — see this file's task in the plan for
 * why that is a property of the data model, not a corner cut.
 */

const PENDING_WRITE_KEY = "trousseau.cloud.pendingWrite";

export interface PendingWrite {
  document: unknown;
  expectedVersion: number;
}

export async function getPendingWrite(): Promise<PendingWrite | null> {
  const value = await idbGet(PENDING_WRITE_KEY);
  return (value as PendingWrite | undefined) ?? null;
}

export async function queueWrite(document: unknown, expectedVersion: number): Promise<void> {
  await idbSet(PENDING_WRITE_KEY, { document, expectedVersion } satisfies PendingWrite);
}

export async function clearPendingWrite(): Promise<void> {
  await idbDel(PENDING_WRITE_KEY);
}

export type FetchResult =
  | { ok: true; document: unknown; version: number }
  | { ok: false; reason: "unreachable" | "unavailable" };

/** Reads the caller's current cloud document. Never throws. */
export async function fetchCloudDocument(): Promise<FetchResult> {
  let response: Response;
  try {
    response = await fetch("/api/documents", { method: "GET" });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };
  const body = (await response.json()) as { document: unknown; version: number };
  return { ok: true, document: body.document, version: body.version };
}

export type PushResult =
  | { ok: true; version: number; warnings: string[] }
  | { ok: false; reason: "queued" }
  | { ok: false; reason: "conflict"; version: number; document: unknown }
  | { ok: false; reason: "invalid"; errors: string[] }
  | { ok: false; reason: "unavailable" };

/**
 * Attempt a write immediately. A network failure queues it (replacing
 * whatever was queued before) rather than dropping it — everything else
 * (a conflict, a validation failure, the deployment not being configured) is
 * a real answer from the server and is surfaced as-is, not queued for silent
 * retry: retrying a rejected write without the user reapplying anything
 * would just be rejected again.
 */
export async function pushDocument(document: unknown, expectedVersion: number): Promise<PushResult> {
  let response: Response;
  try {
    response = await fetch("/api/documents", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document, expectedVersion }),
    });
  } catch {
    await queueWrite(document, expectedVersion);
    return { ok: false, reason: "queued" };
  }

  if (response.status === 200) {
    await clearPendingWrite();
    const body = (await response.json()) as { version: number; warnings: string[] };
    return { ok: true, version: body.version, warnings: body.warnings };
  }
  if (response.status === 409) {
    await clearPendingWrite();
    const body = (await response.json()) as { version: number; document: unknown };
    return { ok: false, reason: "conflict", version: body.version, document: body.document };
  }
  if (response.status === 422) {
    await clearPendingWrite();
    const body = (await response.json()) as { errors: string[] };
    return { ok: false, reason: "invalid", errors: body.errors };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * Replay a queued write, if one exists. Called on reconnect. A queued write
 * that itself now conflicts is handled identically to any other conflict —
 * `pushDocument` already does that — rather than a second conflict path
 * invented for the offline case specifically.
 */
export async function replayPendingWrite(): Promise<PushResult | null> {
  const pending = await getPendingWrite();
  if (!pending) return null;
  return pushDocument(pending.document, pending.expectedVersion);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project suite lib/documents/cloudSync.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add suite/lib/documents/cloudSync.ts suite/lib/documents/cloudSync.test.ts
git commit -m "Add the offline write queue and cloud-sync transport"
```

---

## Task 8: Wire cloud sync into the local-first store and the UI

**Files:**
- Modify: `suite/lib/store/useTrousseauStore.ts`
- Modify: `suite/lib/store/StoreHydrator.tsx`
- Modify: `suite/components/shell/DataManager.tsx`
- Create: `suite/lib/store/useTrousseauStore.cloudSync.test.ts`

**Interfaces:**
- Consumes: `fetchCloudDocument`, `pushDocument`, `replayPendingWrite` (Task 7); `accountsConfigured()` (`@/lib/env`, already shipped).
- Produces: new `TrousseauState` fields `cloudStatus`, `cloudConflict`, `cloudVersion`; new actions `syncToCloud`, `resolveConflictKeepMine`, `resolveConflictTakeTheirs` — consumed by `DataManager.tsx`.

This is the only task that touches the existing local-first store, and the
change is additive: every new field defaults to a value that makes cloud
sync a no-op unless a caller explicitly starts it, so the no-account
local-only mode (Global Constraint) is unaffected by construction, not by
a runtime check added in every code path.

- [ ] **Step 1: Add cloud-sync state and actions to `useTrousseauStore.ts`**

Add to `suite/lib/store/useTrousseauStore.ts`. Read the existing file in
full first (already read as part of this plan's research — the additions
below slot in next to `TrousseauState`, `replaceDocument`, and
`schedulePersist`).

Add a static import alongside the file's existing top-of-file imports
(`idb-keyval` is already imported statically there for the same kind of
browser-only functionality, so this follows the file's own precedent
rather than reaching for a dynamic `import()`):

```ts
import {
  fetchCloudDocument,
  pushDocument,
  replayPendingWrite,
  type PushResult,
} from "@/lib/documents/cloudSync";
```

Add to the `TrousseauState` interface:

```ts
  /**
   * `"disabled"` until `startCloudSync()` runs (accounts configured and the
   * caller has a wedding) — every other state is only reachable after that.
   */
  cloudStatus: "disabled" | "idle" | "syncing" | "queued" | "conflict" | "error";
  cloudError: string | null;
  /** The version this device last confirmed the cloud holds, or null before the first sync. */
  cloudVersion: number | null;
  /** Set when a write was rejected as a conflict — surfaced, never auto-merged. */
  cloudConflict: { document: unknown; version: number } | null;

  /** Called once, after local hydration, when accounts + a wedding are both available. */
  startCloudSync: () => Promise<void>;
  /** Push the current document now. Called after every local write, and on reconnect for the queue. */
  syncToCloud: () => Promise<void>;
  /** Discard the local change, adopt the cloud's version. */
  resolveConflictTakeTheirs: () => void;
  /** Overwrite the cloud with the local document, at the cloud's own version — a deliberate second attempt, not a merge. */
  resolveConflictKeepMine: () => Promise<void>;
```

Add to the store body (after `redo`):

```ts
  cloudStatus: "disabled",
  cloudError: null,
  cloudVersion: null,
  cloudConflict: null,

  startCloudSync: async () => {
    set({ cloudStatus: "syncing" });
    const result = await fetchCloudDocument();
    if (!result.ok) {
      // "unavailable" covers both "accounts not configured" and "no wedding
      // yet" — either way, cloud sync simply does not start, and local-only
      // behavior continues exactly as it already does.
      set({ cloudStatus: result.reason === "unreachable" ? "error" : "disabled" });
      return;
    }
    if (result.document !== null) {
      get().replaceDocument(result.document, { silent: true });
    }
    set({ cloudStatus: "idle", cloudVersion: result.version, cloudError: null });

    const replay = await replayPendingWrite();
    if (replay) applyCloudResult(replay);
  },

  syncToCloud: async () => {
    const state = get();
    if (state.cloudStatus === "disabled") return;
    set({ cloudStatus: "syncing" });
    const result = await pushDocument(state.raw, state.cloudVersion ?? 0);
    applyCloudResult(result);
  },

  resolveConflictTakeTheirs: () => {
    const conflict = get().cloudConflict;
    if (!conflict) return;
    get().replaceDocument(conflict.document, { silent: true });
    set({ cloudStatus: "idle", cloudVersion: conflict.version, cloudConflict: null });
  },

  resolveConflictKeepMine: async () => {
    const conflict = get().cloudConflict;
    if (!conflict) return;
    set({ cloudConflict: null, cloudStatus: "syncing" });
    const result = await pushDocument(get().raw, conflict.version);
    applyCloudResult(result);
  },
```

`replaceDocument` gains an options parameter, matching `setSlice`'s
existing `WriteOptions` shape — update its signature and implementation:

```ts
  replaceDocument: (next: unknown, options?: WriteOptions) => void;
```

```ts
  replaceDocument: (next, options = {}) => {
    const state = get();
    const raw = promoteSources(asRecord(next)).raw;
    set({
      status: "ready",
      error: null,
      raw,
      doc: migrate(raw),
      generation: state.generation + 1,
      past:
        !options.silent && state.status === "ready"
          ? pushHistory(state.past, state.raw, options.label ?? "restore")
          : state.past,
      future: options.silent ? state.future : [],
    });
    schedulePersist(raw);
  },
```

Add a module-level helper below `schedulePersist` (not exported — internal
plumbing shared by `startCloudSync`/`syncToCloud`/`resolveConflictKeepMine`):

```ts
function applyCloudResult(result: PushResult): void {
  if (result.ok) {
    useTrousseauStore.setState({ cloudStatus: "idle", cloudVersion: result.version, cloudConflict: null, cloudError: null });
    return;
  }
  if (result.reason === "conflict") {
    useTrousseauStore.setState({ cloudStatus: "conflict", cloudConflict: { document: result.document, version: result.version } });
    return;
  }
  if (result.reason === "queued") {
    useTrousseauStore.setState({ cloudStatus: "queued" });
    return;
  }
  if (result.reason === "invalid") {
    useTrousseauStore.setState({
      cloudStatus: "error",
      cloudError: `This wedding could not be saved to the cloud: ${result.errors.join("; ")}`,
    });
    return;
  }
  useTrousseauStore.setState({ cloudStatus: "error", cloudError: "The cloud could not be reached." });
}
```

Finally, call `syncToCloud()` from `schedulePersist`'s existing success
path — after the local `idbSet` resolves, so a cloud push is only ever
attempted once the local write (the source of truth of record if the cloud
is unreachable) has actually landed:

```ts
      void idbSet(STORAGE_KEY, raw).then(() => {
        useTrousseauStore.setState({ savedAt: new Date().toISOString(), error: null });
        void useTrousseauStore.getState().syncToCloud();
      }, noted);
```

- [ ] **Step 2: Start cloud sync from `StoreHydrator.tsx`, after local hydration**

Modify `suite/lib/store/StoreHydrator.tsx`:

```ts
"use client";

import { useEffect } from "react";
import { reconcileLoadedDocument } from "@/lib/seating/normalise";
import { useTrousseauStore } from "./useTrousseauStore";

export function StoreHydrator() {
  const hydrate = useTrousseauStore((s) => s.hydrate);
  const startCloudSync = useTrousseauStore((s) => s.startCloudSync);
  useEffect(() => {
    void hydrate()
      .then(reconcileLoadedDocument)
      .then(() => startCloudSync());
  }, [hydrate, startCloudSync]);
  return null;
}
```

- [ ] **Step 3: Replay the queue on reconnect**

Still in `StoreHydrator.tsx`, add a `window` `online` listener in the same
effect (guarded the same way `schedulePersist` already guards
`typeof window === "undefined"`, since this file is also imported by
non-browser tests):

```ts
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => void useTrousseauStore.getState().syncToCloud();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
```

- [ ] **Step 4: Write a test for the cloud-sync wiring**

Create `suite/lib/store/useTrousseauStore.cloudSync.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("idb-keyval", () => ({
  get: async () => undefined,
  set: async () => undefined,
  del: async () => undefined,
}));

const pushDocumentMock = vi.fn();
const fetchCloudDocumentMock = vi.fn();
vi.mock("@/lib/documents/cloudSync", () => ({
  fetchCloudDocument: (...args: unknown[]) => fetchCloudDocumentMock(...args),
  pushDocument: (...args: unknown[]) => pushDocumentMock(...args),
  replayPendingWrite: async () => null,
}));

const { useTrousseauStore } = await import("./useTrousseauStore");
const { emptyTrousseau } = await import("@jfrusher/trousseau");

beforeEach(() => {
  pushDocumentMock.mockReset();
  fetchCloudDocumentMock.mockReset();
  const doc = emptyTrousseau();
  useTrousseauStore.setState({
    status: "ready",
    error: null,
    raw: doc as unknown as Record<string, unknown>,
    doc,
    cloudStatus: "disabled",
    cloudVersion: null,
    cloudConflict: null,
    cloudError: null,
  });
});

test("startCloudSync stays disabled when the cloud reports unavailable", async () => {
  fetchCloudDocumentMock.mockResolvedValue({ ok: false, reason: "unavailable" });
  await useTrousseauStore.getState().startCloudSync();
  expect(useTrousseauStore.getState().cloudStatus).toBe("disabled");
});

test("startCloudSync adopts the cloud document without creating an undo entry", async () => {
  fetchCloudDocumentMock.mockResolvedValue({ ok: true, document: emptyTrousseau(), version: 4 });
  await useTrousseauStore.getState().startCloudSync();
  const state = useTrousseauStore.getState();
  expect(state.cloudStatus).toBe("idle");
  expect(state.cloudVersion).toBe(4);
  expect(state.past).toEqual([]);
});

test("a rejected write surfaces as a conflict, not an auto-merge", async () => {
  useTrousseauStore.setState({ cloudStatus: "idle", cloudVersion: 1 });
  pushDocumentMock.mockResolvedValue({ ok: false, reason: "conflict", version: 2, document: { event: { coupleNames: "theirs" } } });
  await useTrousseauStore.getState().syncToCloud();
  const state = useTrousseauStore.getState();
  expect(state.cloudStatus).toBe("conflict");
  expect(state.cloudConflict).toEqual({ document: { event: { coupleNames: "theirs" } }, version: 2 });
});

test("resolveConflictTakeTheirs adopts the cloud document and clears the conflict", () => {
  useTrousseauStore.setState({
    cloudStatus: "conflict",
    cloudConflict: { document: emptyTrousseau(), version: 7 },
  });
  useTrousseauStore.getState().resolveConflictTakeTheirs();
  const state = useTrousseauStore.getState();
  expect(state.cloudConflict).toBeNull();
  expect(state.cloudVersion).toBe(7);
  expect(state.cloudStatus).toBe("idle");
});
```

- [ ] **Step 5: Run the new test file**

Run: `npx vitest run --project suite lib/store/useTrousseauStore.cloudSync.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Run the full existing store test suite to confirm nothing regressed**

Run: `npx vitest run --project suite lib/store`
Expected: PASS (every existing file, including `persistFailure.test.ts`, `history.test.ts`, `migrateKeys.test.ts`, `useTrousseauStore.test.ts`)

- [ ] **Step 7: Add a minimal "Cloud" section to `DataManager.tsx`**

Modify `suite/components/shell/DataManager.tsx`. Add these two imports near
the top:

```ts
import { AlertTriangle, CloudOff, Download, FileUp, RefreshCw, Upload, X } from "lucide-react";
```

(Replacing the existing `lucide-react` import line — `RefreshCw` and
`CloudOff` are additions to it, `AlertTriangle` etc. stay.)

Inside `Body`, alongside the other `useTrousseauStore` selectors:

```ts
  const cloudStatus = useTrousseauStore((s) => s.cloudStatus);
  const cloudError = useTrousseauStore((s) => s.cloudError);
  const cloudConflict = useTrousseauStore((s) => s.cloudConflict);
  const resolveConflictTakeTheirs = useTrousseauStore((s) => s.resolveConflictTakeTheirs);
  const resolveConflictKeepMine = useTrousseauStore((s) => s.resolveConflictKeepMine);
```

Add a new `<Section>` after the existing `"Sharing"` section (before
`"Guest list"`), only rendered once cloud sync is actually relevant:

```tsx
      {cloudStatus !== "disabled" ? (
        <Section title="Cloud">
          {cloudStatus === "conflict" && cloudConflict ? (
            <div>
              <p className="mb-3 text-sm text-slate">
                Someone else saved a change to this wedding from another device. Choose which
                version to keep — nothing is merged automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                <Action onClick={resolveConflictTakeTheirs} icon={RefreshCw} primary>
                  Use their version
                </Action>
                <Action onClick={() => void resolveConflictKeepMine()} icon={Upload}>
                  Keep mine and overwrite theirs
                </Action>
              </div>
            </div>
          ) : cloudStatus === "queued" ? (
            <p className="flex items-center gap-2 text-sm text-slate">
              <CloudOff size={16} /> You&rsquo;re offline. Changes will sync once you&rsquo;re back online.
            </p>
          ) : cloudStatus === "error" ? (
            <p className="text-sm text-slate">{cloudError ?? "The cloud could not be reached."}</p>
          ) : (
            <p className="text-sm text-slate">Synced to your account.</p>
          )}
        </Section>
      ) : null}
```

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add suite/lib/store/useTrousseauStore.ts suite/lib/store/StoreHydrator.tsx suite/components/shell/DataManager.tsx suite/lib/store/useTrousseauStore.cloudSync.test.ts
git commit -m "Wire offline-aware cloud sync into the local-first store and the Data Manager UI"
```

---

## Task 9: Full regression check

**Files:** none created or modified — verification only.

**Interfaces:** none.

The spec's explicit regression requirement: `suite/lib/sync/`'s existing
test suite (the `/seat/[token]` backend) must pass completely unmodified,
proving this plan never touched it. This task also runs everything else
once, together, the way it will actually ship.

- [ ] **Step 1: Confirm `suite/lib/sync/`'s implementation was never touched**

Run: `git diff --stat main -- suite/lib/sync/ ':(exclude)suite/lib/sync/migrations.test.ts' supabase/migrations/20260830000001_suite_sync.sql supabase/migrations/20260830000002_suite_sync_fixes.sql supabase/migrations/20260901000001_delete_wedding.sql supabase/migrations/20260901000002_retention.sql supabase/migrations/20260901000003_storage_budget.sql`
Expected: empty output — no changes to any file in this list.

`migrations.test.ts` is excluded, and this is not a loophole around the
spec's regression requirement. That file holds one assertion that is a
repo-wide inventory rather than a test of the sync backend: it applies
*every* migration in `supabase/migrations/` and asserts the full list of
tables that results, as its own comment says. Task 1 adds a migration, so
the list gains two names. Nothing about the `/seat/[token]` backend's
behaviour changes, and no other assertion in the file moves.

The precedent is exact: subsystem A hit the same thing and resolved it the
same way in `94d7984`, which added `account_weddings`, `invites` and
`wedding_members` to this identical list. Any future migration that creates
a table will do this again — that is the assertion working, not failing.

Step 2 below is what actually proves the backend is unharmed: the sync
suite passes with its test count unchanged.

- [ ] **Step 2: Run the sync suite specifically**

Run: `npx vitest run --project suite lib/sync`
Expected: PASS, same test count as on `main` before this plan started.

- [ ] **Step 3: Run the full suite test project**

Run: `npx vitest run --project suite`
Expected: PASS, no unrelated failures.

- [ ] **Step 4: Run the root contract package's tests**

Run: `npm test`
Expected: PASS (unaffected by this plan, but confirms the workspace as a
whole is healthy before this branch is reviewed).

- [ ] **Step 5: Type-check the whole `suite` project**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no new errors. (Subsystem A's ledger records two pre-existing,
unrelated tsc errors already present on `main` — `app/layout.tsx`'s
`LayoutProps` and `env.test.ts`'s `NODE_ENV` assignment via
`vi.stubEnv` — confirm the error count matches that known baseline, not a
higher one.)

- [ ] **Step 6: Build**

Run: `npx next build` (from `suite/`)
Expected: builds clean.

- [ ] **Step 7: Commit if Step 5 required no changes; otherwise fix and re-verify first**

If every check above passed with no code changes, there is nothing to
commit for this task — it is a verification gate, and the branch is ready
for the final whole-branch review. If any check failed, fix the issue,
re-run the specific check that failed, then re-run Steps 1-6 in full before
considering this task complete.

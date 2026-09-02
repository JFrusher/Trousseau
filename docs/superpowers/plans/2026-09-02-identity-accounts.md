# Identity & Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a couple sign up with Supabase Auth (email + magic link), create a
wedding, invite their partner to share it, and delete their account safely —
as an entirely opt-in addition alongside the existing no-account local-only
mode, which is untouched.

**Architecture:** Three new Postgres tables (`account_weddings`,
`wedding_members`, `invites`) plus four `security definer` SQL functions that
do every multi-step mutation atomically (`create_wedding`, `create_invite`,
`accept_invite`, `delete_my_account`) — the same pattern this codebase already
uses for `put_slice` in `supabase/migrations/20260830000001_suite_sync.sql`.
Application code is a thin `AccountsStore` interface (real Postgres + an
in-memory fake for tests) behind pure handler functions, mirroring
`suite/lib/sync/`'s existing `store.ts`/`handlers.ts` split exactly. Auth
itself is Supabase's own magic-link flow via `@supabase/ssr`, not custom code.

**Tech Stack:** Next.js App Router (`suite/`), `@supabase/supabase-js`
(already a dependency), `@supabase/ssr` (new dependency, added in Task 1),
`@electric-sql/pglite` (already a dependency, used for real-Postgres RLS/SQL
function tests), Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-09-02-identity-accounts-design.md`

## Global Constraints

- Accounts are entirely opt-in. Nothing in this plan may change the behavior
  of the app when `SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are unset —
  it must keep working exactly as it does today, local-only, no account
  (confirmed with the maintainer before this plan was written — see the
  roadmap's decisions log).
- One active wedding per account for v1 (`wedding_members.user_id` is its
  own primary key, not part of a composite one — see Task 2).
- A wedding is capped at two members, enforced in `create_invite`/
  `accept_invite`, not a schema constraint (per the spec: a product rule
  that may loosen later, not a structural one).
- Every mutation that touches more than one row happens in a `security
  definer` SQL function, not sequential client calls — the existing
  `put_slice` function is the precedent, specifically to avoid partial
  writes.
- Long-lived sessions, no custom expiry (Supabase's default refresh-token
  behavior, untouched).
- No password ever exists anywhere in this system.
- Every SQL migration file is additive-only in this plan — nothing in
  `supabase/migrations/2026083*.sql` or `202609010*.sql` (the E2E sync
  tables) is modified.

---

## Task 1: Dependency and environment plumbing

**Files:**
- Modify: `suite/package.json` (add `@supabase/ssr`)
- Modify: `suite/lib/env.ts`
- Modify: `suite/lib/env.test.ts`

**Interfaces:**
- Produces: `env().SUPABASE_URL` (already exists), `env().NEXT_PUBLIC_SUPABASE_ANON_KEY: string | undefined`, `accountsConfigured(): boolean` — exported from `@/lib/env`, used by every later task to decide whether the accounts feature is reachable at all.

- [ ] **Step 1: Add the dependency**

Run: `npm install @supabase/ssr --workspace=suite`

- [ ] **Step 2: Write the failing env tests**

Add to `suite/lib/env.test.ts` (alongside the existing `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` tests — read the existing file first for the
exact `parseEnv({...})` calling convention used there):

```ts
test("NEXT_PUBLIC_SUPABASE_ANON_KEY is optional, like the rest of Supabase config", () => {
  const result = parseEnv({ NODE_ENV: "production" });
  expect(result.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBeUndefined();
});

test("accountsConfigured is false with no Supabase config", () => {
  cached = undefined; // if env.ts memoises via a module-level `cached` var reachable from the test; otherwise re-import per existing test pattern
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
  process.env.SUPABASE_URL = "";
  expect(accountsConfigured()).toBe(false);
});

test("accountsConfigured is true once SUPABASE_URL and the anon key are both set", () => {
  const result = parseEnv({
    NODE_ENV: "production",
    SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
  });
  expect(result.SUPABASE_URL).toBe("https://example.supabase.co");
  expect(result.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("anon-key-value");
});
```

Check the existing test file's actual pattern for testing memoised `env()`
vs. the exported pure `parseEnv()` — follow whichever one the file already
uses for `syncConfigured()`, and write `accountsConfigured()`'s test the
same way.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --project suite lib/env.test.ts`
Expected: FAIL — `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `accountsConfigured` don't exist yet.

- [ ] **Step 4: Add the field and the gate function**

In `suite/lib/env.ts`, add to the zod `schema` object (near
`SUPABASE_SERVICE_ROLE_KEY`):

```ts
/**
 * Public by design — Supabase's anon key identifies a project and is safe to
 * ship to the browser; it is what lets the client SDK call Supabase Auth
 * directly (magic-link sign-in) without a round trip through this server.
 */
NEXT_PUBLIC_SUPABASE_ANON_KEY: absent(z.string().min(1)),
```

Add a new exported function near `syncConfigured()`:

```ts
/** Whether this deployment has accounts/sign-in available at all. */
export function accountsConfigured(): boolean {
  const { SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = env();
  return Boolean(SUPABASE_URL && NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```

Do **not** add this field to the existing `superRefine` all-or-nothing check
that pairs `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — the anon key is a
separate, independently optional feature gate (a deployment could have
sync configured without accounts, or vice versa), not a third leg of that
same pair.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project suite lib/env.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add suite/package.json suite/package-lock.json suite/lib/env.ts suite/lib/env.test.ts
git commit -m "Add @supabase/ssr and an independent accountsConfigured() env gate"
```

---

## Task 2: The accounts migration — tables, RLS, and SQL functions

**Files:**
- Create: `supabase/migrations/20260902000001_accounts.sql`
- Create: `suite/lib/accounts/migrations.test.ts`

**Interfaces:**
- Produces (SQL, called from `suite/lib/accounts/supabaseStore.ts` in Task 6): `select public.create_wedding()` → `uuid`; `select * from public.create_invite(p_wedding_id uuid, p_invited_email text)` → one row `(id uuid, token text, expires_at timestamptz)`; `select * from public.accept_invite(p_token text)` → one row `(accepted boolean, reason text, wedding_id uuid)`; `select public.delete_my_account()` → `void`.

This is the highest-value task to get right — it's where the actual access
rules live, and (per the audit) SQL is where this codebase's real bugs have
lived before. Follow `suite/lib/sync/migrations.test.ts`'s exact pattern:
PGlite, real migrations run in order, real `plpgsql`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260902000001_accounts.sql`:

```sql
-- Accounts: real Supabase Auth users owning a wedding, entirely separate from
-- the E2E-encrypted passphrase-based sharing in 20260830000001_suite_sync.sql.
-- That system's own `weddings` table is untouched and unrelated to this one —
-- this is `account_weddings`, deliberately not `weddings`, because the name
-- was already taken by a different bounded context before this table existed.

create table if not exists public.account_weddings (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- One row per user, ever — not one row per (wedding, user). A user's row IS
-- their one active wedding for v1: `user_id` alone is the primary key, so a
-- second `create_wedding()` call for the same user fails on this constraint
-- rather than needing separate application logic to forbid it.
create table if not exists public.wedding_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  wedding_id uuid not null references public.account_weddings (id) on delete cascade,
  joined_at  timestamptz not null default now()
);

create table if not exists public.invites (
  id            uuid primary key default gen_random_uuid(),
  wedding_id    uuid not null references public.account_weddings (id) on delete cascade,
  invited_email text not null,
  token         text not null unique,
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  accepted_at   timestamptz
);

alter table public.account_weddings enable row level security;
alter table public.wedding_members  enable row level security;
alter table public.invites          enable row level security;

-- Every mutation goes through a function below; direct table access from the
-- client is read-only, and only for what a member is allowed to see.
grant select on public.account_weddings to authenticated;
grant select on public.wedding_members  to authenticated;
grant select on public.invites          to authenticated;
revoke insert, update, delete on public.account_weddings from authenticated;
revoke insert, update, delete on public.wedding_members  from authenticated;
revoke insert, update, delete on public.invites          from authenticated;
revoke all on public.account_weddings from anon;
revoke all on public.wedding_members  from anon;
revoke all on public.invites          from anon;

create policy "members can read their own wedding"
  on public.account_weddings for select
  using (
    exists (
      select 1 from public.wedding_members m
       where m.wedding_id = account_weddings.id and m.user_id = auth.uid()
    )
  );

create policy "members can read their wedding's membership"
  on public.wedding_members for select
  using (
    exists (
      select 1 from public.wedding_members m2
       where m2.wedding_id = wedding_members.wedding_id and m2.user_id = auth.uid()
    )
  );

create policy "a user can read invites they created"
  on public.invites for select
  using (created_by = auth.uid());

/**
 * Create a wedding for the calling user and make them its first member, in
 * one statement. Two separate inserts from application code risked an
 * `account_weddings` row with nobody in it if the second failed.
 *
 * Fails with a unique-violation on `wedding_members`'s primary key if the
 * caller already has a wedding — the one-wedding-per-account-for-v1 rule
 * enforced by the schema itself, not re-checked here.
 */
create or replace function public.create_wedding()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wedding_id uuid;
begin
  insert into public.account_weddings default values returning id into v_wedding_id;
  insert into public.wedding_members (user_id, wedding_id) values (auth.uid(), v_wedding_id);
  return v_wedding_id;
end;
$$;

/**
 * Invite a partner. Only an existing member of the wedding may call this,
 * and only while the wedding has room for one more.
 */
create or replace function public.create_invite(p_wedding_id uuid, p_invited_email text)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_count integer;
  v_id uuid;
  v_token text;
  v_expires timestamptz;
begin
  if not exists (
    select 1 from public.wedding_members m
     where m.wedding_id = p_wedding_id and m.user_id = auth.uid()
  ) then
    raise exception 'not a member of that wedding' using errcode = '42501';
  end if;

  select count(*) into v_member_count
    from public.wedding_members m
   where m.wedding_id = p_wedding_id;

  if v_member_count >= 2 then
    raise exception 'wedding already has two members' using errcode = 'P0001';
  end if;

  v_token := encode(gen_random_bytes(16), 'hex');
  v_expires := now() + interval '14 days';

  insert into public.invites (wedding_id, invited_email, token, created_by, expires_at)
  values (p_wedding_id, lower(p_invited_email), v_token, auth.uid(), v_expires)
  returning invites.id, invites.token, invites.expires_at into v_id, v_token, v_expires;

  return query select v_id, v_token, v_expires;
end;
$$;

/**
 * Accept an invite as the calling (already-authenticated) user.
 *
 * Every rejection reason is returned, not raised, so the caller can show the
 * specific one — "this invite was sent to X", "that invite has expired",
 * "that invite was already used", "that wedding is full" — rather than a
 * generic failure. `accepted = false` with a `reason` is the normal shape of
 * "no" here; an exception is reserved for the invite simply not existing.
 */
create or replace function public.accept_invite(p_token text)
returns table (accepted boolean, reason text, wedding_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites%rowtype;
  v_caller_email text;
  v_member_count integer;
begin
  select * into v_invite from public.invites where token = p_token;
  if not found then
    raise exception 'no such invite' using errcode = 'P0002';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  if v_invite.accepted_at is not null then
    return query select false, 'already-accepted', v_invite.wedding_id;
    return;
  end if;

  if v_invite.expires_at < now() then
    return query select false, 'expired', v_invite.wedding_id;
    return;
  end if;

  if lower(v_caller_email) <> v_invite.invited_email then
    return query select false, 'wrong-email', v_invite.wedding_id;
    return;
  end if;

  select count(*) into v_member_count
    from public.wedding_members m
   where m.wedding_id = v_invite.wedding_id;

  if v_member_count >= 2 then
    return query select false, 'wedding-full', v_invite.wedding_id;
    return;
  end if;

  insert into public.wedding_members (user_id, wedding_id) values (auth.uid(), v_invite.wedding_id);
  update public.invites set accepted_at = now() where token = p_token;

  return query select true, null::text, v_invite.wedding_id;
end;
$$;

/**
 * Remove the caller from their wedding, deleting the wedding itself if that
 * was its last member. Does not delete the `auth.users` row — the caller
 * (an API route with the service-role key) does that separately via the
 * Supabase Admin API, which is the supported way to remove a user without
 * leaving Auth-internal state (refresh tokens, identities) inconsistent.
 */
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wedding_id uuid;
  v_remaining integer;
begin
  select wedding_id into v_wedding_id from public.wedding_members where user_id = auth.uid();
  if v_wedding_id is null then
    return;
  end if;

  delete from public.wedding_members where user_id = auth.uid();

  select count(*) into v_remaining from public.wedding_members where wedding_id = v_wedding_id;
  if v_remaining = 0 then
    delete from public.account_weddings where id = v_wedding_id;
  end if;
end;
$$;

grant execute on function public.create_wedding() to authenticated;
grant execute on function public.create_invite(uuid, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
```

- [ ] **Step 2: Write the failing migration test**

Create `suite/lib/accounts/migrations.test.ts`. This needs a minimal `auth`
schema stub, since PGlite has no real Supabase Auth — read
`suite/lib/sync/migrations.test.ts` in full first and copy its
`databaseWith()`/role-creation pattern exactly, then extend it:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, expect, test, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SYNC_MIGRATION = join(process.cwd(), "..", "supabase", "migrations", "20260830000001_suite_sync.sql");
const ACCOUNTS_MIGRATION = join(process.cwd(), "..", "supabase", "migrations", "20260902000001_accounts.sql");

/**
 * A minimal stand-in for Supabase's own `auth` schema: just enough for
 * `auth.uid()`, `auth.users`, and the foreign keys this migration's tables
 * hold against it. Real Supabase provides all of this; PGlite does not.
 */
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
  // The sync migration's tables are not used by these tests, but the accounts
  // migration must apply cleanly alongside it, the way Supabase applies every
  // migration file in order against one real database.
  await db.exec(readFileSync(SYNC_MIGRATION, "utf8"));
  await db.exec(readFileSync(ACCOUNTS_MIGRATION, "utf8"));
  return db;
}

let db: PGlite;

/** Insert a fake authenticated user and make them the current session's caller. */
async function userExists(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

async function asUser(id: string): Promise<void> {
  await db.exec("set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
}

async function asSuperuser(): Promise<void> {
  await db.exec("reset role;");
}

beforeEach(async () => {
  db = await databaseWith();
});

test("a user can create a wedding and becomes its member", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);

  const { rows } = await db.query<{ create_wedding: string }>("select create_wedding()");
  const weddingId = rows[0]?.create_wedding;
  expect(weddingId).toBeTruthy();

  const membership = await db.query("select * from wedding_members where user_id = $1", [alice]);
  expect(membership.rows).toHaveLength(1);
});

test("a user cannot create a second wedding", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  await db.query("select create_wedding()");

  await expect(db.query("select create_wedding()")).rejects.toThrow();
});

test("a non-member cannot read someone else's wedding", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const { rows } = await db.query<{ create_wedding: string }>("select create_wedding()");
  const weddingId = rows[0]?.create_wedding;

  const bob = await userExists("bob@example.com");
  await asUser(bob);
  const seen = await db.query("select * from account_weddings where id = $1", [weddingId]);
  expect(seen.rows).toHaveLength(0);
});

test("a full invite-and-accept flow adds the invited user as a member", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const created = await db.query<{ create_wedding: string }>("select create_wedding()");
  const weddingId = created.rows[0]?.create_wedding;

  const invite = await db.query<{ id: string; token: string }>(
    "select * from create_invite($1, $2)",
    [weddingId, "bob@example.com"],
  );
  const token = invite.rows[0]?.token;

  const bob = await userExists("bob@example.com");
  await asUser(bob);
  const accepted = await db.query<{ accepted: boolean; reason: string | null; wedding_id: string }>(
    "select * from accept_invite($1)",
    [token],
  );
  expect(accepted.rows[0]?.accepted).toBe(true);
  expect(accepted.rows[0]?.wedding_id).toBe(weddingId);

  const membership = await db.query("select * from wedding_members where wedding_id = $1", [weddingId]);
  expect(membership.rows).toHaveLength(2);
});

test("accepting with the wrong email is rejected with a specific reason", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const created = await db.query<{ create_wedding: string }>("select create_wedding()");
  const weddingId = created.rows[0]?.create_wedding;
  const invite = await db.query<{ token: string }>("select * from create_invite($1, $2)", [
    weddingId,
    "bob@example.com",
  ]);

  const eve = await userExists("eve@example.com");
  await asUser(eve);
  const result = await db.query<{ accepted: boolean; reason: string }>(
    "select * from accept_invite($1)",
    [invite.rows[0]?.token],
  );
  expect(result.rows[0]?.accepted).toBe(false);
  expect(result.rows[0]?.reason).toBe("wrong-email");
});

test("a third invite is refused once the wedding already has two members", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const created = await db.query<{ create_wedding: string }>("select create_wedding()");
  const weddingId = created.rows[0]?.create_wedding;
  const firstInvite = await db.query<{ token: string }>("select * from create_invite($1, $2)", [
    weddingId,
    "bob@example.com",
  ]);
  const bob = await userExists("bob@example.com");
  await asUser(bob);
  await db.query("select * from accept_invite($1)", [firstInvite.rows[0]?.token]);

  await asUser(alice);
  await expect(
    db.query("select * from create_invite($1, $2)", [weddingId, "carol@example.com"]),
  ).rejects.toThrow();
});

test("deleting the last member removes the wedding entirely", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const created = await db.query<{ create_wedding: string }>("select create_wedding()");
  const weddingId = created.rows[0]?.create_wedding;

  await db.query("select delete_my_account()");

  await asSuperuser();
  const remaining = await db.query("select * from account_weddings where id = $1", [weddingId]);
  expect(remaining.rows).toHaveLength(0);
});

test("deleting one of two members leaves the wedding intact for the other", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const created = await db.query<{ create_wedding: string }>("select create_wedding()");
  const weddingId = created.rows[0]?.create_wedding;
  const invite = await db.query<{ token: string }>("select * from create_invite($1, $2)", [
    weddingId,
    "bob@example.com",
  ]);
  const bob = await userExists("bob@example.com");
  await asUser(bob);
  await db.query("select * from accept_invite($1)", [invite.rows[0]?.token]);

  await db.query("select delete_my_account()"); // bob leaves

  await asUser(alice);
  const stillThere = await db.query("select * from account_weddings where id = $1", [weddingId]);
  expect(stillThere.rows).toHaveLength(1);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --project suite lib/accounts/migrations.test.ts`
Expected: FAIL — the migration file doesn't exist yet.

- [ ] **Step 4: Confirm the migration file from Step 1 is saved, then run tests**

Run: `npx vitest run --project suite lib/accounts/migrations.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260902000001_accounts.sql suite/lib/accounts/migrations.test.ts
git commit -m "Add the accounts schema: account_weddings, wedding_members, invites"
```

---

## Task 3: `AccountsStore` interface and in-memory fake

**Files:**
- Create: `suite/lib/accounts/store.ts`

**Interfaces:**
- Consumes: nothing (this is the foundation the rest of `lib/accounts/` is built on).
- Produces: `AccountsStore` interface, `memoryStore(): AccountsStore`, `WeddingRecord`, `MemberRecord`, `InviteRecord` — all imported by `handlers.ts` (Task 5) and `supabaseStore.ts` (Task 6).

- [ ] **Step 1: Write the store interface and in-memory implementation**

```ts
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

export type AcceptReason = "wrong-email" | "expired" | "already-accepted" | "wedding-full";

export interface AcceptResult {
  accepted: boolean;
  reason: AcceptReason | null;
  weddingId: string | null;
}

export interface AccountsStore {
  /** Throws if the caller already has a wedding. */
  createWedding(userId: string): Promise<WeddingRecord>;
  memberOf(userId: string): Promise<MemberRecord | null>;
  membersOf(weddingId: string): Promise<MemberRecord[]>;
  /** Throws if the caller is not a member of the wedding, or it already has two members. */
  createInvite(weddingId: string, byUserId: string, invitedEmail: string): Promise<InviteRecord>;
  getInvite(token: string): Promise<InviteRecord | null>;
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

    async getInvite(token) {
      return invites.get(token) ?? null;
    },

    async acceptInvite(token, userId) {
      const invite = invites.get(token);
      if (!invite) return { accepted: false, reason: "wedding-full", weddingId: null }; // unreachable in practice; getInvite is checked by the caller first
      if (invite.acceptedAt) return { accepted: false, reason: "already-accepted", weddingId: invite.weddingId };
      if (new Date(invite.expiresAt).getTime() < Date.now()) {
        return { accepted: false, reason: "expired", weddingId: invite.weddingId };
      }
      const callerEmail = (emails.get(userId) ?? "").toLowerCase();
      if (callerEmail !== invite.invitedEmail) {
        return { accepted: false, reason: "wrong-email", weddingId: invite.weddingId };
      }
      const memberCount = [...members.values()].filter((m) => m.weddingId === invite.weddingId).length;
      if (memberCount >= 2) return { accepted: false, reason: "wedding-full", weddingId: invite.weddingId };

      members.set(userId, { userId, weddingId: invite.weddingId, joinedAt: now() });
      invite.acceptedAt = now();
      return { accepted: true, reason: null, weddingId: invite.weddingId };
    },

    async deleteAccount(userId) {
      const member = members.get(userId);
      if (!member) return;
      members.delete(userId);
      const remaining = [...members.values()].some((m) => m.weddingId === member.weddingId);
      if (!remaining) weddings.delete(member.weddingId);
    },

    // test-only seam, not part of the interface real Postgres implements —
    // Task 5's tests call this directly on the object memoryStore() returns.
    _seedEmail(userId: string, email: string) {
      emails.set(userId, email);
    },
  } as AccountsStore & { _seedEmail(userId: string, email: string): void };
}
```

There is no separate test file for this task — `memoryStore()` is exercised
entirely through `handlers.test.ts` in Task 5, the same way
`lib/sync/store.ts`'s in-memory implementation has no test file of its own
and is only exercised via `lib/sync/handlers.test.ts`.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors (this file has no test yet, but must compile).

- [ ] **Step 3: Commit**

```bash
git add suite/lib/accounts/store.ts
git commit -m "Add the AccountsStore interface and in-memory fake"
```

---

## Task 4: Invite email/token validation schemas

**Files:**
- Create: `suite/lib/accounts/schemas.ts`
- Create: `suite/lib/accounts/schemas.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `inviteEmailSchema`, `tokenSchema` (zod schemas), `check()` — reused from `@/lib/sync/schemas` if it's exported there already; if not (check Task's Step 1), copy the same tiny helper rather than importing across an unrelated feature boundary. Used by the API routes in Task 8.

- [ ] **Step 1: Check whether `check()` is already exported for reuse**

Run: `grep -n "^export function check" suite/lib/sync/schemas.ts`

If it is exported and generic (not tied to sync-specific types), import it
from `@/lib/sync/schemas` in Step 2 below instead of redefining it. If it is
not exported or is tied to sync-specific error shapes, define an equivalent
tiny helper locally in `suite/lib/accounts/schemas.ts` — do not create a
cross-feature dependency for a five-line function.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { check, inviteEmailSchema, tokenSchema } from "./schemas";

describe("inviteEmailSchema", () => {
  it("accepts a plain email", () => {
    const result = check(inviteEmailSchema, { email: "partner@example.com" });
    expect(result.ok).toBe(true);
  });

  it("rejects something that is not an email", () => {
    const result = check(inviteEmailSchema, { email: "not-an-email" });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing email field", () => {
    const result = check(inviteEmailSchema, {});
    expect(result.ok).toBe(false);
  });
});

describe("tokenSchema", () => {
  it("accepts the hex shape create_invite actually produces", () => {
    const result = check(tokenSchema, "a1b2c3d4e5f60718293a4b5c6d7e8f90");
    expect(result.ok).toBe(true);
  });

  it("rejects a token with disallowed characters", () => {
    const result = check(tokenSchema, "../../etc/passwd");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty token", () => {
    const result = check(tokenSchema, "");
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --project suite lib/accounts/schemas.test.ts`
Expected: FAIL — `./schemas` doesn't exist yet.

- [ ] **Step 4: Write the schemas**

```ts
import { z } from "zod";

/** Same shape as `lib/sync/schemas.ts`'s `check()` — see that file if this needs changing. */
export type CheckResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function check<T>(schema: z.ZodType<T>, input: unknown): CheckResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? "That was not valid." };
}

export const inviteEmailSchema = z.object({
  weddingId: z.uuid(),
  email: z.email("That does not look like an email address."),
});

/** `create_invite`'s token: `encode(gen_random_bytes(16), 'hex')` — 32 hex characters. */
export const tokenSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-f0-9]+$/, "That is not an invite token.");
```

(Only redefine `check`/`CheckResult` here if Step 1 found it isn't reusable
from `lib/sync/schemas.ts` — otherwise import it from there and omit this
from the file.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project suite lib/accounts/schemas.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add suite/lib/accounts/schemas.ts suite/lib/accounts/schemas.test.ts
git commit -m "Add invite email/token validation schemas"
```

---

## Task 5: Pure handler logic, tested against the in-memory store

**Files:**
- Create: `suite/lib/accounts/handlers.ts`
- Create: `suite/lib/accounts/handlers.test.ts`

**Interfaces:**
- Consumes: `AccountsStore`, `memoryStore()` from `./store` (Task 3); `_seedEmail` test seam on the memory store.
- Produces: `Reply` type, `createWeddingHandler`, `createInviteHandler`, `acceptInviteHandler`, `deleteAccountHandler` — all `(store: AccountsStore, ...) => Promise<Reply>`, called directly by the API routes in Task 8.

This is where every rule from the spec gets its test: max two members,
expired invites, wrong-email rejection, already-accepted rejection,
wedding-full rejection, and both deletion-cascade cases.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project suite lib/accounts/handlers.test.ts`
Expected: FAIL — `./handlers` doesn't exist yet.

- [ ] **Step 3: Write the handlers**

```ts
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
  const invite = await store.getInvite(token);
  if (!invite) return notFound("That invite does not exist.");

  const result = await store.acceptInvite(token, userId);
  if (result.accepted) return ok({ weddingId: result.weddingId });

  const messages: Record<string, string> = {
    "wrong-email": `This invite was sent to ${invite.invitedEmail}. Sign in with that address to accept it.`,
    expired: "That invite has expired. Ask your partner to send a new one.",
    "already-accepted": "That invite was already used.",
    "wedding-full": "That wedding already has two members.",
  };
  return conflict(messages[result.reason ?? ""] ?? "That invite could not be accepted.", {
    reason: result.reason,
  });
}

export async function deleteAccountHandler(store: AccountsStore, userId: string): Promise<Reply> {
  await store.deleteAccount(userId);
  return ok({});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project suite lib/accounts/handlers.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add suite/lib/accounts/handlers.ts suite/lib/accounts/handlers.test.ts
git commit -m "Add pure accounts handlers: create wedding, invite, accept, delete"
```

---

## Task 6: Real Postgres store implementation

**Files:**
- Create: `suite/lib/accounts/supabaseStore.ts`

**Interfaces:**
- Consumes: `AccountsStore`, record types from `./store` (Task 3); a per-request authenticated Supabase client (produced by Task 7, consumed here as a parameter — this file does not create its own client, unlike `lib/sync/supabaseStore.ts`, because every caller here has a different user).
- Produces: `accountsStore(client: SupabaseClient): AccountsStore`, called from every API route in Task 8.

This calls the four SQL functions from Task 2 directly — there is no
separate business logic here to test beyond "does this call the right RPC
with the right arguments and map the result correctly," which the manual
verification in Task 9 covers end-to-end. Task 5's tests already cover every
rule; this file is a thin adapter, matching how `lib/sync/supabaseStore.ts`
has no test file of its own either.

- [ ] **Step 1: Write the implementation**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AcceptResult, AccountsStore, InviteRecord, MemberRecord, WeddingRecord } from "./store";

/**
 * The Postgres implementation, over a caller-scoped client.
 *
 * Unlike `lib/sync/supabaseStore.ts`, which uses one service-role client for
 * every caller (authorization there is a token hash checked by hand), this
 * takes a *different* client per call — one carrying the signed-in user's own
 * session — so Postgres RLS and the `security definer` functions in the
 * accounts migration see the real caller via `auth.uid()`.
 */
export function accountsStore(client: SupabaseClient): AccountsStore {
  return {
    async createWedding(_userId) {
      // `_userId` is unused here deliberately: `create_wedding()` reads
      // `auth.uid()` from the client's own session, not an argument, so a
      // caller can never create a wedding "as" someone else by passing a
      // different id — the parameter exists only to satisfy the shared
      // `AccountsStore` interface the in-memory fake also implements.
      const { data, error } = await client.rpc("create_wedding");
      if (error) throw new Error(error.message);
      return { id: data as string, createdAt: new Date().toISOString() };
    },

    async memberOf(userId) {
      const { data, error } = await client
        .from("wedding_members")
        .select("user_id, wedding_id, joined_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return { userId: data.user_id as string, weddingId: data.wedding_id as string, joinedAt: data.joined_at as string };
    },

    async membersOf(weddingId) {
      const { data, error } = await client
        .from("wedding_members")
        .select("user_id, wedding_id, joined_at")
        .eq("wedding_id", weddingId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        userId: row.user_id as string,
        weddingId: row.wedding_id as string,
        joinedAt: row.joined_at as string,
      }));
    },

    async createInvite(weddingId, _byUserId, invitedEmail) {
      const { data, error } = await client
        .rpc("create_invite", { p_wedding_id: weddingId, p_invited_email: invitedEmail })
        .single();
      if (error) throw new Error(error.message);
      const row = data as { id: string; token: string; expires_at: string };
      return {
        id: row.id,
        weddingId,
        invitedEmail: invitedEmail.toLowerCase(),
        token: row.token,
        createdBy: _byUserId,
        createdAt: new Date().toISOString(),
        expiresAt: row.expires_at,
        acceptedAt: null,
      };
    },

    async getInvite(token) {
      const { data, error } = await client
        .from("invites")
        .select("id, wedding_id, invited_email, token, created_by, created_at, expires_at, accepted_at")
        .eq("token", token)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        weddingId: data.wedding_id as string,
        invitedEmail: data.invited_email as string,
        token: data.token as string,
        createdBy: data.created_by as string,
        createdAt: data.created_at as string,
        expiresAt: data.expires_at as string,
        acceptedAt: data.accepted_at as string | null,
      };
    },

    async acceptInvite(token, _userId) {
      // `_userId` is unused deliberately, same reasoning as `createWedding`
      // above: `accept_invite()` reads the real caller from `auth.uid()`
      // inside the security-definer function, from this client's own
      // session — not from an argument a caller could spoof.
      const { data, error } = await client.rpc("accept_invite", { p_token: token }).single();
      if (error) throw new Error(error.message);
      const row = data as { accepted: boolean; reason: string | null; wedding_id: string | null };
      return {
        accepted: row.accepted,
        reason: row.reason as AcceptResult["reason"],
        weddingId: row.wedding_id,
      };
    },

    async deleteAccount(_userId) {
      const { error } = await client.rpc("delete_my_account");
      if (error) throw new Error(error.message);
    },
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add suite/lib/accounts/supabaseStore.ts
git commit -m "Add the Postgres AccountsStore implementation over a per-request client"
```

---

## Task 7: Supabase SSR client factories

**Files:**
- Create: `suite/lib/accounts/serverClient.ts`
- Create: `suite/lib/accounts/browserClient.ts`

**Interfaces:**
- Consumes: `env()`, `accountsConfigured()` from `@/lib/env` (Task 1).
- Produces: `serverClient(): Promise<SupabaseClient | null>`, `currentUser(): Promise<{ id: string; email: string } | null>` (server-side, cookie-based); `browserClient(): SupabaseClient | null` (client-side) — consumed by Task 8's routes and Task 9's UI.

- [ ] **Step 1: Write the server client**

```ts
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { accountsConfigured, env } from "@/lib/env";

/**
 * A Supabase client carrying the calling request's own session, for use in
 * Route Handlers and Server Components. Returns null when accounts aren't
 * configured on this deployment — every caller must handle that the same way
 * `lib/sync`'s routes handle an unconfigured backend: the feature is simply
 * unavailable, not an error.
 */
export async function serverClient(): Promise<SupabaseClient | null> {
  if (!accountsConfigured()) return null;
  const { SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = env();
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL as string, NEXT_PUBLIC_SUPABASE_ANON_KEY as string, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        for (const { name, value, options } of toSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

/** The signed-in user for this request, or null if there isn't one. */
export async function currentUser(): Promise<{ id: string; email: string } | null> {
  const client = await serverClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  if (!data.user?.email) return null;
  return { id: data.user.id, email: data.user.email };
}
```

- [ ] **Step 2: Write the browser client**

```ts
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * The client-side Supabase client, for calling `signInWithOtp` directly from
 * the browser. `undefined` means "not checked yet"; `null` means "checked,
 * and this deployment has no accounts configured" — kept apart from
 * `serverClient()`'s null check because `env()` (server-only: reads
 * `process.env` directly) cannot run in browser code, so the public env vars
 * are read from `process.env.NEXT_PUBLIC_*` here instead, inlined by Next.js
 * at build time.
 */
export function browserClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createBrowserClient(url, key) : null;
  return client;
}
```

- [ ] **Step 2a: Add the public URL variable**

The server-side `SUPABASE_URL` in `suite/lib/env.ts` is not prefixed
`NEXT_PUBLIC_`, so it is never inlined into browser code — correct for the
service-role path, but the browser client above needs the project URL too
(the anon key is already public; the project URL is equally safe to expose
by design, same reasoning as the existing `NEXT_PUBLIC_SENTRY_DSN`). Add to
`suite/lib/env.ts`'s schema, next to `NEXT_PUBLIC_SUPABASE_ANON_KEY`:

```ts
/** Same value as SUPABASE_URL, duplicated under a NEXT_PUBLIC_ name so the
 *  browser client (which cannot read the server-only env()) can use it. */
NEXT_PUBLIC_SUPABASE_URL: absent(url("NEXT_PUBLIC_SUPABASE_URL")),
```

Update `accountsConfigured()` to also require this:

```ts
export function accountsConfigured(): boolean {
  const { SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = env();
  return Boolean(SUPABASE_URL && NEXT_PUBLIC_SUPABASE_URL && NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```

Add one test to `suite/lib/env.test.ts` confirming `accountsConfigured()` is
still false if only `NEXT_PUBLIC_SUPABASE_URL` is missing while the other two
are set — this is the specific gap Step 2a exists to close, so it needs its
own regression test rather than trusting the earlier all-three-set test to
imply it.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 4: Run the full env test file to confirm Step 2a didn't regress it**

Run: `npx vitest run --project suite lib/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add suite/lib/accounts/serverClient.ts suite/lib/accounts/browserClient.ts suite/lib/env.ts suite/lib/env.test.ts
git commit -m "Add Supabase SSR client factories for server and browser use"
```

---

## Task 8: API routes

**Files:**
- Create: `suite/app/api/accounts/wedding/route.ts`
- Create: `suite/app/api/accounts/invite/route.ts`
- Create: `suite/app/api/accounts/invite/[token]/route.ts`
- Create: `suite/app/api/accounts/delete/route.ts`

**Interfaces:**
- Consumes: `currentUser()`, `serverClient()` (Task 7); `accountsStore()` (Task 6); `createWeddingHandler`, `createInviteHandler`, `acceptInviteHandler`, `deleteAccountHandler` (Task 5); `check`, `inviteEmailSchema`, `tokenSchema` (Task 4).
- Produces: `POST /api/accounts/wedding`, `POST /api/accounts/invite`, `POST /api/accounts/invite/[token]`, `POST /api/accounts/delete` — consumed by Task 9's UI.

- [ ] **Step 1: Write the shared "not signed in" / "not configured" responses**

Add near the top of `suite/app/api/accounts/wedding/route.ts` (this small
helper is duplicated verbatim into the other three route files in this task
rather than extracted to a shared module — four short route files each
importing one four-line local helper is simpler than a fifth file for it):

```ts
import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { createWeddingHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

const unauthenticated = () =>
  NextResponse.json({ error: "Sign in first." }, { status: 401 });

export async function POST() {
  if (!accountsConfigured()) return unconfigured();
  const user = await currentUser();
  if (!user) return unauthenticated();

  const client = await serverClient();
  if (!client) return unconfigured();

  const reply = await createWeddingHandler(accountsStore(client), user.id);
  return NextResponse.json(reply.body, { status: reply.status });
}
```

- [ ] **Step 2: Write the invite-creation route**

`suite/app/api/accounts/invite/route.ts`:

```ts
import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { createInviteHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";
import { check, inviteEmailSchema } from "@/lib/accounts/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unconfigured = () =>
  NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

const unauthenticated = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });

export async function POST(request: Request) {
  if (!accountsConfigured()) return unconfigured();
  const user = await currentUser();
  if (!user) return unauthenticated();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That was not JSON." }, { status: 400 });
  }

  const input = check(inviteEmailSchema, body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const client = await serverClient();
  if (!client) return unconfigured();

  const reply = await createInviteHandler(
    accountsStore(client),
    input.value.weddingId,
    user.id,
    input.value.email,
  );
  if (reply.status !== 200) return NextResponse.json(reply.body, { status: reply.status });

  // Deliver the invite via Supabase's own magic-link email — the same
  // mechanism ordinary sign-in uses, just redirecting to the invite-accept
  // page instead of the default callback. No separate transactional email
  // provider is needed for this.
  const { token } = reply.body as { token: string };
  const { error: sendError } = await client.auth.signInWithOtp({
    email: input.value.email,
    options: { emailRedirectTo: `${new URL(request.url).origin}/invite/${token}` },
  });
  if (sendError) {
    return NextResponse.json({ error: `The invite was created but the email failed to send: ${sendError.message}` }, { status: 502 });
  }

  return NextResponse.json(reply.body, { status: 200 });
}
```

- [ ] **Step 3: Write the invite-acceptance route**

`suite/app/api/accounts/invite/[token]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { accountsConfigured } from "@/lib/env";
import { acceptInviteHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";
import { check, tokenSchema } from "@/lib/accounts/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  if (!accountsConfigured()) {
    return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { token: rawToken } = await context.params;
  const token = check(tokenSchema, rawToken);
  if (!token.ok) return NextResponse.json({ error: token.error }, { status: 400 });

  const client = await serverClient();
  if (!client) return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });

  const reply = await acceptInviteHandler(accountsStore(client), token.value, user.id);
  return NextResponse.json(reply.body, { status: reply.status });
}
```

- [ ] **Step 4: Write the deletion route**

`suite/app/api/accounts/delete/route.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { env, accountsConfigured } from "@/lib/env";
import { deleteAccountHandler } from "@/lib/accounts/handlers";
import { accountsStore } from "@/lib/accounts/supabaseStore";
import { currentUser, serverClient } from "@/lib/accounts/serverClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!accountsConfigured()) {
    return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const client = await serverClient();
  if (!client) {
    return NextResponse.json({ error: "Accounts are not set up on this deployment." }, { status: 501 });
  }

  // Membership/wedding cleanup first, as the user's own session — then the
  // actual auth.users row, which needs the service-role key (deleting a user
  // is an admin operation; no RLS policy could ever grant it to a user acting
  // on themselves). If this second step fails, the account keeps existing
  // with no wedding attached — a degraded state, not data loss.
  const reply = await deleteAccountHandler(accountsStore(client), user.id);
  if (reply.status !== 200) return NextResponse.json(reply.body, { status: reply.status });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Your wedding data was removed, but the account itself could not be deleted on this deployment." },
      { status: 500 },
    );
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json(
      { error: `Your wedding data was removed, but the account itself could not be deleted: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({}, { status: 200 });
}
```

- [ ] **Step 5: Type-check all four routes**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add suite/app/api/accounts/
git commit -m "Add the accounts API routes: wedding, invite, invite accept, delete"
```

---

## Task 9: Minimal UI — sign in, account page, invite acceptance

Per the spec, no onboarding wizard is designed here — these are functional,
plain pages that make the feature usable and manually testable end to end,
not a polished flow. Styling matches the existing plain pages
(`suite/app/privacy/page.tsx`) rather than the tool apps' own design system.

**Files:**
- Create: `suite/app/login/page.tsx`
- Create: `suite/app/(app)/account/page.tsx`
- Create: `suite/app/invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `browserClient()` (Task 7), the four API routes (Task 8).
- Produces: nothing consumed elsewhere — these are leaf UI pages.

- [ ] **Step 1: Sign-in page**

`suite/app/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { browserClient } from "@/lib/accounts/browserClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = browserClient();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!client) {
      setError("Accounts are not set up on this deployment.");
      return;
    }
    const { error: sendError } = await client.auth.signInWithOtp({ email });
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setSent(true);
  }

  if (!client) {
    return <p>Accounts are not set up on this deployment. Everything still works without one.</p>;
  }

  if (sent) {
    return <p>Check {email} for a sign-in link.</p>;
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="submit">Send me a sign-in link</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Account page**

`suite/app/(app)/account/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/accounts/browserClient";

interface AccountState {
  signedIn: boolean;
  weddingId: string | null;
}

export default function AccountPage() {
  const [state, setState] = useState<AccountState | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const client = browserClient();

  useEffect(() => {
    if (!client) {
      setState({ signedIn: false, weddingId: null });
      return;
    }
    client.auth.getUser().then(({ data }) => {
      setState({ signedIn: Boolean(data.user), weddingId: null });
    });
  }, [client]);

  async function createWedding() {
    const response = await fetch("/api/accounts/wedding", { method: "POST" });
    const body = (await response.json()) as { weddingId?: string; error?: string };
    if (!response.ok) {
      setNotice(body.error ?? "Could not create a wedding.");
      return;
    }
    setState((prev) => (prev ? { ...prev, weddingId: body.weddingId ?? null } : prev));
    setNotice("Wedding created.");
  }

  async function invitePartner(event: React.FormEvent) {
    event.preventDefault();
    if (!state?.weddingId) return;
    const response = await fetch("/api/accounts/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weddingId: state.weddingId, email: inviteEmail }),
    });
    const body = (await response.json()) as { error?: string };
    setNotice(response.ok ? `Invite sent to ${inviteEmail}.` : (body.error ?? "Could not send the invite."));
  }

  if (!client) {
    return <p>Accounts are not set up on this deployment. Everything still works without one.</p>;
  }
  if (!state) return <p>Loading…</p>;
  if (!state.signedIn) return <p>Sign in to manage your wedding account.</p>;

  return (
    <div>
      {!state.weddingId && <button onClick={createWedding}>Create your wedding</button>}
      {state.weddingId && (
        <form onSubmit={invitePartner}>
          <label htmlFor="partner-email">Invite your partner</label>
          <input
            id="partner-email"
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <button type="submit">Send invite</button>
        </form>
      )}
      {notice && <p>{notice}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Invite-acceptance page**

`suite/app/invite/[token]/page.tsx`:

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { browserClient } from "@/lib/accounts/browserClient";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [status, setStatus] = useState<"checking" | "signed-out" | "accepting" | "done" | "error">(
    "checking",
  );
  const [message, setMessage] = useState<string | null>(null);
  const client = browserClient();

  useEffect(() => {
    if (!client) {
      setStatus("error");
      setMessage("Accounts are not set up on this deployment.");
      return;
    }
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setStatus("signed-out");
        return;
      }
      setStatus("accepting");
      const response = await fetch(`/api/accounts/invite/${token}`, { method: "POST" });
      const body = (await response.json()) as { error?: string };
      if (response.ok) {
        setStatus("done");
      } else {
        setStatus("error");
        setMessage(body.error ?? "That invite could not be accepted.");
      }
    });
  }, [client, token]);

  if (status === "checking" || status === "accepting") return <p>One moment…</p>;
  if (status === "signed-out") {
    return <p>Sign in with the email this invite was sent to, then come back to this link.</p>;
  }
  if (status === "done") return <p>You're in — welcome to the wedding.</p>;
  return <p role="alert">{message}</p>;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p suite/tsconfig.json`
Expected: no errors

- [ ] **Step 5: Manual verification (this feature cannot be fully automated — magic-link email delivery requires a real Supabase project)**

Run: `npm run dev -w suite` with a real Supabase project's `SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` set, and the two migrations applied to that
project (`supabase db push` or the SQL editor). Then:

1. Visit `/login`, sign in with a real email, confirm the magic link arrives and signs you in.
2. Visit `/account`, click "Create your wedding," confirm a wedding is created.
3. Invite a second real email address; confirm the invite email arrives.
4. Open the invite link signed out; confirm it prompts to sign in with that exact email.
5. Sign in as that second email; confirm the invite auto-accepts and both accounts now share the wedding.
6. From either account, call `POST /api/accounts/delete`; confirm the wedding survives for the remaining partner, and confirm deleting the *last* member removes the wedding (check via the Supabase dashboard's table editor).

- [ ] **Step 6: Run the full suite test project to confirm nothing broke**

Run: `npx vitest run --project suite`
Expected: all tests pass, including every pre-existing test — this feature
is additive and must not change any existing behavior.

- [ ] **Step 7: Commit**

```bash
git add suite/app/login/ "suite/app/(app)/account/" suite/app/invite/
git commit -m "Add sign-in, account, and invite-acceptance pages"
```

---

## Explicitly out of scope for this plan

- Sending anything other than Supabase's own built-in email — no dedicated
  transactional email provider is wired up here (matches the spec's deferred
  item; `signInWithOtp` covers both ordinary sign-in and invite delivery).
- Any visual design/polish of the three new pages.
- Wiring the existing tool pages' shared header (`suite/components/shell/Header.tsx`)
  to show sign-in state — that's a follow-on UX task once this subsystem's
  plumbing is confirmed working, not part of making the feature function.
- Subsystem B (multi-tenant storage), C, D, F, G — each has its own plan,
  written separately.

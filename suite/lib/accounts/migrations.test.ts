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

/** Insert a fake authenticated user. Only Supabase Auth itself writes this table. */
async function userExists(email: string): Promise<string> {
  const id = crypto.randomUUID();
  // Reset role first: a prior test step may have left the session as
  // `authenticated`, which (correctly, matching real Supabase) has no grants
  // on `auth.users` at all.
  await db.exec("reset role;");
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  return id;
}

async function asUser(id: string): Promise<void> {
  await db.exec("set role authenticated;");
  // `is_local = false` (session-scoped), not `true`: PGlite auto-commits each
  // separate `.query()`/`.exec()` call as its own transaction, so a
  // transaction-local setting made here would not survive into the next call
  // that actually invokes a function reading `auth.uid()`. Real PostgREST
  // wraps one whole HTTP request in a single transaction and uses `true` for
  // exactly that reason; there is no equivalent single transaction spanning
  // these calls here, so this needs to persist for the rest of the session.
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
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

test("an unknown token is refused as a normal reason, not an exception", async () => {
  const bob = await userExists("bob@example.com");
  await asUser(bob);

  const result = await db.query<{ accepted: boolean; reason: string; wedding_id: string | null }>(
    "select * from accept_invite($1)",
    ["nosuchtoken"],
  );
  expect(result.rows[0]?.accepted).toBe(false);
  expect(result.rows[0]?.reason).toBe("not-found");
  expect(result.rows[0]?.wedding_id).toBeNull();
});

test("the invitee, who cannot read the invites row at all, still gets its email back", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const created = await db.query<{ create_wedding: string }>("select create_wedding()");
  const invite = await db.query<{ token: string }>("select * from create_invite($1, $2)", [
    created.rows[0]?.create_wedding,
    "bob@example.com",
  ]);
  const token = invite.rows[0]?.token;

  const eve = await userExists("eve@example.com");
  await asUser(eve);
  // RLS hides the row itself — this is exactly why accept_invite has to
  // report `invited_email` for the "sent to someone else" message.
  const direct = await db.query("select * from invites where token = $1", [token]);
  expect(direct.rows).toHaveLength(0);

  const result = await db.query<{ reason: string; invited_email: string }>(
    "select * from accept_invite($1)",
    [token],
  );
  expect(result.rows[0]?.reason).toBe("wrong-email");
  expect(result.rows[0]?.invited_email).toBe("bob@example.com");
});

test("someone who already has their own wedding is refused, not left to a unique violation", async () => {
  const alice = await userExists("alice@example.com");
  await asUser(alice);
  const created = await db.query<{ create_wedding: string }>("select create_wedding()");
  const invite = await db.query<{ token: string }>("select * from create_invite($1, $2)", [
    created.rows[0]?.create_wedding,
    "bob@example.com",
  ]);

  const bob = await userExists("bob@example.com");
  await asUser(bob);
  await db.query("select create_wedding()");

  const result = await db.query<{ accepted: boolean; reason: string }>(
    "select * from accept_invite($1)",
    [invite.rows[0]?.token],
  );
  expect(result.rows[0]?.accepted).toBe(false);
  expect(result.rows[0]?.reason).toBe("already-in-a-wedding");
});

test("deleting a user who sent an invite cascades that invite away", async () => {
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

  // Alice leaves; the wedding survives for bob, so nothing cascades via
  // `wedding_id` — the invite she created must go via `created_by` instead,
  // or deleting her auth.users row fails on the foreign key.
  await asUser(alice);
  await db.query("select delete_my_account()");
  await asSuperuser();
  await db.query("delete from auth.users where id = $1", [alice]);

  const invites = await db.query("select * from invites where wedding_id = $1", [weddingId]);
  expect(invites.rows).toHaveLength(0);
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

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

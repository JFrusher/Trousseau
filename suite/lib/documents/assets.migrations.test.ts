// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WebAssembly through fetch, and jsdom's
// Response has no `arrayBuffer`. Same rationale as lib/sync/migrations.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

// Generous for the same reason as lib/sync/migrations.test.ts: standing up a
// Postgres takes about two seconds, longer sharing a machine with the rest of
// the suite.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const MIGRATIONS = join(process.cwd(), "..", "supabase", "migrations");

/** Every migration, in the order Supabase would apply them. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** A database with every migration applied. */
async function databaseWith(): Promise<PGlite> {
  const db = await PGlite.create();
  // Supabase supplies these; the migrations revoke grants from them by name.
  await db.exec("create role anon; create role authenticated;");
  // Supabase also supplies its own `auth` schema — 20260902000001_accounts.sql
  // depends on it. Kept minimal and identical to the stub in
  // lib/sync/migrations.test.ts and lib/documents/migrations.test.ts.
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text not null);
    create or replace function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  // Supabase also supplies its own `storage` schema, managed by its Storage
  // API rather than by anything in this repo's migrations. This migration's
  // `insert into storage.buckets` and `create policy ... on storage.objects`
  // assume those objects already exist, which is true on real Supabase and
  // has to be faked here the same way `auth.users`/`auth.uid()` are above.
  // Close enough for what these tests check (the bucket row, and that the
  // policies exist) — not a byte-perfect reproduction of Supabase's internal
  // schema.
  await db.exec(`
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false
    );
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets (id),
      name text not null
    );
    create or replace function storage.foldername(name text) returns text[]
      language sql immutable
      as $$ select string_to_array(name, '/') $$;
  `);
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

let db: PGlite;

beforeAll(async () => {
  db = await databaseWith();
});

afterAll(async () => {
  await db.close();
});

test("the wedding-assets bucket exists and is private", async () => {
  const { rows } = await db.query("select public from storage.buckets where id = 'wedding-assets'");
  expect(rows).toEqual([{ public: false }]);
});

test("storage.objects has a policy scoped to is_wedding_member", async () => {
  const { rows } = await db.query(
    `select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like '%wedding-assets%'`,
  );
  expect(rows.length).toBeGreaterThan(0);
});

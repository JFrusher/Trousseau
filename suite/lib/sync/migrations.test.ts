// @vitest-environment node
//
// Node, not jsdom: PGlite loads its WebAssembly through fetch, and jsdom's
// Response has no `arrayBuffer`. The rest of this project runs in jsdom because
// the store touches IndexedDB; nothing here does.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

/*
 * Generous, for the same reason the PDF projects are: standing up a Postgres
 * takes about two seconds alone, and rather longer sharing a machine with the
 * rest of the suite. Two of these build a second database to test an upgrade
 * path, and were passing in isolation and timing out in a full run. Set here
 * rather than on the project, so a genuine hang in another suite test still
 * fails fast.
 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * The migrations, run against a real Postgres.
 *
 * PGlite is Postgres compiled to WebAssembly, so `plpgsql`, foreign keys,
 * `on conflict … where` and row locks all behave as they will on Supabase.
 * Everything else in `lib/sync` is tested against the in-memory store, which
 * deliberately does not exercise the SQL — and the SQL is where two of the
 * three bugs in this directory's history actually lived.
 *
 * Read from disk in filename order rather than pasted in, so a migration added
 * later is covered by these tests whether or not anyone remembers to come back.
 */

const MIGRATIONS = join(process.cwd(), "..", "supabase", "migrations");

/** Every migration, in the order Supabase would apply them. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** A database with `files` applied. Defaults to all of them. */
async function databaseWith(files: string[] = migrationFiles()): Promise<PGlite> {
  const db = await PGlite.create();
  // Supabase supplies these; the migrations revoke grants from them by name.
  await db.exec("create role anon; create role authenticated;");
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

let db: PGlite;

const wedding = async (id: string) =>
  db.query("insert into weddings (id, salt, auth_hash) values ($1, 'salt', 'hash')", [id]);

const putSlice = async (id: string, slice: string, text: string, expected: number) =>
  db.query<{ accepted: boolean; version: number }>(
    "select * from put_slice($1, $2, $3, 'iv', $4)",
    [id, slice, text, expected],
  );

const count = async (table: string): Promise<number> => {
  const result = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return result.rows[0]?.n ?? 0;
};

// Built once and emptied between tests: standing up a Postgres costs about two
// seconds, and there are a dozen of these.
beforeAll(async () => {
  db = await databaseWith();
});

beforeEach(async () => {
  await db.exec("truncate weddings, slices, blobs, shares cascade");
});

test("every migration applies in order, from empty", async () => {
  // databaseWith() would have thrown. This asserts the tables it produced.
  const tables = await db.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' order by 1",
  );
  expect(tables.rows.map((r) => r.table_name)).toEqual(["blobs", "shares", "slices", "weddings"]);
});

// the compare-and-set ---------------------------------------------------------

test("a first write expects version zero and lands at one", async () => {
  await wedding("w1");
  const result = await putSlice("w1", "guests", "first", 0);
  expect(result.rows[0]).toMatchObject({ accepted: true, version: 1 });
});

test("two first writes: exactly one wins", async () => {
  // The bug the second migration exists to fix. `select … for update` locked
  // nothing on an absent row, so both writers saw "absent", both matched an
  // expected version of 0, and both were told they had succeeded.
  await wedding("w1");
  const first = await putSlice("w1", "guests", "mine", 0);
  const second = await putSlice("w1", "guests", "theirs", 0);

  expect(first.rows[0]?.accepted).toBe(true);
  expect(second.rows[0]?.accepted).toBe(false);
  expect(second.rows[0]?.version).toBe(1);
});

test("a client expecting history the wedding does not have is refused", async () => {
  await wedding("w1");
  const result = await putSlice("w1", "guests", "out of step", 5);
  expect(result.rows[0]).toMatchObject({ accepted: false, version: 0 });
});

test("a rejected write does not change what is stored", async () => {
  await wedding("w1");
  await putSlice("w1", "guests", "kept", 0);
  await putSlice("w1", "guests", "discarded", 0);

  const stored = await db.query<{ ciphertext: string }>(
    "select ciphertext from slices where wedding_id = 'w1' and slice = 'guests'",
  );
  expect(stored.rows[0]?.ciphertext).toBe("kept");
});

// retention -------------------------------------------------------------------

test("an accepted write touches the wedding's updated_at", async () => {
  await wedding("w1");
  await db.query("update weddings set updated_at = now() - interval '30 months' where id = 'w1'");

  await putSlice("w1", "guests", "active again", 0);

  const rows = await db.query<{ stale: boolean }>(
    "select updated_at < now() - interval '24 months' as stale from weddings where id = 'w1'",
  );
  expect(rows.rows[0]?.stale).toBe(false);
});

test("a rejected write does not touch it", async () => {
  // Otherwise a client stuck out of step holds a wedding open for ever, and the
  // retention period means nothing.
  await wedding("w1");
  await putSlice("w1", "guests", "first", 0);
  await db.query("update weddings set updated_at = now() - interval '30 months' where id = 'w1'");

  await putSlice("w1", "guests", "refused", 99);

  const rows = await db.query<{ stale: boolean }>(
    "select updated_at < now() - interval '24 months' as stale from weddings where id = 'w1'",
  );
  expect(rows.rows[0]?.stale).toBe(true);
});

// deletion --------------------------------------------------------------------

test("deleting a wedding takes its slices, blobs and share with it", async () => {
  await wedding("w1");
  await putSlice("w1", "guests", "cipher", 0);
  await db.query("insert into blobs (wedding_id, blob_id, ciphertext, iv) values ('w1','b','c','i')");
  await db.query(
    "insert into shares (token, wedding_id, ciphertext, iv) values ('tok','w1','c','i')",
  );

  await db.query("delete from weddings where id = 'w1'");

  expect(await count("slices")).toBe(0);
  expect(await count("blobs")).toBe(0);
  // The one that used to survive: shares carried no foreign key, so a deleted
  // wedding left its guest link live and still serving the old plan.
  expect(await count("shares")).toBe(0);
});

test("deleting one wedding leaves another's rows alone", async () => {
  await wedding("w1");
  await wedding("w2");
  await putSlice("w1", "guests", "one", 0);
  await putSlice("w2", "guests", "two", 0);
  await db.query(
    "insert into shares (token, wedding_id, ciphertext, iv) values ('t1','w1','c','i'), ('t2','w2','c','i')",
  );

  await db.query("delete from weddings where id = 'w1'");

  expect(await count("slices")).toBe(1);
  const left = await db.query<{ token: string }>("select token from shares");
  expect(left.rows.map((r) => r.token)).toEqual(["t2"]);
});

test("a share cannot be stored without the wedding it belongs to", async () => {
  await expect(
    db.query("insert into shares (token, ciphertext, iv) values ('orphan','c','i')"),
  ).rejects.toThrow();

  await expect(
    db.query(
      "insert into shares (token, wedding_id, ciphertext, iv) values ('ghost','nosuch','c','i')",
    ),
  ).rejects.toThrow();
});

// grants ----------------------------------------------------------------------

test("the anon role is given nothing on any table", async () => {
  // RLS is on with no policies, but the grants are the belt: the moment the
  // client library is pointed at this project with the anon key, these are what
  // stand between it and the rows.
  const grants = await db.query<{ table_name: string }>(
    `select table_name from information_schema.role_table_grants
      where grantee in ('anon', 'authenticated') and table_schema = 'public'`,
  );
  expect(grants.rows).toEqual([]);
});

test("row level security is enabled on every table", async () => {
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `select relname, relrowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
  );
  expect(rls.rows.every((row) => row.relrowsecurity)).toBe(true);
});

// upgrading an existing database ----------------------------------------------

/**
 * The path that matters most, and the one a clean install does not exercise:
 * applying the share foreign key to a database that already holds shares.
 */
test("the shares migration removes rows it cannot attribute, and keeps the rest working", async () => {
  const files = migrationFiles();
  const before = files.filter((f) => f < "20260901000001_delete_wedding.sql");
  const upgrade = files.filter((f) => f === "20260901000001_delete_wedding.sql");
  expect(before.length).toBeGreaterThan(0);
  expect(upgrade).toHaveLength(1);

  const old = await databaseWith(before);
  await old.query("insert into weddings (id, salt, auth_hash) values ('w1','salt','hash')");
  // A guest link published before the column existed. There is nothing in the
  // schema relating it to a wedding, which is exactly why it cannot be kept.
  await old.query("insert into shares (token, ciphertext, iv) values ('legacy','c','i')");

  await old.exec(readFileSync(join(MIGRATIONS, upgrade[0]!), "utf8"));

  const left = await old.query<{ n: number }>("select count(*)::int as n from shares");
  expect(left.rows[0]?.n).toBe(0);

  // And the table is usable afterwards, with the constraint in force.
  await old.query(
    "insert into shares (token, wedding_id, ciphertext, iv) values ('new','w1','c','i')",
  );
  await expect(
    old.query("insert into shares (token, ciphertext, iv) values ('still-no','c','i')"),
  ).rejects.toThrow();

  await old.close();
});

test("the retention migration is safe to apply to a database with existing weddings", async () => {
  const files = migrationFiles();
  const before = files.filter((f) => f < "20260901000002_retention.sql");
  const upgrade = "20260901000002_retention.sql";

  const old = await databaseWith(before);
  await old.query(
    "insert into weddings (id, salt, auth_hash, created_at) values ('w1','salt','hash', now() - interval '10 months')",
  );

  await old.exec(readFileSync(join(MIGRATIONS, upgrade), "utf8"));

  // Backfilled rather than left at now(), so an old abandoned wedding does not
  // get its clock reset by the very migration that introduces the clock.
  const rows = await old.query<{ months: number }>(
    "select extract(month from age(now(), updated_at))::int as months from weddings where id = 'w1'",
  );
  expect(rows.rows[0]?.months).toBeGreaterThanOrEqual(9);

  await old.close();
});

test("the retention backfill dates a wedding from its newest slice, not its creation", async () => {
  const files = migrationFiles();
  const before = files.filter((f) => f < "20260901000002_retention.sql");

  const old = await databaseWith(before);
  // Created a year ago, synced last week: in active use, and must not be aged
  // from its creation date.
  await old.query(
    "insert into weddings (id, salt, auth_hash, created_at) values ('w1','salt','hash', now() - interval '12 months')",
  );
  await old.query(
    `insert into slices (wedding_id, slice, ciphertext, iv, version, updated_at)
     values ('w1','guests','c','i',1, now() - interval '7 days')`,
  );

  await old.exec(readFileSync(join(MIGRATIONS, "20260901000002_retention.sql"), "utf8"));

  const rows = await old.query<{ days: number }>(
    "select extract(day from age(now(), updated_at))::int as days from weddings where id = 'w1'",
  );
  expect(rows.rows[0]?.days).toBe(7);

  await old.close();
});

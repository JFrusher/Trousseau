// @vitest-environment node
import { expect, test, vi } from "vitest";
import {
  backendUnreachable,
  categorise,
  describeCause,
  safely,
  schemaCacheIsStale,
  schemaIsBehind,
} from "./safely";

/**
 * What a failing database looks like from the outside.
 *
 * This existed as a real 500: the store threw, nothing caught it, and the
 * person saving their wedding got an empty error with no status worth reading.
 */

test("a handler that succeeds is passed through with its own status", async () => {
  const response = await safely(async () => ({ status: 200, body: { id: "w1" } }));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ id: "w1" });
});

test("a deliberate refusal is not treated as a failure", async () => {
  // 403 and 400 are answers, not faults. Only a throw is a fault.
  const denied = await safely(async () => ({ status: 403, body: { error: "no" } }));
  expect(denied.status).toBe(403);
});

test("a throwing store becomes a 503, not a 500", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await safely(async () => {
    // Exactly what Postgres says when the code is deployed ahead of its
    // migrations, which is how this was found.
    throw new Error('column "updated_at" of relation "weddings" does not exist');
  });

  expect(response.status).toBe(503);
  quiet.mockRestore();
});

test("the database's own words are logged, never returned", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const leak = 'column "auth_hash" of relation "weddings" does not exist';

  const response = await safely(async () => {
    throw new Error(leak);
  });
  const body = (await response.json()) as { error: string };

  // A database error names columns and constraints. That is for whoever runs
  // this, not for a public endpoint.
  expect(body.error).not.toContain("auth_hash");
  expect(body.error).not.toContain("relation");
  expect(quiet).toHaveBeenCalled();
  quiet.mockRestore();
});

test("the message tells the user their own copy is unharmed", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await safely(async () => {
    throw new Error("anything");
  });
  const body = (await response.json()) as { error: string };

  // The wedding is local-first. Someone whose save failed needs to know the
  // thing they have been working on all evening is still there.
  expect(body.error).toContain("safe on this device");
  quiet.mockRestore();
});

test("a rejected promise is caught as well as a thrown error", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await safely(() => Promise.reject(new Error("network")));
  expect(response.status).toBe(503);
  quiet.mockRestore();
});

test("a missing column is recognised as migrations being behind", () => {
  // Deploying ahead of the migrations makes every write fail this way, and the
  // message is otherwise a mystery to whoever is looking at a 503.
  expect(schemaIsBehind(new Error('column "updated_at" of relation "weddings" does not exist'))).toBe(
    true,
  );
  expect(schemaIsBehind(new Error('relation "blobs" does not exist'))).toBe(true);
});

test("an ordinary failure is not blamed on migrations", () => {
  expect(schemaIsBehind(new Error("fetch failed"))).toBe(false);
  expect(schemaIsBehind(new Error("duplicate key value violates unique constraint"))).toBe(false);
});

test("PostgREST's stale-cache wording is recognised too", () => {
  // What Supabase actually returns after a migration, while every check run
  // against the database itself says the column is there.
  const stale = new Error("Could not find the 'updated_at' column of 'weddings' in the schema cache");
  expect(schemaIsBehind(stale)).toBe(true);
  expect(schemaCacheIsStale(stale)).toBe(true);
});

test("a missing column is not mistaken for a stale cache", () => {
  // Different cause, different fix: apply the migrations rather than reload.
  const missing = new Error('column "updated_at" of relation "weddings" does not exist');
  expect(schemaIsBehind(missing)).toBe(true);
  expect(schemaCacheIsStale(missing)).toBe(false);
});

test("an unreachable backend is recognised, and not blamed on the schema", () => {
  // What a paused Supabase project looks like: no SQL error at all, because
  // nothing ever answered.
  for (const message of ["fetch failed", "The operation was aborted due to timeout", "ENOTFOUND"]) {
    expect(backendUnreachable(new Error(message)), message).toBe(true);
    expect(schemaIsBehind(new Error(message)), message).toBe(false);
  }
});

test("a schema error is not mistaken for the backend being down", () => {
  const missing = new Error('column "updated_at" of relation "weddings" does not exist');
  expect(backendUnreachable(missing)).toBe(false);
});

test("the 503 names which failure it was, without the database's words", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await safely(async () => {
    throw new Error("fetch failed");
  });
  const body = (await response.json()) as { cause: string; error: string };

  // A category from a closed set: enough to act on, and it names nothing.
  expect(body.cause).toBe("unreachable");
  expect(body.error).toContain("safe on this device");
  quiet.mockRestore();
});

test("each cause is categorised distinctly", () => {
  expect(categorise(new Error("fetch failed"))).toBe("unreachable");
  expect(categorise(new Error("Could not find the 'x' column of 'y' in the schema cache"))).toBe(
    "schema-cache",
  );
  expect(categorise(new Error('column "x" of relation "y" does not exist'))).toBe("schema-behind");
  expect(categorise(new Error("something else entirely"))).toBe("unknown");
});

test("describeCause walks the whole chain, deepest last", () => {
  // What supabase-js throws away: the outer TypeError undici wraps everything
  // in, and the real reason underneath it.
  const real = new Error("connect ECONNREFUSED 127.0.0.1:443");
  const wrapped = new Error("fetch failed", { cause: real });
  expect(describeCause(wrapped)).toBe(
    "Error: fetch failed <- caused by <- Error: connect ECONNREFUSED 127.0.0.1:443",
  );
});

test("describeCause stops cleanly at the bottom of the chain", () => {
  expect(describeCause(new Error("no cause here"))).toBe("Error: no cause here");
});

test("describeCause handles a non-Error thrown value", () => {
  expect(describeCause("just a string")).toBe("just a string");
});

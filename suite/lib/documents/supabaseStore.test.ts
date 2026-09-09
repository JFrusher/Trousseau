import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { documentStore } from "./supabaseStore";

/**
 * A fake Supabase query builder, just enough of the fluent chain
 * `.from(table).select(...).lt(...).order(...).limit(...)` uses. Awaiting it
 * (the `then`) resolves to whatever `result` this table was built with — the
 * same shape supabase-js's PostgrestFilterBuilder resolves to.
 */
function tableResult(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "lt", "order", "limit", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: typeof result) => void) => resolve(result);
  return builder;
}

/**
 * documentStore()'s staleWeddings can't be exercised through memoryStore —
 * that fake has no concept of a wedding that exists but has never had a
 * document saved, which is exactly the case this method has to catch (see
 * store.ts's staleWeddings doc comment). PostgREST also can't express the
 * needed "coalesce across a left join" as a single filtered query, so the
 * real implementation runs two queries and merges them in TypeScript — this
 * test verifies that merge directly, against fake per-table responses, since
 * there is no PGlite-backed PostgREST wire protocol available to run the
 * real queries against in this suite (PGlite's migrations tests only ever
 * execute raw SQL, never a supabase-js call).
 */
function fakeClient(tables: Record<string, ReturnType<typeof tableResult>>): SupabaseClient {
  return {
    from: vi.fn((table: string) => tables[table]),
  } as unknown as SupabaseClient;
}

test("staleWeddings includes a wedding with an old document", async () => {
  const client = fakeClient({
    wedding_documents: tableResult({
      data: [{ wedding_id: "has-old-doc", updated_at: "2020-01-01T00:00:00.000Z" }],
      error: null,
    }),
    account_weddings: tableResult({ data: [], error: null }),
  });

  const ids = await documentStore(client).staleWeddings("2024-01-01T00:00:00.000Z");
  expect(ids).toEqual(["has-old-doc"]);
});

test("staleWeddings catches an old wedding that never got a document at all", async () => {
  const client = fakeClient({
    wedding_documents: tableResult({ data: [], error: null }),
    account_weddings: tableResult({
      data: [
        // Never opened/synced: the left-joined embed comes back null.
        { id: "never-opened", created_at: "2020-01-01T00:00:00.000Z", wedding_documents: null },
      ],
      error: null,
    }),
  });

  const ids = await documentStore(client).staleWeddings("2024-01-01T00:00:00.000Z");
  expect(ids).toEqual(["never-opened"]);
});

test("staleWeddings does not flag an old-enough account_weddings row that already has a document", async () => {
  // account_weddings.created_at can be older than the cutoff even for an
  // actively-used wedding — the document's own updated_at is what matters
  // once one exists, so the documentless branch must not also catch it.
  const client = fakeClient({
    wedding_documents: tableResult({ data: [], error: null }),
    account_weddings: tableResult({
      data: [
        {
          id: "old-account-recent-doc",
          created_at: "2020-01-01T00:00:00.000Z",
          wedding_documents: { wedding_id: "old-account-recent-doc" },
        },
      ],
      error: null,
    }),
  });

  const ids = await documentStore(client).staleWeddings("2024-01-01T00:00:00.000Z");
  expect(ids).toEqual([]);
});

test("staleWeddings merges both cases, deduped, oldest first", async () => {
  const client = fakeClient({
    wedding_documents: tableResult({
      data: [{ wedding_id: "middle", updated_at: "2022-01-01T00:00:00.000Z" }],
      error: null,
    }),
    account_weddings: tableResult({
      data: [
        { id: "oldest", created_at: "2019-01-01T00:00:00.000Z", wedding_documents: null },
        // Same id could in principle appear from both angles in a stranger
        // schema; the dedupe just needs to keep exactly one copy.
        { id: "middle", created_at: "2021-06-01T00:00:00.000Z", wedding_documents: { wedding_id: "middle" } },
      ],
      error: null,
    }),
  });

  const ids = await documentStore(client).staleWeddings("2024-01-01T00:00:00.000Z");
  expect(ids).toEqual(["oldest", "middle"]);
});

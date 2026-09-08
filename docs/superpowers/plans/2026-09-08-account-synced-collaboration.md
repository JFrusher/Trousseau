# Account-Synced Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four remaining gaps between what's already built (automatic account-based document sync) and "two partners, signed in anywhere, always see the current wedding": periodic/focus-triggered pulling, per-slice conflict merging instead of whole-document, retiring the redundant passphrase UI, and syncing fonts/artwork through the account-based system.

**Architecture:** Extend the existing `useTrousseauStore` cloud-sync machinery (`lib/documents/cloudSync.ts`, already pushing on every edit and pulling once at load) with a pure per-slice merge function and a new `pullFromCloud` action, wire it to an interval + visibility listener in `StoreHydrator`, replace the whole-document conflict UI in `DataManager.tsx` with a per-slice one, remove `SharePanel`, and add a Supabase Storage-backed asset transport parallel to the document transport.

**Tech Stack:** Next.js (suite/), Zustand, Supabase (Postgres + Storage), Vitest, `@jfrusher/trousseau` contract package.

**Spec:** `docs/superpowers/specs/2026-09-08-account-synced-collaboration-design.md`

## Global Constraints

- Every top-level slice iterated by name comes from `SLICE_NAMES` (imported from `@jfrusher/trousseau`), never a hand-typed list — the contract has 8 slices (`event`, `guests`, `seating`, `day`, `crew`, `stationery`, `shots`, `timeline`), not 7; a hand-typed list is exactly the kind of drift this plan must not introduce.
- Nothing in this plan modifies `lib/sync/` (the passphrase system) beyond removing its one UI mount point — full deletion is an explicit follow-up in the spec, not this plan.
- All new pure logic (fingerprinting, merging) gets direct unit tests before the store integration that consumes it, per this codebase's existing pattern (`lib/sync/client.test.ts` tests the equivalent per-slice logic today).

---

## Task 1: Fingerprint helper

**Files:**
- Create: `suite/lib/documents/fingerprint.ts`
- Test: `suite/lib/documents/fingerprint.test.ts`

**Interfaces:**
- Produces: `fingerprint(value: unknown): string` — a short content hash, stable for structurally-equal values, used by Task 2 to detect whether a slice changed.

- [ ] **Step 1: Write the failing test**

```ts
// suite/lib/documents/fingerprint.test.ts
import { expect, test } from "vitest";
import { fingerprint } from "./fingerprint";

test("same value, same fingerprint", () => {
  expect(fingerprint({ a: 1, b: [1, 2, 3] })).toBe(fingerprint({ a: 1, b: [1, 2, 3] }));
});

test("different value, different fingerprint", () => {
  expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
});

test("undefined and null both fingerprint, and agree with each other", () => {
  expect(fingerprint(undefined)).toBe(fingerprint(null));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/documents/fingerprint.test.ts` (from `suite/`)
Expected: FAIL — `fingerprint.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// suite/lib/documents/fingerprint.ts
/**
 * A short, stable content hash — not cryptographic, just cheap and collision-
 * unlikely enough to tell "this slice changed" from "this slice didn't,"
 * which is all the merge in mergeCloudDocument.ts needs it for.
 *
 * Same algorithm as the (soon-to-be-retired) lib/sync/crypto.ts's
 * fingerprint() — duplicated rather than imported, so this module has no
 * dependency on the passphrase system being deleted out from under it.
 */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}:${text.length.toString(16)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/documents/fingerprint.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/documents/fingerprint.ts suite/lib/documents/fingerprint.test.ts
git commit -m "feat(documents): add content fingerprint helper"
```

---

## Task 2: Per-slice merge

**Files:**
- Create: `suite/lib/documents/mergeCloudDocument.ts`
- Test: `suite/lib/documents/mergeCloudDocument.test.ts`

**Interfaces:**
- Consumes: `fingerprint` from Task 1. `SLICE_NAMES`, `type SliceName` from `@jfrusher/trousseau`.
- Produces:
  - `interface SliceConflict { slice: SliceName; theirs: unknown }`
  - `interface MergeResult { raw: Record<string, unknown>; conflicts: SliceConflict[]; agreed: Partial<Record<SliceName, string>> }`
  - `mergeCloudDocument(localRaw: Record<string, unknown>, serverRaw: Record<string, unknown>, agreedFingerprints: Partial<Record<SliceName, string>>): MergeResult`
  - `fingerprintAllSlices(raw: Record<string, unknown>): Partial<Record<SliceName, string>>`
  Task 3 (the store) consumes both functions and both types.

- [ ] **Step 1: Write the failing tests**

```ts
// suite/lib/documents/mergeCloudDocument.test.ts
import { expect, test } from "vitest";
import { SLICE_NAMES } from "@jfrusher/trousseau";
import { fingerprint } from "./fingerprint";
import { fingerprintAllSlices, mergeCloudDocument } from "./mergeCloudDocument";

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const slice of SLICE_NAMES) base[slice] = { owner: "base" };
  return { ...base, ...overrides };
}

test("a slice changed only on the server is taken", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const server = doc({ guests: { owner: "server" } });

  const result = mergeCloudDocument(base, server, agreed);

  expect(result.raw.guests).toEqual({ owner: "server" });
  expect(result.conflicts).toEqual([]);
  expect(result.agreed.guests).toBe(fingerprint({ owner: "server" }));
});

test("a slice changed only locally is kept, not overwritten", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const local = doc({ seating: { owner: "local" } });

  const result = mergeCloudDocument(local, base, agreed);

  expect(result.raw.seating).toEqual({ owner: "local" });
  expect(result.conflicts).toEqual([]);
});

test("a slice changed on both sides is a conflict, and neither value is applied", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const local = doc({ stationery: { owner: "local" } });
  const server = doc({ stationery: { owner: "server" } });

  const result = mergeCloudDocument(local, server, agreed);

  expect(result.conflicts).toEqual([{ slice: "stationery", theirs: { owner: "server" } }]);
  // Local's own value survives untouched in raw until the user resolves it.
  expect(result.raw.stationery).toEqual({ owner: "local" });
  // Not marked agreed - it's still unresolved.
  expect(result.agreed.stationery).toBe(agreed.stationery);
});

test("a slice unchanged on both sides is left alone and marked agreed", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);

  const result = mergeCloudDocument(base, base, agreed);

  expect(result.conflicts).toEqual([]);
  expect(result.raw).toEqual(base);
  expect(result.agreed.event).toBe(fingerprint(base.event));
});

test("multiple independently-changed slices all merge without conflicting with each other", () => {
  const base = doc();
  const agreed = fingerprintAllSlices(base);
  const local = doc({ guests: { owner: "local" } });
  const server = doc({ seating: { owner: "server" } });

  const result = mergeCloudDocument(local, server, agreed);

  expect(result.conflicts).toEqual([]);
  expect(result.raw.guests).toEqual({ owner: "local" });
  expect(result.raw.seating).toEqual({ owner: "server" });
});

test("fingerprintAllSlices covers every slice in SLICE_NAMES", () => {
  const agreed = fingerprintAllSlices(doc());
  expect(Object.keys(agreed).sort()).toEqual([...SLICE_NAMES].sort());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/documents/mergeCloudDocument.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// suite/lib/documents/mergeCloudDocument.ts
import { SLICE_NAMES, type SliceName } from "@jfrusher/trousseau";
import { fingerprint } from "./fingerprint";

/**
 * Per-slice merge over a whole-document compare-and-set store.
 *
 * The server holds one JSONB document with one version (lib/documents), not
 * one row per slice — but two partners editing different parts of the same
 * wedding in the same window should not have to choose between their edits
 * just because *some* slice moved. This runs the same three-way comparison
 * lib/sync/client.ts's sync() does for its per-slice tables, entirely
 * client-side, before the next whole-document write.
 */

export interface SliceConflict {
  slice: SliceName;
  /** The server's value for this slice, ready to apply if the user takes it. */
  theirs: unknown;
}

export interface MergeResult {
  /** Ready to become the new local raw document. */
  raw: Record<string, unknown>;
  /** Slices that changed on both sides. Untouched in `raw` - still local's value. */
  conflicts: SliceConflict[];
  /** Updated agreed-fingerprint map: includes every slice that is now settled. */
  agreed: Partial<Record<SliceName, string>>;
}

export function fingerprintAllSlices(raw: Record<string, unknown>): Partial<Record<SliceName, string>> {
  const agreed: Partial<Record<SliceName, string>> = {};
  for (const slice of SLICE_NAMES) agreed[slice] = fingerprint(raw[slice]);
  return agreed;
}

export function mergeCloudDocument(
  localRaw: Record<string, unknown>,
  serverRaw: Record<string, unknown>,
  agreedFingerprints: Partial<Record<SliceName, string>>,
): MergeResult {
  const raw = { ...localRaw };
  const agreed = { ...agreedFingerprints };
  const conflicts: SliceConflict[] = [];

  for (const slice of SLICE_NAMES) {
    const mine = localRaw[slice];
    const theirs = serverRaw[slice];
    const mineFp = fingerprint(mine);
    const theirFp = fingerprint(theirs);

    if (mineFp === theirFp) {
      agreed[slice] = mineFp;
      continue;
    }

    const base = agreedFingerprints[slice];
    const changedHere = mineFp !== base;
    const changedThere = theirFp !== base;

    if (changedHere && changedThere) {
      conflicts.push({ slice, theirs });
      continue; // raw[slice] stays at localRaw[slice]; agreed[slice] stays at base.
    }

    if (changedThere) {
      raw[slice] = theirs;
      agreed[slice] = theirFp;
      continue;
    }

    // changedHere only: keep mine. Left unmarked in `agreed` (still `base`) -
    // the next successful push (Task 3) recomputes the full agreed map from
    // whatever was actually accepted, which is the one true source for it.
  }

  return { raw, conflicts, agreed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/documents/mergeCloudDocument.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/documents/mergeCloudDocument.ts suite/lib/documents/mergeCloudDocument.test.ts
git commit -m "feat(documents): add per-slice merge over the whole-document cloud store"
```

---

## Task 3: Wire per-slice merge into the store

**Files:**
- Modify: `suite/lib/store/useTrousseauStore.ts`
- Modify: `suite/lib/store/useTrousseauStore.cloudSync.test.ts`

**Interfaces:**
- Consumes: `mergeCloudDocument`, `fingerprintAllSlices`, `type SliceConflict` from Task 2. `fetchCloudDocument`, `pushDocument` from `lib/documents/cloudSync.ts` (unchanged). `mergeSlice`, `type SliceName` from `@jfrusher/trousseau` (already imported).
- Produces (new/changed `TrousseauState` members, replacing the whole-document conflict fields):
  - `cloudAgreed: Partial<Record<SliceName, string>>`
  - `cloudConflicts: SliceConflict[]` (replaces `cloudConflict: { document; version } | null`)
  - `pullFromCloud: () => Promise<void>` (new)
  - `resolveConflict: (slice: SliceName, choice: "theirs" | "mine") => void` (replaces `resolveConflictTakeTheirs` / `resolveConflictKeepMine`)
  Task 4 consumes `pullFromCloud`. Task 5 consumes `cloudConflicts` and `resolveConflict`.

This task changes an existing public interface (`cloudConflict` → `cloudConflicts`, two resolve functions → one). Every other consumer of the old names is `DataManager.tsx` (Task 5) and this test file — both updated in this pass, so there is no in-between state where the codebase doesn't compile.

- [ ] **Step 1: Update the test file's expectations for the new shape**

Replace the existing `cloudConflict`-shaped tests in `suite/lib/store/useTrousseauStore.cloudSync.test.ts` (lines 53-80) with the new shape, and add coverage for the new behavior:

```ts
// Replace the beforeEach's cloudConflict field:
    cloudConflicts: [],
    cloudAgreed: {},
// (remove the old `cloudConflict: null,` line)

// Replace "a rejected write surfaces as a conflict, not an auto-merge" with:
test("a rejected write surfaces per-slice conflicts, not an auto-merge", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: { ...base, event: { coupleNames: "mine" } },
  });
  pushDocumentMock.mockResolvedValue({
    ok: false,
    reason: "conflict",
    version: 2,
    document: { ...base, event: { coupleNames: "theirs" } },
  });
  await useTrousseauStore.getState().syncToCloud();
  const state = useTrousseauStore.getState();
  expect(state.cloudStatus).toBe("conflict");
  expect(state.cloudConflicts).toEqual([{ slice: "event", theirs: { coupleNames: "theirs" } }]);
  // The conflicting slice keeps the local value until resolved.
  expect((state.raw as Record<string, unknown>).event).toEqual({ coupleNames: "mine" });
});

test("a rejected write with no actual slice overlap resolves itself and re-pushes", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: { ...base, guests: { g1: { id: "g1" } } },
  });
  pushDocumentMock
    .mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      version: 2,
      document: { ...base, seating: { t1: { id: "t1" } } },
    })
    .mockResolvedValueOnce({ ok: true, version: 3, warnings: [] });

  await useTrousseauStore.getState().syncToCloud();

  const state = useTrousseauStore.getState();
  expect(state.cloudConflicts).toEqual([]);
  expect(state.cloudStatus).toBe("idle");
  expect(state.cloudVersion).toBe(3);
  expect((state.raw as Record<string, unknown>).guests).toEqual({ g1: { id: "g1" } });
  expect((state.raw as Record<string, unknown>).seating).toEqual({ t1: { id: "t1" } });
  expect(pushDocumentMock).toHaveBeenCalledTimes(2);
});

test("resolveConflict(theirs) applies the server's slice and clears that conflict", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "conflict",
    cloudVersion: 2,
    cloudAgreed: fingerprintAllSlices(base),
    cloudConflicts: [{ slice: "event", theirs: { coupleNames: "theirs" } }],
    raw: { ...base, event: { coupleNames: "mine" } },
  });

  useTrousseauStore.getState().resolveConflict("event", "theirs");

  const state = useTrousseauStore.getState();
  expect(state.cloudConflicts).toEqual([]);
  expect((state.raw as Record<string, unknown>).event).toEqual({ coupleNames: "theirs" });
});

test("resolveConflict(mine) drops the conflict and keeps the local slice", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "conflict",
    cloudVersion: 2,
    cloudAgreed: fingerprintAllSlices(base),
    cloudConflicts: [{ slice: "event", theirs: { coupleNames: "theirs" } }],
    raw: { ...base, event: { coupleNames: "mine" } },
  });

  useTrousseauStore.getState().resolveConflict("event", "mine");

  const state = useTrousseauStore.getState();
  expect(state.cloudConflicts).toEqual([]);
  expect((state.raw as Record<string, unknown>).event).toEqual({ coupleNames: "mine" });
});

test("pullFromCloud takes a slice that only changed on the server", async () => {
  const base = emptyTrousseau() as unknown as Record<string, unknown>;
  useTrousseauStore.setState({
    cloudStatus: "idle",
    cloudVersion: 1,
    cloudAgreed: fingerprintAllSlices(base),
    raw: base,
  });
  fetchCloudDocumentMock.mockResolvedValue({
    ok: true,
    document: { ...base, guests: { g1: { id: "g1" } } },
    version: 2,
  });

  await useTrousseauStore.getState().pullFromCloud();

  const state = useTrousseauStore.getState();
  expect((state.raw as Record<string, unknown>).guests).toEqual({ g1: { id: "g1" } });
  expect(state.cloudVersion).toBe(2);
  expect(state.cloudConflicts).toEqual([]);
});

test("pullFromCloud does nothing when the server version hasn't moved", async () => {
  useTrousseauStore.setState({ cloudStatus: "idle", cloudVersion: 5 });
  await useTrousseauStore.getState().pullFromCloud();
  expect(fetchCloudDocumentMock).not.toHaveBeenCalled();
});
```

Also delete the old whole-document conflict test ("a rejected write surfaces as a conflict, not an auto-merge") and the old `resolveConflictTakeTheirs`/`resolveConflictKeepMine` tests — they test functions this task removes. Update the two `startCloudSync` "adopts"/"pushes" tests to also assert `cloudAgreed` is populated, e.g. add to the "adopts the cloud document" test:

```ts
  expect(Object.keys(state.cloudAgreed).length).toBeGreaterThan(0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/store/useTrousseauStore.cloudSync.test.ts`
Expected: FAIL — `pullFromCloud`/`resolveConflict`/`cloudAgreed`/`cloudConflicts` don't exist yet; old fields still do, causing type/runtime mismatches.

- [ ] **Step 3: Implement in `useTrousseauStore.ts`**

Add the import (near the existing `@jfrusher/trousseau` import block, line 5-11):

```ts
import { fingerprintAllSlices, mergeCloudDocument } from "@/lib/documents/mergeCloudDocument";
```

Replace the `TrousseauState` interface's cloud section (lines 117-135):

```ts
  /**
   * `"disabled"` until `startCloudSync()` runs (accounts configured and the
   * caller has a wedding) — every other state is only reachable after that.
   */
  cloudStatus: "disabled" | "idle" | "syncing" | "queued" | "conflict" | "error";
  cloudError: string | null;
  /** The version this device last confirmed the cloud holds, or null before the first sync. */
  cloudVersion: number | null;
  /** Fingerprint of each slice as last agreed with the server - the merge baseline. */
  cloudAgreed: Partial<Record<SliceName, string>>;
  /** Slices changed on both sides since the last agreement. Surfaced, never auto-merged. */
  cloudConflicts: SliceConflict[];

  /** Called once, after local hydration, when accounts + a wedding are both available. */
  startCloudSync: () => Promise<void>;
  /** Push the current document now. Called after every local write, and on reconnect for the queue. */
  syncToCloud: () => Promise<void>;
  /** Pull the server's current document and merge it in, per slice. Called on an interval and on focus. */
  pullFromCloud: () => Promise<void>;
  /** Settle one slice's conflict: take the server's value, or keep the local one. */
  resolveConflict: (slice: SliceName, choice: "theirs" | "mine") => void;
```

Add the `SliceConflict` import alongside the new one above:

```ts
import { fingerprintAllSlices, mergeCloudDocument, type SliceConflict } from "@/lib/documents/mergeCloudDocument";
```

Replace the initial state values (lines 290-293):

```ts
  cloudStatus: "disabled",
  cloudError: null,
  cloudVersion: null,
  cloudAgreed: {},
  cloudConflicts: [],
```

Replace `startCloudSync`'s body (lines 295-331) — same control flow, now also sets `cloudAgreed` on every branch that settles on a known-good document:

```ts
  startCloudSync: async () => {
    set({ cloudStatus: "syncing" });
    const result = await fetchCloudDocument();
    if (!result.ok) {
      set({ cloudStatus: result.reason === "unreachable" ? "error" : "disabled" });
      return;
    }

    if (result.document !== null) {
      get().replaceDocument(result.document, { silent: true });
      set({
        cloudStatus: "idle",
        cloudVersion: result.version,
        cloudAgreed: fingerprintAllSlices(result.document as Record<string, unknown>),
        cloudConflicts: [],
        cloudError: null,
      });
    } else {
      const local = get().raw;
      const guests = local["guests"];
      const day = local["day"] as { blocks?: unknown[] } | null | undefined;
      const hasContent =
        (guests !== null && typeof guests === "object" && Object.keys(guests).length > 0) ||
        (day?.blocks?.length ?? 0) > 0;
      if (hasContent) {
        applyCloudResult(await pushDocument(local, 0));
      } else {
        set({
          cloudStatus: "idle",
          cloudVersion: result.version,
          cloudAgreed: fingerprintAllSlices(local),
          cloudConflicts: [],
          cloudError: null,
        });
      }
    }

    const replay = await replayPendingWrite();
    if (replay) applyCloudResult(replay);
  },
```

Replace `syncToCloud` (lines 333-339) — unchanged behavior, kept for clarity of the diff:

```ts
  syncToCloud: async () => {
    const state = get();
    if (state.cloudStatus === "disabled") return;
    set({ cloudStatus: "syncing" });
    const result = await pushDocument(state.raw, state.cloudVersion ?? 0);
    applyCloudResult(result);
  },
```

Add `pullFromCloud`, right after `syncToCloud`:

```ts
  pullFromCloud: async () => {
    const state = get();
    if (state.cloudStatus === "disabled" || state.cloudStatus === "syncing") return;
    const result = await fetchCloudDocument();
    if (!result.ok) {
      if (result.reason === "unreachable") {
        set({ cloudStatus: "error", cloudError: "The cloud could not be reached." });
      }
      return;
    }
    // Nothing has changed on the server since we last agreed - the common
    // case on every tick of the poll.
    if (result.version === state.cloudVersion) return;

    const serverRaw = (result.document ?? {}) as Record<string, unknown>;
    const merged = mergeCloudDocument(state.raw, serverRaw, state.cloudAgreed);
    get().replaceDocument(merged.raw, { silent: true });

    if (merged.conflicts.length > 0) {
      set({
        cloudStatus: "conflict",
        cloudConflicts: merged.conflicts,
        cloudVersion: result.version,
        cloudAgreed: merged.agreed,
      });
    } else {
      set({ cloudVersion: result.version, cloudAgreed: merged.agreed });
      void get().syncToCloud();
    }
  },
```

Replace `resolveConflictTakeTheirs` / `resolveConflictKeepMine` (lines 341-354) with a single `resolveConflict`:

```ts
  resolveConflict: (slice, choice) => {
    const state = get();
    const conflict = state.cloudConflicts.find((c) => c.slice === slice);
    if (!conflict) return;
    const remaining = state.cloudConflicts.filter((c) => c.slice !== slice);
    const raw = choice === "theirs" ? mergeSlice(state.raw, slice, conflict.theirs) : state.raw;
    const resolvedValue = raw[slice];

    set({
      raw,
      doc: migrate(raw),
      cloudConflicts: remaining,
      cloudAgreed: { ...state.cloudAgreed, [slice]: fingerprint(resolvedValue) },
      cloudStatus: remaining.length > 0 ? "conflict" : "idle",
    });
    schedulePersist(raw);
  },
```

This needs `fingerprint` imported too — extend the Task 1 import:

```ts
import { fingerprint } from "@/lib/documents/fingerprint";
```

Replace `applyCloudResult`'s conflict branch (the `if (result.reason === "conflict")` block, originally lines ~433-438 after the earlier edits shifted line numbers — locate by the comment `// A conflict is recorded, never merged.`):

```ts
function applyCloudResult(result: PushResult): void {
  if (result.ok) {
    const raw = useTrousseauStore.getState().raw;
    useTrousseauStore.setState({
      cloudStatus: "idle",
      cloudVersion: result.version,
      cloudConflicts: [],
      cloudAgreed: fingerprintAllSlices(raw),
      cloudError: null,
    });
    return;
  }
  if (result.reason === "conflict") {
    const state = useTrousseauStore.getState();
    const merged = mergeCloudDocument(
      state.raw,
      result.document as Record<string, unknown>,
      state.cloudAgreed,
    );
    state.replaceDocument(merged.raw, { silent: true });

    if (merged.conflicts.length > 0) {
      useTrousseauStore.setState({
        cloudStatus: "conflict",
        cloudConflicts: merged.conflicts,
        cloudVersion: result.version,
        cloudAgreed: merged.agreed,
      });
    } else {
      // Every differing slice resolved cleanly - finalize by pushing the
      // merged document at the version the server just reported.
      useTrousseauStore.setState({ cloudVersion: result.version, cloudAgreed: merged.agreed });
      void useTrousseauStore.getState().syncToCloud();
    }
    return;
  }
  if (result.reason === "queued") {
```

(the rest of `applyCloudResult` — the `"queued"` / `"invalid"` / `"unavailable"` branches — is unchanged; only the `"conflict"` branch above is replaced).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/store/useTrousseauStore.cloudSync.test.ts`
Expected: PASS, all tests (existing + new).

Then run the full suite test suite to confirm nothing else referenced the removed fields:

Run: `npx vitest run` (from `suite/`)
Expected: fails only in `DataManager.tsx`-related code if any test imports it before Task 5 — if so, that's expected and resolved by Task 5; otherwise PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/store/useTrousseauStore.ts suite/lib/store/useTrousseauStore.cloudSync.test.ts
git commit -m "feat(store): merge cloud conflicts per slice instead of whole-document"
```

---

## Task 4: Periodic and focus-triggered pull

**Files:**
- Modify: `suite/lib/store/StoreHydrator.tsx`
- Test: `suite/lib/store/StoreHydrator.test.tsx` (create — none exists today)

**Interfaces:**
- Consumes: `pullFromCloud` from Task 3 (`useTrousseauStore.getState().pullFromCloud`).

- [ ] **Step 1: Write the failing test**

```tsx
// suite/lib/store/StoreHydrator.test.tsx
import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("idb-keyval", () => ({ get: async () => undefined, set: async () => undefined }));
vi.mock("@/lib/seating/normalise", () => ({ reconcileLoadedDocument: async () => {} }));

const { useTrousseauStore } = await import("./useTrousseauStore");
const { StoreHydrator } = await import("./StoreHydrator");

beforeEach(() => {
  vi.useFakeTimers();
  useTrousseauStore.setState({
    status: "idle",
    hydrate: vi.fn(async () => {
      useTrousseauStore.setState({ status: "ready" });
    }) as unknown as typeof useTrousseauStore.getState().hydrate,
    startCloudSync: vi.fn(async () => {
      useTrousseauStore.setState({ cloudStatus: "idle" });
    }),
    pullFromCloud: vi.fn(async () => {}),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("polls pullFromCloud on an interval after mounting", async () => {
  render(<StoreHydrator />);
  await vi.runOnlyPendingTimersAsync(); // flush the hydrate().then(...).then(startCloudSync) chain

  await vi.advanceTimersByTimeAsync(20_000);
  expect(useTrousseauStore.getState().pullFromCloud).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(20_000);
  expect(useTrousseauStore.getState().pullFromCloud).toHaveBeenCalledTimes(2);
});

test("pulls when the tab becomes visible again", async () => {
  render(<StoreHydrator />);
  await vi.runOnlyPendingTimersAsync();

  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));

  expect(useTrousseauStore.getState().pullFromCloud).toHaveBeenCalledTimes(1);
});

test("does not pull on visibilitychange while the tab is hidden", async () => {
  render(<StoreHydrator />);
  await vi.runOnlyPendingTimersAsync();

  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));

  expect(useTrousseauStore.getState().pullFromCloud).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/store/StoreHydrator.test.tsx`
Expected: FAIL — no interval or visibilitychange listener exists yet, so `pullFromCloud` is never called.

- [ ] **Step 3: Write the implementation**

```tsx
// suite/lib/store/StoreHydrator.tsx
"use client";

import { useEffect } from "react";
import { reconcileLoadedDocument } from "@/lib/seating/normalise";
import { useTrousseauStore } from "./useTrousseauStore";

/** How often to check for the other partner's changes while the tab is open. */
const PULL_INTERVAL_MS = 20_000;

/**
 * Reads the stored wedding once, on the client.
 *
 * A component rather than a module side effect because IndexedDB does not
 * exist while Next prerenders, and zustand's `persist` middleware would reach
 * for it at import time.
 */
export function StoreHydrator() {
  const hydrate = useTrousseauStore((s) => s.hydrate);
  const startCloudSync = useTrousseauStore((s) => s.startCloudSync);
  useEffect(() => {
    // Cloud sync starts only after the local read has finished. Starting them
    // together would race the two documents, and the local one is what the
    // user already has on this device.
    void hydrate()
      .then(reconcileLoadedDocument)
      .then(() => startCloudSync());
  }, [hydrate, startCloudSync]);

  useEffect(() => {
    // Guarded the same way `schedulePersist` is: this file is imported by
    // tests that run without a `window`.
    if (typeof window === "undefined") return;
    const onOnline = () => void useTrousseauStore.getState().syncToCloud();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const pull = () => void useTrousseauStore.getState().pullFromCloud();
    const interval = setInterval(pull, PULL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/store/StoreHydrator.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add suite/lib/store/StoreHydrator.tsx suite/lib/store/StoreHydrator.test.tsx
git commit -m "feat(store): poll and pull-on-focus so the other partner's edits arrive without a reload"
```

---

## Task 5: Per-slice conflict UI, and retire the passphrase panel

**Files:**
- Modify: `suite/components/shell/DataManager.tsx`

**Interfaces:**
- Consumes: `cloudConflicts: SliceConflict[]`, `resolveConflict` from Task 3's `useTrousseauStore`.

- [ ] **Step 1: Remove the `SharePanel` import and mount point**

Delete line 11 (`import { SharePanel } from "./SharePanel";`) and the whole `Sharing` section (lines 221-223):

```tsx
      <Section title="Sharing">
        <SharePanel onProblem={setProblem} />
      </Section>
```

`setProblem` may now be unused if nothing else in the file calls it — check with a search for `setProblem(` in the rest of the file before removing its `useState` declaration; if it's still used elsewhere (e.g. by the CSV import flow), leave the state as-is and only remove the `SharePanel` usage of it.

- [ ] **Step 2: Update the store field reads**

Replace lines 68-70:

```tsx
  const cloudConflicts = useTrousseauStore((s) => s.cloudConflicts);
  const resolveConflict = useTrousseauStore((s) => s.resolveConflict);
```

(removing `cloudConflict`, `resolveConflictTakeTheirs`, `resolveConflictKeepMine`).

- [ ] **Step 3: Replace the whole-document conflict rendering with a per-slice list**

Replace the `"Cloud"` section body (lines 231-259):

```tsx
      {cloudStatus !== "disabled" ? (
        <Section title="Cloud">
          {cloudStatus === "conflict" && cloudConflicts.length > 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-slate">
                You and your partner both changed the same thing on different devices. Choose
                which to keep for each — nothing else is affected.
              </p>
              {cloudConflicts.map((conflict) => (
                <div key={conflict.slice} className="rounded border border-charcoal/10 p-3">
                  <p className="mb-2 text-sm font-semibold capitalize">{conflict.slice}</p>
                  <div className="flex flex-wrap gap-2">
                    <Action
                      onClick={() => resolveConflict(conflict.slice, "theirs")}
                      icon={RefreshCw}
                      primary
                    >
                      Use their version
                    </Action>
                    <Action onClick={() => resolveConflict(conflict.slice, "mine")} icon={Upload}>
                      Keep mine
                    </Action>
                  </div>
                </div>
              ))}
            </div>
          ) : cloudStatus === "queued" ? (
            <p className="flex items-center gap-2 text-sm text-slate">
              <CloudOff size={16} /> You&rsquo;re offline. Changes will sync once you&rsquo;re back
              online.
            </p>
          ) : cloudStatus === "error" ? (
            <p className="text-sm text-slate">{cloudError ?? "The cloud could not be reached."}</p>
          ) : (
            <p className="text-sm text-slate">Synced to your account.</p>
          )}
        </Section>
      ) : null}
```

- [ ] **Step 4: Type-check and run the component's existing tests, if any**

Run: `npx tsc --noEmit` (from `suite/`)
Expected: no errors referencing `cloudConflict`, `resolveConflictTakeTheirs`, `resolveConflictKeepMine`, or `SharePanel` in `DataManager.tsx`.

Run: `npx vitest run` (from `suite/`) — the full suite, since this task is the one that finally removes every reference to the fields Task 3 renamed.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add suite/components/shell/DataManager.tsx
git commit -m "feat(ui): show cloud conflicts per slice, remove the passphrase sharing panel"
```

---

## Task 6: Storage bucket and RLS for wedding assets

**Files:**
- Create: `supabase/migrations/20260908000001_wedding_assets_storage.sql`
- Test: `suite/lib/documents/assets.migrations.test.ts`

**Interfaces:**
- Produces: a `wedding-assets` Storage bucket, private, with policies restricting all operations to `is_wedding_member(...)` (already defined in `20260902000001_accounts.sql`) for objects whose path starts with the caller's wedding id. Task 7 consumes this bucket by name.

- [ ] **Step 1: Write the failing migration test**

Follow the existing pattern in `suite/lib/sync/migrations.test.ts` / `suite/lib/accounts/migrations.test.ts` (PGlite, no real network):

```ts
// suite/lib/documents/assets.migrations.test.ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { newTestDatabase } from "../../../test/pglite"; // same helper the existing migrations tests import - confirm exact relative path against lib/sync/migrations.test.ts's own import before writing this line

let db: Awaited<ReturnType<typeof newTestDatabase>>;

beforeAll(async () => {
  db = await newTestDatabase(); // applies every migration in supabase/migrations, in filename order
});

afterAll(async () => {
  await db.close();
});

test("the wedding-assets bucket exists and is private", async () => {
  const { rows } = await db.query(
    `select public from storage.buckets where id = 'wedding-assets'`,
  );
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
```

(If `newTestDatabase`'s actual location or signature differs from this sketch, use the real one — read `suite/lib/sync/migrations.test.ts`'s first few lines before writing this file, and match its import exactly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/documents/assets.migrations.test.ts`
Expected: FAIL — no `wedding-assets` bucket exists yet.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260908000001_wedding_assets_storage.sql
-- Fonts and artwork for the account-based sync system, in Supabase Storage
-- rather than a Postgres table: client uploads/downloads go straight to
-- Storage, so a large embedded font never has to pass through a serverless
-- function's ~4.5MB body-size ceiling. Scoped by is_wedding_member(), the
-- same helper 20260902000001_accounts.sql already established for
-- wedding_documents - see that migration for why it is reused rather than a
-- fresh policy querying wedding_members directly.
--
-- Object paths are "{wedding_id}/{asset_id}" - the policies below read the
-- wedding id as the first path segment via storage.foldername(name).

insert into storage.buckets (id, name, public)
values ('wedding-assets', 'wedding-assets', false)
on conflict (id) do nothing;

drop policy if exists "wedding members can read their wedding-assets" on storage.objects;
create policy "wedding members can read their wedding-assets"
  on storage.objects for select
  using (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "wedding members can upload their wedding-assets" on storage.objects;
create policy "wedding members can upload their wedding-assets"
  on storage.objects for insert
  with check (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "wedding members can replace their wedding-assets" on storage.objects;
create policy "wedding members can replace their wedding-assets"
  on storage.objects for update
  using (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "wedding members can delete their wedding-assets" on storage.objects;
create policy "wedding members can delete their wedding-assets"
  on storage.objects for delete
  using (
    bucket_id = 'wedding-assets'
    and public.is_wedding_member((storage.foldername(name))[1]::uuid)
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/documents/assets.migrations.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260908000001_wedding_assets_storage.sql suite/lib/documents/assets.migrations.test.ts
git commit -m "feat(storage): add a private, membership-scoped bucket for wedding assets"
```

---

## Task 7: Client-side asset sync via Storage

**Files:**
- Create: `suite/lib/documents/assets.ts`
- Test: `suite/lib/documents/assets.test.ts`
- Modify: `suite/lib/store/useTrousseauStore.ts` (wire asset sync alongside document sync)

**Interfaces:**
- Consumes: `collectAssets`, `heldAssetIds`, `acceptAsset`, `type PortableAsset` — the exact same per-tool asset registry `lib/sync/assets.ts` already uses (`suite/apps/plaque/state/syncAssets`, `suite/apps/cadence/state/syncAssets`). `browserClient` from `lib/accounts/browserClient.ts`. The `wedding-assets` bucket from Task 6.
- Produces:
  - `interface AssetSyncResult { uploaded: number; downloaded: number }`
  - `syncAssets(weddingId: string): Promise<AssetSyncResult>`
  Task 3's store calls this from `startCloudSync`, `syncToCloud`, and `pullFromCloud`.

- [ ] **Step 1: Write the failing test**

```ts
// suite/lib/documents/assets.test.ts
import { expect, test, vi } from "vitest";

const listMock = vi.fn();
const uploadMock = vi.fn();
const downloadMock = vi.fn();
vi.mock("@/lib/accounts/browserClient", () => ({
  browserClient: () => ({
    storage: {
      from: () => ({
        list: listMock,
        upload: uploadMock,
        download: downloadMock,
      }),
    },
  }),
}));

const collectAssetsMock = vi.fn();
const heldAssetIdsMock = vi.fn();
const acceptAssetMock = vi.fn();
vi.mock("@/lib/sync/assets", () => ({
  collectAssets: (...args: unknown[]) => collectAssetsMock(...args),
  heldAssetIds: (...args: unknown[]) => heldAssetIdsMock(...args),
  acceptAsset: (...args: unknown[]) => acceptAssetMock(...args),
}));

const { syncAssets } = await import("./assets");

test("uploads a locally-held asset the server does not have yet", async () => {
  listMock.mockResolvedValue({ data: [], error: null });
  collectAssetsMock.mockResolvedValue([{ id: "font-a1", bytes: new Uint8Array([1, 2, 3]) }]);
  heldAssetIdsMock.mockResolvedValue(["font-a1"]);
  uploadMock.mockResolvedValue({ error: null });

  const result = await syncAssets("wedding-1");

  expect(uploadMock).toHaveBeenCalledWith(
    "wedding-1/font-a1",
    expect.any(Uint8Array),
    expect.objectContaining({ upsert: true }),
  );
  expect(result).toEqual({ uploaded: 1, downloaded: 0 });
});

test("downloads a server asset this device does not hold yet", async () => {
  listMock.mockResolvedValue({ data: [{ name: "font-b2" }], error: null });
  collectAssetsMock.mockResolvedValue([]);
  heldAssetIdsMock.mockResolvedValue([]);
  downloadMock.mockResolvedValue({ data: new Blob([new Uint8Array([4, 5])]), error: null });

  const result = await syncAssets("wedding-1");

  expect(downloadMock).toHaveBeenCalledWith("wedding-1/font-b2");
  expect(acceptAssetMock).toHaveBeenCalledWith("font-b2", expect.any(Uint8Array));
  expect(result).toEqual({ uploaded: 0, downloaded: 1 });
});

test("does nothing when local and server already agree", async () => {
  listMock.mockResolvedValue({ data: [{ name: "font-a1" }], error: null });
  collectAssetsMock.mockResolvedValue([{ id: "font-a1", bytes: new Uint8Array([1]) }]);
  heldAssetIdsMock.mockResolvedValue(["font-a1"]);

  const result = await syncAssets("wedding-1");

  expect(uploadMock).not.toHaveBeenCalled();
  expect(downloadMock).not.toHaveBeenCalled();
  expect(result).toEqual({ uploaded: 0, downloaded: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/documents/assets.test.ts`
Expected: FAIL — `suite/lib/documents/assets.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// suite/lib/documents/assets.ts
import { acceptAsset, collectAssets, heldAssetIds } from "@/lib/sync/assets";
import { browserClient } from "@/lib/accounts/browserClient";

/**
 * Fonts and artwork, over Supabase Storage instead of the encrypted
 * Postgres-row transport lib/sync/assets.ts's caller (lib/sync/client.ts)
 * uses. Reuses the same per-tool asset registry - the wedding-assets bucket
 * only wants opaque bytes under stable ids, exactly like the old transport
 * did.
 */

export interface AssetSyncResult {
  uploaded: number;
  downloaded: number;
}

const BUCKET = "wedding-assets";

export async function syncAssets(weddingId: string): Promise<AssetSyncResult> {
  const client = browserClient();
  if (!client) return { uploaded: 0, downloaded: 0 };
  const bucket = client.storage.from(BUCKET);

  const { data: listed } = await bucket.list(weddingId);
  const onServer = new Set((listed ?? []).map((entry) => entry.name));

  let uploaded = 0;
  for (const asset of await collectAssets()) {
    if (onServer.has(asset.id)) continue;
    const { error } = await bucket.upload(`${weddingId}/${asset.id}`, asset.bytes, { upsert: true });
    if (!error) {
      onServer.add(asset.id);
      uploaded += 1;
    }
  }

  const held = new Set(await heldAssetIds());
  let downloaded = 0;
  for (const id of onServer) {
    if (held.has(id)) continue;
    const { data, error } = await bucket.download(`${weddingId}/${id}`);
    if (error || !data) continue;
    await acceptAsset(id, new Uint8Array(await data.arrayBuffer()));
    downloaded += 1;
  }

  return { uploaded, downloaded };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/documents/assets.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Wire into the store**

In `useTrousseauStore.ts`, add the import:

```ts
import { syncAssets } from "@/lib/documents/assets";
```

`syncAssets` needs the wedding id, which the store does not currently hold — add it as state, set once by `startCloudSync` (it is available wherever `accountsStore(client).memberOf(userId)` already resolves it server-side; client-side, thread it through `fetchCloudDocument`'s caller instead of adding a new endpoint: extend `FetchResult` in `lib/documents/cloudSync.ts` is out of scope for this task's minimal footprint, so instead read it the same way `SharePanel` used to get a wedding id - via `membership()`-equivalent. Concretely: add a `weddingId: string | null` field to `TrousseauState`, defaulting to `null`, set by `startCloudSync` from a new small helper).

Add to `lib/documents/cloudSync.ts` (alongside the existing exports):

```ts
export interface WeddingIdResult {
  ok: boolean;
  weddingId: string | null;
}

/** The caller's wedding id, or null if there isn't one yet. Never throws. */
export async function fetchWeddingId(): Promise<WeddingIdResult> {
  try {
    const response = await fetch("/api/accounts/wedding");
    if (!response.ok) return { ok: false, weddingId: null };
    const body = (await response.json()) as { weddingId: string | null };
    return { ok: true, weddingId: body.weddingId };
  } catch {
    return { ok: false, weddingId: null };
  }
}
```

Verified: `suite/app/api/accounts/wedding/route.ts`'s existing `GET` handler already
returns exactly `{ weddingId: membership?.weddingId ?? null }` (reading
`accountsStore(client).memberOf(user.id)`) — no route change needed, `fetchWeddingId()`
above calls it as-is.

In `useTrousseauStore.ts`, add to `TrousseauState`:

```ts
  /** This device's wedding id, once known. Needed for asset sync's Storage paths. */
  weddingId: string | null;
```

Initial state: `weddingId: null,`.

In `startCloudSync`, right after the `fetchCloudDocument()` call succeeds (both the "document exists" and "nothing saved yet" branches), resolve and store the wedding id, then sync assets:

```ts
    const { weddingId } = await fetchWeddingId();
    if (weddingId) {
      set({ weddingId });
      void syncAssets(weddingId);
    }
```

placed after the existing `if (result.document !== null) { ... } else { ... }` block, before `const replay = await replayPendingWrite();`.

In `syncToCloud` and `pullFromCloud`, after a successful outcome, also call `if (get().weddingId) void syncAssets(get().weddingId!);` — assets are fire-and-forget relative to the document push/pull; a failed asset sync does not block or fail the document sync, matching `lib/sync/client.ts`'s existing "the design blocks on missing artwork, not on a failed blob sync" posture.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run` (from `suite/`)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add suite/lib/documents/assets.ts suite/lib/documents/assets.test.ts suite/lib/documents/cloudSync.ts suite/lib/store/useTrousseauStore.ts
git commit -m "feat(documents): sync fonts and artwork through Supabase Storage"
```

---

## Self-Review Notes

- **Spec coverage:** gap 1 (periodic/focus pull) → Task 4. Gap 2 (per-slice merge) → Tasks 2-3. Gap 3 (retire passphrase UI) → Task 5. Gap 4 (blob sync) → Tasks 6-7. All four covered.
- **Type consistency:** `SliceConflict` is defined once (Task 2) and imported everywhere it's used (Tasks 3, 5) rather than redefined. `mergeCloudDocument` / `fingerprintAllSlices` signatures introduced in Task 2 are used unchanged in Task 3.
- **Verified, not assumed:** Task 7's `fetchWeddingId()` depends on `app/api/accounts/wedding/route.ts`'s `GET` handler already returning `{ weddingId }` — read directly (not inferred) before finalizing this plan; it does, unchanged, no new route needed.

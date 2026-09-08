# Account-synced collaboration

> **Correction (same day):** the first version of this spec was written after
> an incomplete search — it checked whether `lib/documents` was wired up by
> grepping `components/` only, and missed that `useTrousseauStore.ts` itself
> already consumes it. Most of what that version proposed building already
> exists. This version reflects the real state, found by reading
> `lib/store/useTrousseauStore.ts`, `lib/store/StoreHydrator.tsx`,
> `lib/documents/cloudSync.ts`, and `components/shell/DataManager.tsx`
> directly.

## Goal

Two partners, each signed in with their own account, always see the current
wedding — on any device, without a separate secret to remember or hand each
other.

## Current state (verified by reading the code, not assumed)

**Already fully built, wired, and tested — no work needed:**

- **Accounts.** `lib/accounts` — Supabase magic-link auth, `account_weddings`
  / `wedding_members` (capped at 2), email invites, `is_wedding_member()` RLS.
- **Cloud document storage.** `lib/documents` — whole-document JSONB per
  wedding, RLS-gated, compare-and-set via `save_wedding_document()`,
  automatic version history. `GET`/`PUT /api/documents`, rate-limited, tested.
- **The client sync loop.** `lib/documents/cloudSync.ts` (`fetchCloudDocument`,
  `pushDocument`, `queueWrite`/`replayPendingWrite` — an offline queue of at
  most one pending write) is consumed directly by
  `lib/store/useTrousseauStore.ts`:
  - Every local edit debounce-persists to IndexedDB (250ms), then
    automatically calls `syncToCloud()` (`useTrousseauStore.ts:404`).
  - `StoreHydrator.tsx` calls `startCloudSync()` once, right after local
    hydration, and pushes again on the browser's `online` event.
  - A rejected push (`409`) is surfaced as `cloudStatus: "conflict"` +
    `cloudConflict: { document, version }` — never auto-merged.
  - `resolveConflictTakeTheirs` / `resolveConflictKeepMine` are implemented
    and already wired to buttons in `components/shell/DataManager.tsx:240-245`
    ("Use their version" / "Keep mine and overwrite theirs").
  - `useTrousseauStore.cloudSync.test.ts` covers this.

So "sign in and your data is there, automatically, no passphrase" is **already
true today** for a single sync exchange (on load, on reconnect, on your own
edits). The gaps are narrower than the first version of this spec thought.

## What's actually still missing

1. **No periodic or focus-triggered pull.** `startCloudSync()` pulls exactly
   once, at load. If partner A has the app open and partner B pushes a
   change, A's tab never learns about it until A reloads or goes
   offline/online. This is the one real gap against "always up to date" —
   everything else about liveness already works.

2. **Whole-document conflict, no per-slice merge.** A push conflicts if the
   version has moved *at all*, even if A changed `guests` and B changed
   `stationery` — unrelated slices. Today's answer is Keep mine / Take
   theirs, discarding one side's unrelated edit along with the real conflict.
   A merge that only asks the user to choose when the *same* slice changed
   on both sides is a real improvement here.

3. **Two sync systems visible at once.** `components/shell/DataManager.tsx`
   renders both `SharePanel` (`lib/sync` — the old passphrase/E2E system,
   `SharePanel.tsx:221-223`) and the new account-based "Cloud" section
   (`DataManager.tsx:231-259`) in the same panel. The passphrase system is
   confirmed not live for any real wedding (nothing to migrate) and is
   strictly worse for this product's goal (separate secret, memory-only
   session, manual sync button) — it should come out of the UI.

4. **No blob/asset sync in the account-based system.** Fonts and artwork
   (`lib/sync/assets.ts`'s `collectAssets`/`heldAssetIds`/`acceptAsset`,
   sourced from `apps/plaque/state/syncAssets` and `apps/cadence/state/syncAssets`)
   only travel over the old encrypted `lib/sync` blob table. `lib/documents`
   has no equivalent. Confirmed by grep — no blob/asset/font handling
   anywhere under `lib/documents`.

## Non-goals

- **True real-time co-editing.** No cursors, no live keystroke merge, no
  CRDT. A short poll plus pull-on-focus is refresh-driven liveness, chosen
  deliberately over that complexity.
- **Migrating passphrase-synced weddings.** Confirmed nothing real uses
  `lib/sync` — its UI is removed, not migrated.
- **Changing the guest link.** `SharePanel`'s guest-link feature (a
  separate, reduced-snapshot, its-own-key mechanism for people with no
  account) needs to be re-pointed at `account_weddings.id` once the
  passphrase wedding concept goes away, but its design is unchanged. Tracked
  as a follow-up, not in this pass.

## Architecture

### 1. Periodic and focus-triggered pull

Add to `StoreHydrator.tsx` (alongside the existing `online` listener):

- `setInterval(() => useTrousseauStore.getState().pullFromCloud(), 20_000)`
  while `cloudStatus !== "disabled"`.
- A `visibilitychange` listener that calls the same pull when the tab becomes
  visible again (covers "switched away and came back," which a fixed
  interval alone misses for a while).

This needs a new store action, `pullFromCloud()`, distinct from the existing
`startCloudSync()` (which also decides whether to push an empty-vs-local
document on first ever sign-in — the periodic case is simpler: always compare
and merge, never "is this the first sync").

### 2. Per-slice merge

`pullFromCloud()` and the conflict path both need to reason per-slice instead
of accepting or discarding the whole document. New pure function,
`mergeCloudDocument`, taking the local `raw`, the last-agreed raw (captured at
the last successful sync), and the server's document — for each top-level key
(`event`, `guests`, `seating`, `timeline`, `day`, `crew`, `stationery`):
compare a content fingerprint against the last-agreed one to classify
changed-here / changed-there / changed-both, exactly the algorithm
`lib/sync/client.ts`'s `sync()` already implements for the (soon-removed)
per-slice passphrase model — same idea, applied client-side over one
whole-document CAS write instead of N per-slice server writes.

A genuine per-slice conflict (changed on both sides) is what populates
`cloudConflict` going forward — not "the document version moved," which is
what triggers it today.

### 3. Retire the passphrase UI

Remove `<SharePanel onProblem={setProblem} />` and its "Sharing" `Section`
from `DataManager.tsx`. `lib/sync/` and its migrations are left in place
(nothing else in this pass depends on deleting them) but are no longer
reachable from the UI. Full deletion of the module and its Postgres tables is
a follow-up once nothing else in the codebase references it — including the
guest-link, per the non-goal above.

### 4. Blob/asset sync

New Supabase Storage bucket, objects keyed `{weddingId}/{assetId}`, RLS/storage
policies scoped to `is_wedding_member(weddingId)`. Client uploads/downloads go
directly to Storage from the browser client (`lib/accounts/browserClient.ts`),
not proxied through a serverless function — avoids the ~4.5MB Vercel body-size
ceiling a large embedded font could hit going through a Postgres-row or
API-route approach. A new `lib/documents/assets.ts` mirrors the shape of
`lib/sync/assets.ts` (`collectAssets`/`heldAssetIds`/`acceptAsset` sourced
from the same two per-tool modules) but pushes/pulls via Storage instead of
sealing bytes for a Postgres row.

## Testing

Follow the existing pattern already used throughout: pure logic
(`mergeCloudDocument`) gets direct unit tests the way `lib/sync/client.test.ts`
tests the equivalent per-slice logic today. The interval/focus wiring is
integration-level, alongside the existing
`lib/store/useTrousseauStore.cloudSync.test.ts`.

## Open follow-ups (not in this pass)

- Guest link re-pointed at `account_weddings.id`.
- Deleting `lib/sync/` and its Postgres tables/migrations once nothing
  references them (the guest link is the last thing that will).
- Push instead of poll: Supabase Realtime on `wedding_documents` could
  replace the 20s interval with an instant trigger later, without touching
  the merge logic above.

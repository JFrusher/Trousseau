# Trousseau — multi-tenant data & storage design

Date: 2026-09-02
Status: approved, ready for implementation planning
Scope: subsystem B of `docs/PRODUCT-ROADMAP.md` — where a wedding's document
lives once it belongs to a real account. Depends on subsystem A (identity &
accounts); blocks subsystem G (multi-tenant suite mechanics) and, in
practice, most feature work in Plaque/Cadence/Brigade/Tableaux going
forward.

## Why

DVC-backed local sync (`scripts/sync.mjs`, a OneDrive "remote") was built
for one wedding on two laptops and was never meant to outlive that. A real
product needs the wedding document to live somewhere every account-holder's
device can reach, with the same cross-tool guarantees the old pipeline
provided by hand — most importantly the cross-slice validation that already
caught a real bug (two tools disagreeing on the wedding date).

See `docs/superpowers/specs/2026-09-02-trousseau-architecture-audit.md` for
the current state (including the existing E2E-encrypted `suite/lib/sync/`
backend this design deliberately leaves alone) and
`docs/superpowers/specs/2026-09-02-identity-accounts-design.md` for the
`weddings`/`wedding_members` tables this builds on.

## Data model

Two new tables, both keyed to `weddings.id` from subsystem A:

- **`wedding_documents`** — one row per wedding: `wedding_id` (fk, unique),
  `document` (jsonb — the full Trousseau document, same shape the zod
  contract package already validates), `version` (integer, starts at 0,
  incremented on every successful write — the compare-and-set token),
  `updated_at`, `updated_by` (fk → auth.users).
- **`wedding_document_history`** — append-only: `id` (uuid, pk), `wedding_id`
  (fk), `document` (jsonb, the full document as it stood after this save,
  not a diff), `saved_at`, `saved_by` (fk → auth.users). Every successful
  write to `wedding_documents` appends exactly one row here, in the same
  transaction. This is the DVC version-history replacement — full snapshots
  are simpler to reason about and to restore from than diffs, at a storage
  cost judged acceptable for the value (recovering someone's only copy of
  their wedding plan).

RLS on both tables: readable and writable only via an existing
`wedding_members` row for that `wedding_id` — identical membership check to
subsystem A's `weddings`/`wedding_members` policies.

**The existing `suite/lib/sync/` E2E-encrypted backend is untouched.** It
keeps serving `/seat/[token]` guest-facing sharing exactly as it does today
— a separate, narrower-purpose system living alongside this one, not
replaced or unified with it. A wedding's own account-owned data goes through
the path below; a guest looking up their seat still goes through the
existing encrypted share-link path.

## The write path

This is the part that matters — it's where the old pipeline's guarantees
(bytes validated before being kept, one gate per concern, never partially
applied) get reproduced without git or DVC in the loop.

1. Client sends the new document plus the `version` it last read.
2. **Compare-and-set check:** if the sent `version` doesn't match the
   current row's `version`, reject immediately with the current `document`
   and `version` attached — the decided conflict behavior ("someone else
   edited this, refresh and reapply"), not a merge attempt.
3. **Cross-slice validation:** if the version matches, run the ported
   `validate-wedding.mjs` logic (date agreement across sources, seat/table
   consistency, lane existence, etc.) against the incoming document.
   - An **error**-level violation rejects the write outright, with the same
     field-level detail the CLI tool already produces — matching its
     existing exit-1 semantics.
   - A **warning**-level violation (no table assigned, no dietary answer,
     empty lane) does **not** block the write — matching the CLI tool's
     existing exit-0-with-warnings behavior. These are things about the
     *wedding*, not the *data*, and blocking a save over them would be
     wrong.
4. On success: update `wedding_documents` (new `document`, `version + 1`,
   `updated_at`, `updated_by`) and insert into `wedding_document_history`,
   atomically. Return the new `version` to the client.

## Offline behavior

Each app's existing local-first autosave (IndexedDB/localStorage) stays,
now as a cache/buffer rather than the source of truth:

- **Reads:** hydrate from the cloud when reachable; fall back to the local
  cache when offline. The local cache is always kept current with whatever
  was last successfully read or written, cloud or local.
- **Writes:** attempted against the write path above immediately when
  online. When offline, queued locally (in the same local store) and
  replayed in order once connectivity returns.
- **Replay conflicts:** a queued write can itself lose the compare-and-set
  check on replay, if the wedding changed elsewhere while this device was
  offline. This is handled identically to any other conflict — surfaced to
  the user to reapply, not auto-merged — rather than inventing a second
  conflict-handling path for the offline case specifically.

## Error handling

Every rejection at the write path (CAS conflict, validation error) carries
enough structured detail for the client to show a real message: which
fields conflicted or which cross-slice rule failed, not a generic "save
failed." This mirrors the existing CLI validator's own readable-error
design rather than introducing a new error shape.

## Testing

- RLS tests: a user can read/write `wedding_documents` and
  `wedding_document_history` only for weddings they belong to.
- CAS conflict test: a write with a stale `version` is rejected and returns
  current state; a write with the correct `version` succeeds.
- Validation-gate tests: a write that violates an error-level cross-slice
  rule is rejected; a write that only trips a warning-level rule succeeds.
- History tests: every successful write produces exactly one new
  `wedding_document_history` row, and history is never mutated or pruned by
  this design (retention policy, if any, is a future decision, not part of
  this one).
- Offline-queue tests: a queued write replays correctly on reconnect; a
  queued write that now conflicts on replay surfaces the same conflict
  handling as an online conflict.
- Regression check: `suite/lib/sync/`'s existing test suite (the
  `/seat/[token]` backend) passes unmodified — this design must not touch it.

## Explicitly deferred (not decided here)

- History retention/pruning policy (keep forever vs. cap) — not decided,
  not blocking initial implementation.
- Any UI for browsing/restoring from history — this design only establishes
  that the data exists to make that possible later.
- Whether `suite/lib/sync/`'s crypto/rate-limiting code ever gets reused for
  a different future feature — out of scope here; it stays exactly where
  and what it is today.

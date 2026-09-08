# Account-synced collaboration

## Goal

Two partners, each signed in with their own account, always see the current
wedding — on any device, without a separate secret to remember or hand each
other. Sync is automatic: no button to press, no passphrase to type.

This replaces local-only as the default experience. Local-only (no backend
configured) still works — nothing here requires a backend to exist — but when
one is configured, signing in is the whole story.

## Non-goals

- **True real-time co-editing.** No cursors, no live keystroke-by-keystroke
  merge, no CRDT. Refresh-driven liveness (poll + sync-on-focus) was chosen
  deliberately over this. A future upgrade path, not this project.
- **Migrating existing passphrase-synced weddings.** Confirmed nothing real is
  using `lib/sync` yet, so it is replaced outright, not migrated.
- **Changing the guest link.** It stays a separate, reduced-snapshot mechanism
  for people with no account. It needs to be re-pointed at the new wedding id
  (see Open follow-ups) but its design is unchanged.

## Current state (as found)

Three systems already exist, only one of them wired up:

- **`lib/accounts`** — Supabase magic-link auth, `account_weddings` /
  `wedding_members` (capped at 2), email invites with expiry, `is_wedding_member()`
  RLS helper. Wired up, working.
- **`lib/sync`** — passphrase-derived E2E encryption, its own independent
  `weddings`/`slices`/`blobs` tables (not connected to `account_weddings`),
  per-slice optimistic-concurrency conflict detection, a manual "Sync" button
  in `SharePanel.tsx`. Wired up, working, but requires a passphrase the couple
  manage themselves, and the decryption key is memory-only — lost on every
  reload. **This is what gets replaced.**
- **`lib/documents`** — a whole-document JSONB store keyed by
  `account_weddings.id`, RLS-gated via `is_wedding_member()`, compare-and-set
  writes through `save_wedding_document()`, automatic append-only version
  history (`wedding_document_history`). Has a working `GET`/`PUT /api/documents`
  route, rate-limited, tested. **Built, but nothing calls it.** This is the
  foundation for everything below.

## Architecture

### Identity and authorization

Unchanged from `lib/accounts`. One wedding per pair, `account_weddings.id` is
the only wedding id anywhere in the new design — the passphrase system's
separate `weddings` table concept goes away entirely.

### Document sync

`useTrousseauStore` gets a new sync module (replacing `lib/sync/client.ts`'s
role) that talks to `/api/documents`. Algorithm, run on every sync:

1. `GET /api/documents` → the server's current document + version.
2. For each top-level slice (`event`, `guests`, `seating`, `timeline`, `day`,
   `crew`, `stationery`) compare against the last-agreed fingerprint, exactly
   as `lib/sync/client.ts`'s `sync()` does today:
   - Changed only on the server → take it.
   - Changed only here → keep it, will be pushed.
   - Changed on both → **conflict**. Neither side's value for that slice is
     touched; it's queued for the user to resolve.
3. Build a merged document from the results of step 2.
4. `PUT /api/documents` with the merged document and the version read in step
   1 (compare-and-set, same semantics as the existing per-slice version check).
5. If the PUT is rejected (server moved between steps 1 and 4 — rare), re-fetch
   and re-run the merge. This mirrors the existing "rare, genuine conflict"
   handling in `lib/sync/client.ts`.

This gets per-slice conflict granularity on top of whole-document storage —
the version number that gets compare-and-set is document-wide, but two
partners editing *different* slices in the same window still merge cleanly
with no conflict, because the merge happens client-side before the write.

**Why not literally reuse `lib/sync`'s existing per-slice tables instead:**
they're built around the passphrase/encryption model end to end (salt,
auth-hash, ciphertext columns) and aren't connected to `account_weddings`.
Adapting them would mean unpicking that model anyway; building the merge on
top of the already-account-gated `lib/documents` is less total change.

### Auto-sync triggers

- On mount (app open / page load).
- On window focus (coming back to the tab).
- Every 20 seconds while the tab is open and a wedding is active.
- A debounced push (~2s after the last local edit) so a burst of typing
  doesn't push mid-keystroke, but a finished edit doesn't sit unpushed until
  the next poll tick either.

20s is a starting point, not a constraint baked into the design — cheap to
tune once it's running.

### Conflict UX

Because sync is now silent and automatic, a conflict can no longer interrupt
what the user is doing. It becomes a dismissible banner ("Your seating changes
and theirs don't match — Keep mine / Take theirs") rather than a blocking
modal. The underlying resolution actions (`keepMine` / `takeTheirs`) are the
same operations `lib/sync/client.ts` has today, just triggered from a banner
instead of a panel the user opened on purpose.

### Blobs (fonts, artwork)

New: a Supabase Storage bucket, not a Postgres table. Objects keyed by
`{weddingId}/{assetId}`, RLS/storage policies scoped to
`is_wedding_member(weddingId)`. Client uploads/downloads go straight to
Storage (signed URLs or direct authenticated access), not proxied through a
serverless function — avoids the ~4.5MB Vercel body-size ceiling a large
embedded font could hit going through a Postgres-row approach.

This is new infrastructure; nothing existing to adapt (the old `lib/sync`
blobs table was encrypted-bytes-in-Postgres and is being retired along with
the rest of that system).

### What gets removed

- `lib/sync/crypto.ts` (passphrase → key derivation, sealing/unsealing).
- The passphrase entry / "share this passphrase with your partner" UI in
  `SharePanel.tsx`.
- The in-memory-only `Session`, and the "reload asks for the passphrase
  again" behaviour that comes with it.
- The passphrase system's own `weddings`/`slices`/`blobs` tables, once nothing
  references them (see Open follow-ups — not deleted in the same change that
  adds the new system).

### What replaces the removed UI

`SharePanel.tsx` becomes: sign-in state (already exists via `lib/accounts`),
an "invite your partner" action (already exists — `createInvite`), and a
sync status line ("Last synced 12s ago" / a conflict banner when one exists).
No passphrase step anywhere.

## Testing

Follow the existing pattern in this codebase (`memoryStore()` +
`supabaseStore()` behind a shared interface, handler logic tested against the
fake, migrations tested against real Postgres via PGlite — see
`lib/sync/migrations.test.ts`). The merge algorithm in step 2 above is pure
logic over plain objects and should get the same kind of direct unit coverage
`lib/sync/client.test.ts` already has for the equivalent per-slice logic.

## Open follow-ups (not in this pass)

- **Guest link re-plumbing.** Currently keyed off the passphrase system's
  wedding id and its own encryption. Needs to move to `account_weddings.id`;
  its own separate key/encryption for the reduced snapshot is unaffected and
  out of scope here.
- **Deleting the old passphrase tables/migrations.** Left in place until the
  new system has shipped and nothing points at them, then a follow-up
  migration drops `weddings` / `slices` / `blobs` (the `lib/sync` ones) and
  the code in `lib/sync/` is deleted.
- **Push instead of poll.** Supabase Realtime (listening for row changes on
  `wedding_documents`) could replace the 20s poll with an instant trigger
  later, without touching the merge/conflict logic above. Noted as a cheap
  upgrade path, not needed to meet today's "log in anywhere, stay current"
  goal.

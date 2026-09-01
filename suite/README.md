# Trousseau

Seating, stationery, timeline and crew for one wedding, in one application.

> Briefly called Tableaux Suite, which it shared with one of the four apps it
> replaces. The name it has now is the repo it lives in — and the metaphor was
> always about this: a trousseau is the collection carried into a marriage.
> Stored data written under the old name is moved on first load by
> [`lib/store/migrateKeys.ts`](lib/store/migrateKeys.ts).
>
> Two things kept the old name on purpose. The HKDF labels in
> [`lib/sync/crypto.ts`](lib/sync/crypto.ts) are opaque protocol constants that
> derive every key from a passphrase: changing them would make every wedding
> already shared permanently undecryptable, for no visible benefit. And the
> `Ported from Tableaux's …` comments are provenance, and still true.
Local-first: no account, no server, and no guest name leaves the device unless
you deliberately share it.

This is the four standalone apps — [Tableaux](https://github.com/JFrusher/Tableaux),
[Plaque](https://github.com/JFrusher/Plaque),
[Cadence](https://github.com/JFrusher/cadence) and
[Brigade](https://github.com/JFrusher/Brigade) — brought onto one document, the
`.trousseau.json` whose contract lives in the package above this directory.

## Why it is here

The four apps each owned a slice of one wedding and each exported a file.
Nothing kept the files in step, which is how the place cards come to say table 6
while the seating plan says table 8. Putting them in one process removes the
exchange entirely: seat someone and their place card already knows the table
number, move a block of the day and every job hanging off it moves with it.

## The store

One Zustand store, [`lib/store/useTrousseauStore.ts`](lib/store/useTrousseauStore.ts),
holding the Trousseau envelope rather than a flat bag of entities:

| Slice | What is in it | Written by |
| --- | --- | --- |
| `event` | names, date, venue, curfew | the Data manager |
| `guests` | the list, keyed by id | seating, CSV import |
| `seating` | tables, groups, families, zones, walls, spaces, rules | seating |
| `timeline` | the day as authored — anchors, gaps, squeeze floors | timeline |
| `day` | the day resolved to clock times | published on every timeline edit |
| `crew` | teams, people, jobs | delegation |
| `stationery` | the card, the sheet, the design | place cards |

Two copies of the document are held on purpose. `raw` is what was stored,
untouched; every write goes through the contract's `mergeSlice` on it, so a
schema bug can at worst refuse a read and can never destroy a write. `doc` is
`raw` parsed, for reading, reparsed once per mutation rather than once per
render.

Undo is whole-document, fifty deep, coalescing edits of the same kind so typing
a table name is one step rather than seven. Persistence is IndexedDB via
`idb-keyval` — uploaded fonts and artwork run to hundreds of kilobytes, and
Plaque had already migrated off localStorage for that reason.

> **Selectors must not allocate.** A selector returning a fresh object on every
> render is an infinite update loop under `useSyncExternalStore`, not merely a
> slow render. Every derived view goes through the per-document cache in
> `lib/model/slices.ts`, and [`lib/model/selectors.test.ts`](lib/model/selectors.test.ts)
> asserts referential stability for each one. Add new ones to it. This has bitten
> three times.

## What came across

The four apps' pure cores were copied rather than reimplemented, with their own
test suites:

- **Tableaux** — table geometry and seat placement, alignment snapping, the
  chair-relocation pass, the warnings engine.
- **Plaque** — the whole 4,800-line core: imposition, fold transforms, crop
  marks, fontkit measuring and text fitting, the element model, bindings,
  overrides, the icon and image pipelines, and both renderers.
- **Cadence** — the scheduling resolver, clash detection, slack, NOAA solar, and
  all five printed pieces.
- **Brigade** — coverage analysis, reconciliation, and the three job-sheet PDFs.

Two things were rewritten rather than ported. Plaque's CSV reader used papaparse;
it now uses the dependency-free tokenizer already in the suite, which grew
delimiter detection and blank-line skipping to match. Brigade's day-import and
reconcile loop is mostly moot: the day is next door rather than a file, so a
block that moves takes its jobs with it.

## Running it

```sh
npm install              # from the repo root — this is an npm workspace
npm run dev  -w suite
npm run test -w suite
npm run build -w suite   # builds the contract package first, then the app
```

## Sharing

Optional, and off by default. With no backend configured the app is entirely
local.

- **Sync between two machines.** A passphrase is stretched with 600,000 rounds
  of PBKDF2 and split by HKDF into a content key that never leaves the browser
  and a write token whose *hash* the server keeps. The server stores ciphertext
  it cannot read — uploaded fonts and artwork included.

  **A slice you have edited is never overwritten by a pull.** Each slice is
  remembered by its version on the server *and* its content fingerprint at the
  moment it was last agreed, so the client can tell whether it changed here,
  there, or both. Only the last is a conflict, and it is put to the user with
  Keep mine / Take theirs. Nothing is applied or sent for a slice in conflict.

  Joining a wedding on a device that already holds one stops and asks first.
- **A link for the guests.** A deliberately reduced snapshot — names and table
  numbers, nobody who declined, and no email addresses, phone numbers, dietary
  requirements or notes — encrypted under a fresh key carried in the link's
  fragment, which browsers never send to a server.

  There is only ever **one live link per wedding**. Publishing again replaces
  what it shows, so a link already given out stays correct, and "take it down"
  deletes it outright. An earlier version minted a new token each publish and
  left every previous link live for ever, still serving the plan as it was.

Both are rate limited and size capped — this is a public URL, and without limits
the endpoints are free storage and an unthrottled place to guess a passphrase.
The limiter is per serverless instance, which slows an attack rather than
stopping it dead; move the counter into Postgres if that is ever not enough.

See [`.env.example`](.env.example). The schema is in
[`../supabase/migrations`](../supabase/migrations).

## Deploying

**Apply the migrations before you deploy the code, not after.** Every write
this app makes names columns the migrations add, so a deploy that lands first
fails every write with a 503 until the database catches up — creating a wedding,
which is the first thing anyone does with a passphrase, included. The server log
says so explicitly when it happens.

Migrations are in [`../supabase/migrations`](../supabase/migrations), applied in
filename order. `lib/sync/migrations.test.ts` runs them against a real Postgres
— PGlite, no Docker or credentials needed — including the upgrade paths, so a
migration that only works on an empty database fails there rather than in
production.

Vercel, with **Root Directory set to `suite`**. `vercel.json` cannot set that —
it is a project setting. npm walks up to the workspace root from here, so the
install picks up the contract package's dependencies and `npm run build` can
compile it before Next runs.

## Audit trail

Bugs found by auditing this work after it was written, and fixed:

| What | Why it mattered |
| --- | --- |
| `sync()` pulled over local state, then pushed the result | Destroyed any work done since the last sync and reported success |
| A rejected push, retried, overwrote the other machine | The version was updated from the rejection but the data was not |
| `select … for update` locked nothing on an absent row | Two first writes both succeeded; one was lost silently |
| Guest links were minted fresh each publish | Every old link stayed live for ever with the old plan on it |
| Fonts and artwork never synced | The other machine could not export — the design blocks on missing artwork |
| Recalibrating did not rescale legacy tables | The room silently changed proportions |
| Uploading a picture with no picture element | Bytes stored, nothing shown, no message |
| No rate limits or size caps | Free storage, and unthrottled passphrase guessing |

## Known gaps

- Restyling the printed pieces is read-only in the Timeline's Print panel. The
  renderers already take the styles from the document; only the writes are
  unwired.
- Tableaux's XLSX export was dropped — SheetJS ships about a megabyte to the
  browser for what a CSV opens fine in Excel.
- Cadence's presentation mode and drag-to-what-if ghosting are not ported. The
  resolver and the slack report they were built on both are.

## Licence

[MIT](../LICENSE). Bundled fonts are SIL Open Font License 1.1 — see
[`public/fonts`](public/fonts).
